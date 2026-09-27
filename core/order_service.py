# core/order_service.py
"""
Order State Machine — централізована зміна статусу замовлення.

ЄДИНИЙ санітизований шлях зміни Order.status у всьому бекенді.
Гарантує, що фінансовий спліт (core/billing_service.py) спрацює
при будь-якому переході у OrderStatus.delivered («Виконано»/
«Доста'влено»): Mini App (PATCH /orders/{id}/status), LiqPay-callback,
бот-кнопки постачальника, CRON — все йде через change_order_status().

Правила:
- Статус не змінюється (order.status == new_status) → no-op, повертаємо order;
- Перехід new→delivered (не з delivered):
    1) process_order_income: дохід магазину(ів) supplier_income;
    2) process_order_payout: винагорода менеджеру — ЛИШЕ якщо статус
       переводить менеджер (changed_by_manager_role=True і переданий
       changed_by_user_id). Власник/платформа/автоматика не отримують
       винагороду за власну дію;
- Атомарність: status + білінг фіксуються ОДНИМ commit всередині функції;
  будь-який збій → rollback, гроші не нарахуються частково.
- Спроба повернути у delivered вдруге → білінг не дублюється (order.status
  вже delivered, а в Ledger є захист по reference_id).

Транзакційний патерн: функція робить commit самостійно (Unit of Work
відповідає сервіс). Викликанцям ЗАБОРОНЕНО тримати відкриту транзакцію
з незакомміченими змінами цього ж замовлення — інакше порушиться
атомарність.
"""
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from database.db import AsyncSession
from database.models import Order, OrderItem, OrderStatus
from core.billing_service import process_order_income, process_order_payout

logger = logging.getLogger(__name__)


def _normalize_status(new_status) -> OrderStatus:
    """Рядок/Enum → OrderStatus. ValueError з людським текстом при смітті."""
    if isinstance(new_status, OrderStatus):
        return new_status
    raw = str(new_status or "").strip().lower()
    # Легасі-аліас: completed перейменовано на delivered міграцією e03e5517cb5c
    if raw == "completed":
        raw = "delivered"
    try:
        return OrderStatus(raw)
    except ValueError:
        allowed = ", ".join(s.value for s in OrderStatus)
        raise ValueError(f"Невідомий статус замовлення '{new_status}'. Дозволені: {allowed}")


async def get_order_supplier_ids(db: AsyncSession, order: Order) -> list[int]:
    """
    Магазини, з якими пов'язане замовлення: OrderItem.supplier_id
    (хоча б одна позиція) + Order.supplier_id напряму (головний флоу бота).
    Унікальні, стабільний порядок сортування.
    Позиції беремо ПРЯМИМ запитом — lazy-load order.items в async заборонений,
    а db.get() при identity-map hit не застосовує selectinload-опції.
    """
    ids = set()
    item_supplier_ids = (
        await db.execute(
            select(OrderItem.supplier_id)
            .where(
                OrderItem.order_id == order.id,
                OrderItem.supplier_id.isnot(None),
            )
            .distinct()
        )
    ).scalars().all()
    ids.update(int(sid) for sid in item_supplier_ids)
    if order.supplier_id:
        ids.add(int(order.supplier_id))
    return sorted(ids)


async def change_order_status(
    db: AsyncSession,
    order_id: int,
    new_status,
    changed_by_user_id: Optional[int] = None,
    changed_by_manager_role: bool = False,
) -> Order:
    """
    Центральна зміна статусу замовлення + гарантований білінг при delivered.

    Параметри:
    - db: AsyncSession (функція робить commit сама);
    - order_id: Order.id;
    - new_status: OrderStatus | рядок ('delivered', 'completed' → delivered);
    - changed_by_user_id: хто змінює (для винагороди менеджеру;
      None — автоматика/платіжна система);
    - changed_by_manager_role: True, ЛИШЕ якщо статус переводить менеджер
      магазину за контрактом (не власник). Саме за цим прапорцем
      вирішується, чи платити rate_per_order.

    Повертає оновлений Order. Кидає ValueError при невідомому статусі.
    """
    target_status = _normalize_status(new_status)

    order = await db.get(Order, order_id, options=[selectinload(Order.items)])
    if not order:
        raise ValueError(f"Замовлення #{order_id} не знайдено")

    # 1) Статус не змінюється → no-op
    if order.status == target_status:
        return order

    # 2) Фіксуємо старий статус
    old_status = order.status

    # 3) Змінюємо статус
    order.status = target_status

    # 4) ФІНАНСОВИЙ СПЛІТ: перехід у 'delivered' («Виконано»)
    total_income = 0
    reward = 0
    if target_status == OrderStatus.delivered and old_status != OrderStatus.delivered:
        supplier_ids = await get_order_supplier_ids(db, order)
        for sid in supplier_ids:
            total_income += await process_order_income(db, order, sid)

        # Винагорода менеджеру — лише якщо статус переводить МЕНЕДЖЕР
        # (не власник і не автоматика). Магазин беремо перший зв'язаний:
        # rate_per_order — тариф у контексті цього магазину.
        if (
            changed_by_manager_role
            and changed_by_user_id is not None
            and supplier_ids
        ):
            for sid in supplier_ids:
                reward += await process_order_payout(
                    order.id, sid, changed_by_user_id, db
                )

        if total_income > 0 or reward > 0:
            logger.info(
                "Order #%s (%s): перехід %s → delivered; білінг: дохід=%s коп., "
                "винагорода менеджеру=%s коп. (user=%s).",
                order.id, order.order_uid, getattr(old_status, "value", old_status),
                total_income, reward, changed_by_user_id,
            )

    # 5) Атомарний commit: статус + білінг разом
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error(
            "change_order_status #%s: збій commit → rollback: %s",
            order_id, e, exc_info=True,
        )
        raise

    await db.refresh(order)
    logger.info(
        "Замовлення #%s (%s): статус змінено user=%s: %s → %s.",
        order.id, order.order_uid, changed_by_user_id,
        getattr(old_status, "value", old_status),
        getattr(order.status, "value", order.status),
    )
    return order
