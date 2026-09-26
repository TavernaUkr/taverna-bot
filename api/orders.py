# api/orders.py
"""
Ендпоінти для роботи з замовленнями Mini App:

- POST /api/v1/orders/            — чекаут з Mini App (створення замовлення);
- GET  /api/v1/orders/supplier/{id} — список замовлень магазину (B2B Orders Hub);
- PATCH /api/v1/orders/{id}/status  — зміна статусу замовлення менеджером.

Відмінність від `/api/v1/order/create` у `web_app.py` (там кошик у Redis
+ JWT-сесія користувача, головний флоу бота): ці роути приймають кошик і
дані клієнта прямо в тілі запиту, без сесії — саме для швидкого
чекауту в Mini App (`CheckoutModal.tsx` -> `createBackendOrder`).
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.auth import validate_init_data
from api_models import (
    OrderCreate,
    OrderCreateResponse,
    OrderStatusUpdate,
    SupplierOrderResponse,
)
from database.db import get_db
from database.models import (
    Order,
    OrderItem,
    OrderStatus,
    PaymentStatus,
    ProductVariant,
    Supplier,
    SupplierType,
    User,
)
from services.mydrop_api import create_order_in_mydrop, denamespace_supplier_code, MyDropAPIError
from config_reader import config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/orders", tags=["Orders"])


@router.post("/", response_model=OrderCreateResponse, status_code=201)
async def create_order(payload: OrderCreate, db: AsyncSession = Depends(get_db)):
    """
    Створює замовлення (`orders`) разом з позиціями (`order_items`)
    з даних, надісланих Checkout-формою Mini App.
    """
    # 1. Підвантажуємо всі варіанти товарів одним запитом (щоб не бити БД в циклі)
    variant_ids: List[int] = [item.variant_id for item in payload.items if item.variant_id is not None]
    variants_by_id: Dict[int, ProductVariant] = {}

    if variant_ids:
        stmt = (
            select(ProductVariant)
            .where(ProductVariant.id.in_(variant_ids))
            .options(selectinload(ProductVariant.product))
        )
        result = await db.execute(stmt)
        variants_by_id = {v.id: v for v in result.scalars().all()}

        missing = [vid for vid in variant_ids if vid not in variants_by_id]
        if missing:
            raise HTTPException(status_code=404, detail=f"Варіанти товару не знайдено: {missing}")

    # 2. Формуємо OrderItem-и та рахуємо суму замовлення
    order_items: List[OrderItem] = []
    subtotal = 0

    for item in payload.items:
        variant = variants_by_id.get(item.variant_id) if item.variant_id is not None else None

        if variant is not None:
            # [БЕЗПЕКА] Ціну беремо з БД (variant.final_price), а НЕ з того,
            # що прислав фронтенд у `item.price` — інакше клієнт міг би
            # підмінити ціну в запиті й купити товар за довільну суму.
            price = variant.final_price
            product_id = variant.product_id
            supplier_id = variant.product.supplier_id if variant.product else None
            product_name = item.product_name or (variant.product.name if variant.product else "Товар")
            sku = variant.product.supplier_sku if variant.product else None
            supplier_offer_id = variant.supplier_offer_id
        else:
            # Товар без variant_id (немає розмірів/кольорів) — перевірити
            # ціну по БД тут нічим, довіряємо тому, що прислав фронтенд.
            price = item.price
            product_id = item.product_id
            supplier_id = None
            product_name = item.product_name
            sku = None
            supplier_offer_id = None

        subtotal += price * item.quantity

        order_items.append(
            OrderItem(
                product_id=product_id,
                variant_id=item.variant_id,
                supplier_id=supplier_id,
                product_name=product_name,
                sku=sku,
                options_text=item.options_text,
                quantity=item.quantity,
                price_per_item=price,
                supplier_offer_id=supplier_offer_id,
            )
        )

    # 3. Створюємо саме замовлення
    order_uid = f"WEB-{uuid.uuid4().hex[:10].upper()}"

    order = Order(
        order_uid=order_uid,
        status=OrderStatus.new,
        payment_status=PaymentStatus.cod if payload.payment_type == "cod" else PaymentStatus.pending,
        total_price=subtotal,
        subtotal=float(subtotal),
        delivery_cost=0.0,
        customer_name=payload.customer_name,
        customer_phone=payload.customer_phone,
        delivery_service=payload.delivery_service,
        delivery_address=payload.delivery_address,
        payment_type=payload.payment_type,
        note=payload.note,
        items=order_items,
    )

    try:
        db.add(order)
        await db.commit()
        await db.refresh(order)
    except Exception as e:
        await db.rollback()
        logger.error(f"Помилка створення замовлення (Checkout Mini App): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Не вдалося створити замовлення")

    logger.info(f"Checkout: створено замовлення {order.order_uid} (ID={order.id}) на суму {order.total_price} грн")

    # 4. Відправка замовлення в MyDrop (кабінет постачальника).
    # [ВАЖЛИВО] Це НЕ повинно валити наш чекаут — замовлення в нашій БД вже
    # збережено (комміт вище пройшов успішно). Якщо MyDrop лежить/ключ
    # невалідний — просто логуємо помилку і повертаємо клієнту 201, як і при успіху.
    await _sync_order_to_mydrop(order, order_items, db)

    return OrderCreateResponse(
        id=order.id,
        order_uid=order.order_uid,
        total_price=order.total_price,
        status=order.status,
    )


# --- B2B Хаб Замовлень: список замовлень магазину + зміна статусу -------------
#
# Використовується сторінкою «Замовлення магазину» (Orders Hub, Mini App):
# `StoreOrdersHub.tsx` -> `StoreOrdersList.tsx` -> getSupplierOrders()/updateOrderStatus().
#
# [ЗАПИТАННЯ] Замовлення в БД НЕ мають прямого поля supplier_id у чекауті:
# магазин прив'язаний через позиції (`OrderItem.supplier_id`). Тому список
# замовлень магазину = замовлення, у яких ХОЧА Б ОДНА позиція має supplier_id
# цього магазину (включно з замовленнями головного флоу бота, де
# `Order.supplier_id` заповнений напряму).

VALID_MANAGER_STATUSES = {s.value for s in OrderStatus}


def _telegram_id_from_authorization(authorization: Optional[str]) -> Optional[int]:
    """Bearer initData Telegram Mini App -> telegram_id (401, якщо невалідний)."""
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    user_data = validate_init_data(token.strip())
    if user_data is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid initData: Hash mismatch or expired",
        )
    raw_id = user_data.get("id")
    if not raw_id:
        raise HTTPException(status_code=401, detail="Invalid initData: user is missing")
    return int(raw_id)


async def _get_user_by_telegram_id(db: AsyncSession, telegram_id: int) -> Optional[User]:
    return (
        await db.execute(select(User).where(User.telegram_id == telegram_id))
    ).scalar_one_or_none()


async def _user_manages_supplier(db: AsyncSession, user_id: int, supplier_id: int) -> bool:
    """Чи є юзер власником або менеджером магазину (supplier_id)."""
    owner_or_manager = (
        await db.execute(
            select(Supplier.id).where(
                Supplier.id == supplier_id,
                or_(
                    Supplier.user_id == user_id,
                    Supplier.managers.any(id=user_id),
                ),
            )
        )
    ).scalar_one_or_none()
    return owner_or_manager is not None


def _items_for_supplier(order: Order, supplier_id: int) -> List[OrderItem]:
    """Позиції замовлення цього магазину (якщо є — лише його, інакше всі)."""
    items = [item for item in (order.items or []) if item.supplier_id == supplier_id]
    if items:
        return items
    return list(order.items or [])


@router.get("/supplier/{supplier_id}", response_model=List[SupplierOrderResponse])
async def get_supplier_orders(
    supplier_id: int,
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """
    Замовлення магазину для B2B-хабу (Orders Hub).

    Доступ: лише власник або менеджер цього магазину (RBAC як у тікетах).
    Фільтр `status` — значення OrderStatus (new/processing/shipped/...).
    Сортування: новіші спершу.
    """
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    if not await _user_manages_supplier(db, user.id, supplier_id):
        raise HTTPException(
            status_code=403,
            detail="Немає доступу до замовлень цього магазину",
        )

    if status is not None and status not in VALID_MANAGER_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Невірний status. Дозволені: {', '.join(sorted(VALID_MANAGER_STATUSES))}",
        )

    # Підзапит: ID замовлень, де є хоча б одна позиція цього магазину
    order_ids_subq = (
        select(OrderItem.order_id)
        .where(OrderItem.supplier_id == supplier_id)
        .distinct()
        .subquery()
    )

    conditions = [Order.id.in_(select(order_ids_subq.c.order_id))]
    # Замовлення головного флоу бота: Order.supplier_id заповнений напряму
    conditions.append(Order.supplier_id == supplier_id)
    stmt = (
        select(Order)
        .where(or_(*conditions))
        .options(selectinload(Order.items))
    )
    if status is not None:
        stmt = stmt.where(Order.status == status)
    stmt = (
        stmt
        .order_by(Order.created_at.desc().nullslast(), Order.id.desc())
        .limit(limit)
        .offset(offset)
    )

    orders = (await db.execute(stmt)).scalars().unique().all()

    return [
        SupplierOrderResponse(
            id=order.id,
            order_uid=order.order_uid,
            status=order.status,
            customer_name=order.customer_name,
            customer_phone=order.customer_phone,
            delivery_service=order.delivery_service,
            delivery_address=order.delivery_address,
            payment_type=order.payment_type,
            note=order.note,
            total_price=order.total_price,
            created_at=order.created_at,
            updated_at=order.updated_at,
            items=_items_for_supplier(order, supplier_id),
        )
        for order in orders
    ]


@router.patch("/{order_id}/status", response_model=SupplierOrderResponse)
async def update_order_status(
    order_id: int,
    payload: OrderStatusUpdate,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """
    Зміна статусу замовлення менеджером/власником магазину (Orders Hub).

    Доступ: юзер має керувати магазином, до якого належить замовлення
    (Order.supplier_id або OrderItem.supplier_id хоча б однієї позиції).
    """
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    order = await db.get(Order, order_id, options=[selectinload(Order.items)])
    if not order:
        raise HTTPException(status_code=404, detail="Замовлення не знайдено")

    # Магазини, з якими пов'язане це замовлення
    order_supplier_ids = {item.supplier_id for item in (order.items or []) if item.supplier_id}
    if order.supplier_id:
        order_supplier_ids.add(order.supplier_id)

    if not order_supplier_ids:
        raise HTTPException(
            status_code=403,
            detail="Замовлення не прив'язане до жодного магазину",
        )

    can_manage = False
    for sid in order_supplier_ids:
        if await _user_manages_supplier(db, user.id, sid):
            can_manage = True
            break
    if not can_manage:
        raise HTTPException(
            status_code=403,
            detail="Немає доступу до цього замовлення",
        )

    old_status = order.status
    order.status = payload.status
    # `updated_at` має onupdate, але для надійності ставимо явно
    order.updated_at = datetime.now(timezone.utc)

    try:
        await db.commit()
        await db.refresh(order)
    except Exception as e:
        await db.rollback()
        logger.error(f"Помилка зміни статусу замовлення #{order_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Не вдалося зберегти статус замовлення")

    logger.info(
        "Замовлення #%s (%s): статус змінено user=%s: %s -> %s",
        order.id, order.order_uid, user.id, old_status, order.status,
    )

    primary_supplier_id = next(iter(order_supplier_ids))
    return SupplierOrderResponse(
        id=order.id,
        order_uid=order.order_uid,
        status=order.status,
        customer_name=order.customer_name,
        customer_phone=order.customer_phone,
        delivery_service=order.delivery_service,
        delivery_address=order.delivery_address,
        payment_type=order.payment_type,
        note=order.note,
        total_price=order.total_price,
        created_at=order.created_at,
        updated_at=order.updated_at,
        items=_items_for_supplier(order, primary_supplier_id),
    )


async def _sync_order_to_mydrop(order: Order, order_items: List[OrderItem], db: AsyncSession) -> None:
    """
    Відправляє щойно створене замовлення в НАШ кабінет ДРОПШИПЕРА MyDrop
    (`POST /dropshipper/api/orders`), одразу після успішного `db.commit()`.

    [АРХІТЕКТУРА — ВИПРАВЛЕНО 13.09.2026, було 401] Ми НЕ постачальник
    (Vendor) у MyDrop — ми ОДИН дропшипер, що працює з каталогами кількох
    вендорів. Тож:
    - Авторизація іде НАШИМ майстер-ключем дропшипера (`config.mydrop_api_key`
      з `.env`), а НЕ `supplier.mydrop_api_key` (те поле — це ПУБЛІЧНИЙ ключ
      YML-вигрузки постачальника, використовується лише для синхронізації
      каталогу в `services/mydrop_sync.py`, не для замовлень!).
    - У кожному товарі замовлення MyDrop вимагає `vendor_name` — назву
      постачальника В КАБІНЕТІ MYDROP, щоб CRM прив'язала позицію до
      потрібного вендора. Беремо `supplier.name` з нашої БД.
    - Відправляємо лише для постачальників типу `SupplierType.mydrop`
      (independent-постачальники не існують у MyDrop як вендори — для них
      відправка не має сенсу).

    [ПРИПУЩЕННЯ, за яким написана ця функція] Всі товари в кошику належать
    ОДНОМУ постачальнику — тож достатньо взяти `supplier_id` першого товару,
    у якого він відомий. Товари без `variant_id` (додані "вручну", без
    прив'язки до нашої БД товарів) не мають `supplier_id` — вони просто не
    потраплять у відправку в MyDrop.

    [НАДІЙНІСТЬ] Ця функція НІКОЛИ не кидає виняток назовні — усі помилки
    (мережа, невалідний ключ, відсутній ключ) ловляться і пишуться в
    `logger.error`. Замовлення в нашій БД вже збережено ДО виклику цієї
    функції, тож падіння MyDrop не впливає на відповідь клієнту (201 Created).

    [ЧОГО БРАКУЄ] У `Order` є поля `city_ref`/`warehouse_ref` для точного
    міста/відділення Нової Пошти, але поточна схема чекауту (`OrderCreate`
    в `api_models.py`) їх не приймає — фронтенд шле лише вільний текст
    `delivery_address`. При цьому у Dropshipper API MyDrop взагалі НЕМАЄ
    поля для тексту адреси (лише `city`+`warehouse_number` для служб з
    повною інтеграцією) — тож текст адреси йде в `description`, щоб не
    загубити інформацію (`MyDropAPIClient.create_order` це вже обробляє).
    Якщо потрібна автогенерація ТТН — фронтенд має почати передавати
    `delivery_city_ref`/`delivery_warehouse_ref` (як це вже робить
    `SecureCreateOrderRequest` у `web_app.py`), а тоді тут достатньо буде
    прокинути їх у `order_data["city"]`/`["warehouse_number"]`.
    """
    first_supplier_id = next((item.supplier_id for item in order_items if item.supplier_id), None)
    if not first_supplier_id:
        logger.info(
            "MyDrop: замовлення %s не має товарів з відомим supplier_id — пропускаю відправку в MyDrop.",
            order.order_uid,
        )
        return

    try:
        supplier = await db.get(Supplier, first_supplier_id)
    except Exception as e:
        logger.error(
            "MyDrop: не вдалося завантажити постачальника #%s (замовлення %s): %s",
            first_supplier_id, order.order_uid, e, exc_info=True,
        )
        return

    if not supplier:
        logger.warning(
            "MyDrop: постачальника #%s (замовлення %s) не знайдено в БД — пропускаю відправку.",
            first_supplier_id, order.order_uid,
        )
        return

    if supplier.type != SupplierType.mydrop:
        logger.info(
            "MyDrop: постачальник #%s (%s) має тип '%s' (не MyDrop-вендор) — замовлення %s "
            "НЕ відправляється в MyDrop Dropshipper API.",
            supplier.id, supplier.name, supplier.type.value, order.order_uid,
        )
        return

    master_api_key = config.mydrop_api_key.get_secret_value() if config.mydrop_api_key else ""
    if not master_api_key:
        logger.error(
            "MyDrop: не налаштовано mydrop_api_key (майстер-ключ НАШОГО кабінету дропшипера) "
            "в конфігурації — замовлення %s НЕ відправлено в MyDrop.",
            order.order_uid,
        )
        return

    # Беремо ЛИШЕ товари цього постачальника (захист, навіть якщо в кошику
    # випадково опинились товари іншого supplier_id — за поточним
    # припущенням такого не буває, але зайва перевірка не завадить).
    supplier_items = [item for item in order_items if item.supplier_id == supplier.id]
    if not supplier_items:
        logger.warning(
            "MyDrop: у замовленні %s немає товарів з supplier_id=%s — пропускаю відправку.",
            order.order_uid, supplier.id,
        )
        return

    mydrop_items = [
        {
            "supplier_sku": denamespace_supplier_code(supplier.id, item.sku),
            "product_name": item.product_name,
            "quantity": item.quantity,
            "price": item.price_per_item,
            "options_text": item.options_text,
        }
        for item in supplier_items
    ]

    try:
        response = await create_order_in_mydrop(
            api_key=master_api_key,
            order_data={
                "customer_name": order.customer_name,
                "customer_phone": order.customer_phone,
                "vendor_name": supplier.name,
                "delivery_service": order.delivery_service,
                "delivery_address": order.delivery_address,
                "note": order.note,
                "order_source": "TavernaBot MiniApp",
                "order_uid": order.order_uid,
            },
            order_items=mydrop_items,
        )
        logger.info(
            "MyDrop (Dropshipper API): замовлення %s відправлено (вендор %s). MyDrop order id=%s.",
            order.order_uid, supplier.name, response.get("id"),
        )
    except MyDropAPIError as e:
        # MyDrop лежить / ключ невалідний / інша помилка API — НЕ валимо
        # чекаут, лише логуємо. Замовлення в нашій БД вже збережено.
        logger.error(
            "MyDrop: не вдалося відправити замовлення %s (вендор %s): %s",
            order.order_uid, supplier.name, e,
        )
    except Exception as e:
        logger.error(
            "MyDrop: неочікувана помилка при відправці замовлення %s: %s",
            order.order_uid, e, exc_info=True,
        )
