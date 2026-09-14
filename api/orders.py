# api/orders.py
"""
Ендпоінт для створення замовлень напряму з Mini App (Checkout).

Відмінність від `/api/v1/order/create` у `web_app.py` (там кошик у Redis
+ JWT-сесія користувача, головний флоу бота): цей роут приймає кошик і
дані клієнта прямо в тілі запиту, без сесії — саме для швидкого
чекауту в Mini App (`CheckoutModal.tsx` -> `createBackendOrder`).
"""
import logging
import uuid
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database.db import get_db
from database.models import Order, OrderItem, OrderStatus, PaymentStatus, ProductVariant, Supplier, SupplierType
from api_models import OrderCreate, OrderCreateResponse
from services.mydrop_api import create_order_in_mydrop, MyDropAPIError
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
            "supplier_sku": item.sku,
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
