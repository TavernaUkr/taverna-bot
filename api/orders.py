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
from database.models import Order, OrderItem, OrderStatus, PaymentStatus, ProductVariant
from api_models import OrderCreate, OrderCreateResponse

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

    return OrderCreateResponse(
        id=order.id,
        order_uid=order.order_uid,
        total_price=order.total_price,
        status=order.status,
    )
