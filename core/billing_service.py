# core/billing_service.py
"""
Фінансовий ланцюг тікетів (B2B-білінг).

При закритті тікета платформа автоматично розраховується з менеджером
за його тарифом rate_per_dispute (У КОПІЙКАХ) з таблиці контрактів
supplier_managers: ОПЕРАЦІЙНИЙ БАЛАНС МАГАЗИНА (suppliers.balance) →
гаманець менеджера.

Правила:
- Немає assigned_manager_id (тікет закрив власник або AI) → нікому не платимо;
- Немає контракту менеджера в цьому магазині → пропускаємо;
- rate_per_dispute = 0 / None → пропускаємо (безтарифний менеджер);
- Подвійна виплата неможлива: перед переказом шукаємо в журналі (Ledger)
  вже наявну транзакцію 'ticket_reward' з цим reference_id;
- Баланс МАГАЗИНУ НЕ МОЖЕ стати від'ємним: якщо коштів не вистачає,
  надлишок списання перетворюється на БОРГ перед менеджерами
  (suppliers.managers_debt), баланс фіксується на 0. Менеджер у будь-якому
  разі отримує свою винагороду повністю — борг платформи-магазину
  погашається при наступних надходженнях (process_order_income).

2) ЗАМОВЛЕННЯ: при переведенні замовлення у OrderStatus.delivered
(«Виконано»/«Доставлено» — статус completed перейменовано міграцією
e03e5517cb5c) нараховується:
- process_order_income: дохід магазину supplier_income
  (Σ price_per_item × quantity × 100, копійки) → supplier.balance,
  нові кошти спершу погашають managers_debt;
- process_order_payout: винагорода менеджеру rate_per_order з балансу
  магазину → гаманець менеджера (order_reward + supplier_order_fee,
  подвійна виплата за order_id заблокована).

Транзакційність: функції лише додають об'єкти в session (session.add),
commit робить викликець (ендпоінт) — тож переказ атомарний із
закриттям тікета / зміною статусу замовлення: або все пройшло,
або нічого.
"""
import logging

from sqlalchemy import select

from database.db import AsyncSession, ensure_user_wallet
from database.models import (
    Order,
    OrderItem,
    Supplier,
    SupportTicket,
    Transaction,
    supplier_managers,
)

logger = logging.getLogger(__name__)


async def get_manager_contract_rate(
    session: AsyncSession, supplier_id: int, manager_user_id: int
) -> int:
    """Тариф менеджера за спір/тікет (rate_per_dispute, копійки). 0, якщо контракту немає."""
    rate = (
        await session.execute(
            select(supplier_managers.c.rate_per_dispute).where(
                supplier_managers.c.supplier_id == supplier_id,
                supplier_managers.c.user_id == manager_user_id,
            )
        )
    ).scalar_one_or_none()
    return int(rate or 0)


async def _payout_already_done(session: AsyncSession, ticket_id: int) -> bool:
    """Захист від подвійної виплати: чи є вже 'ticket_reward' з цим reference_id."""
    existing = (
        await session.execute(
            select(Transaction.id)
            .where(
                Transaction.reference_id == str(ticket_id),
                Transaction.type == "ticket_reward",
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return existing is not None


async def process_ticket_payout(ticket_id: int, session: AsyncSession) -> int:
    """
    Автовиплата менеджеру за закритий тікет за тарифом rate_per_dispute.
    Повертає суму виплати У КОПІЙКАХ (0 — виплати не було).

    ФІНАНСОВИЙ СПЛІТ:
    - менеджер отримує rate на свій персональний гаманець (як і раніше);
    - платник — ОПЕРАЦІЙНИЙ БАЛАНС МАГАЗИНА (suppliers.balance), а не
      гаманець власника;
    - якщо balance < rate → частина покривається з балансу, залишок
      йде в managers_debt, balance = 0 (мінус заборонений);
    - у Ledger пишемо ДВІ транзакції: надходження менеджеру
      (wallet_id) та списання з балансу магазину (supplier_id).

    Commit робить викликець: тут лише зміни балансів + записи в журнал
    (Ledger). Якщо щось впаде до коміту — ендпоінт відкотиться повністю,
    гроші не загубляться (тікет лишиться відкритим і його закриють знову).
    """
    # 1. Тікет
    ticket = await session.get(SupportTicket, ticket_id)
    if ticket is None:
        logger.warning("Білінг тікета #%s: тікет не знайдено.", ticket_id)
        return 0

    # Тікет закрив сам постачальник або AI-бот — платити нікому
    if ticket.assigned_manager_id is None:
        logger.info(
            "Білінг тікета #%s: немає закріпленого менеджера — виплати немає.",
            ticket_id,
        )
        return 0

    # Захист від повторної виплати за той самий тікет (ретраї/паралельні запити)
    if await _payout_already_done(session, ticket_id):
        logger.warning(
            "Білінг тікета #%s: виплата вже проведена — пропуск.", ticket_id
        )
        return 0

    # 2. Контракт менеджера в цьому магазині → 3. тариф
    rate = await get_manager_contract_rate(
        session, ticket.supplier_id, ticket.assigned_manager_id
    )
    if rate <= 0:
        logger.info(
            "Білінг тікета #%s: rate_per_dispute=0 (manager user=%s, supplier=%s) — виплати немає.",
            ticket_id, ticket.assigned_manager_id, ticket.supplier_id,
        )
        return 0

    # Хто платить: ОПЕРАЦІЙНИЙ БАЛАНС МАГАЗИНА (Supplier.balance),
    # а не особистий гаманець власника.
    supplier = await session.get(Supplier, ticket.supplier_id)
    if supplier is None:
        logger.warning(
            "Білінг тікета #%s: постачальника #%s не знайдено — платити нікому.",
            ticket_id, ticket.supplier_id,
        )
        return 0

    # 4. Гаманець менеджера (гарант-створення; всередині лише flush, без commit)
    manager_wallet = await ensure_user_wallet(ticket.assigned_manager_id, session)

    # 5. СПЛІТ: списання з балансу магазину. Менеджер завжди отримує
    #    винагороду ПОВНОЮ мірою; дефіцит коштів магазину → managers_debt.
    covered_from_balance = min(int(supplier.balance or 0), rate)
    debt_increase = rate - covered_from_balance
    supplier.balance = int(supplier.balance or 0) - covered_from_balance
    if debt_increase > 0:
        supplier.managers_debt = int(supplier.managers_debt or 0) + debt_increase
    manager_wallet.main_balance += rate

    # 6. Запис у журнал (Ledger) — дві сторони переказу:
    #    а) менеджер отримав винагороду (транзакція гаманця);
    session.add(
        Transaction(
            wallet_id=manager_wallet.id,
            amount=rate,
            type="ticket_reward",
            description=f"Винагорода за вирішення тікету #{ticket.id}",
            reference_id=str(ticket.id),
        )
    )
    #    б) списання з операційного балансу магазину (транзакція магазина:
    #       wallet_id=NULL, прив'язка через supplier_id; негативна сума = списання).
    #       Дефіцит фіксується в описі як борг перед менеджерами (managers_debt).
    session.add(
        Transaction(
            wallet_id=None,
            supplier_id=supplier.id,
            amount=-rate,
            type="supplier_ticket_payout",
            description=(
                f"Списання за тікет #{ticket.id} з балансу магазину"
                + (
                    f" (+{debt_increase} коп. у борг перед менеджерами)"
                    if debt_increase > 0
                    else ""
                )
            ),
            reference_id=str(ticket.id),
        )
    )

    logger.info(
        "Білінг тікета #%s: нараховано %s коп. менеджеру user=%s (магазин #%s: списано %s коп., борг менеджерам +%s коп., баланс: %s коп.).",
        ticket.id, rate, ticket.assigned_manager_id, supplier.id,
        covered_from_balance, debt_increase, supplier.balance,
    )
    return rate


# --- Фінансовий спліт замовлень (Orders Financial Split) ----------------------
#
# Викликається з PATCH /api/v1/orders/{order_id}/status при переведенні
# замовлення у фінальний успішний статус. «Виконано» у нашій системі —
# OrderStatus.delivered (completed перейменовано міграцією e03e5517cb5c).

# Сума доходу магазину за одну позицію замовлення (У ГРИВНЯХ → копійки).
def _item_income_kopecks(item) -> int:
    """price_per_item — гривні; Transaction/Supplier.balance — копійки. ×100."""
    return int(item.price_per_item or 0) * int(item.quantity or 0) * 100


async def _supplier_income_already_done(session: AsyncSession, order_id: int, supplier_id: int) -> bool:
    """Захист від подвійного нарахування доходу магазину за одне замовлення."""
    existing = (
        await session.execute(
            select(Transaction.id)
            .where(
                Transaction.supplier_id == supplier_id,
                Transaction.reference_id == str(order_id),
                Transaction.type == "supplier_income",
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return existing is not None


async def _order_reward_already_done(session: AsyncSession, order_id: int) -> bool:
    """Захист від подвійної винагороди менеджеру за одне замовлення."""
    existing = (
        await session.execute(
            select(Transaction.id)
            .where(
                Transaction.reference_id == str(order_id),
                Transaction.type == "order_reward",
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return existing is not None


async def get_manager_order_rate(
    session: AsyncSession, supplier_id: int, manager_user_id: int
) -> int:
    """Тариф менеджера за замовлення (rate_per_order, копійки). 0, якщо контракту немає."""
    rate = (
        await session.execute(
            select(supplier_managers.c.rate_per_order).where(
                supplier_managers.c.supplier_id == supplier_id,
                supplier_managers.c.user_id == manager_user_id,
            )
        )
    ).scalar_one_or_none()
    return int(rate or 0)


async def _debit_supplier_balance(
    session: AsyncSession,
    supplier: Supplier,
    amount_kopecks: int,
    tx_type: str,
    description: str,
    reference_id: str,
) -> int:
    """
    Списання з операційного балансу магазину (НЕ може піти в мінус):
    покриваємо з balance, залишок перетворюється на managers_debt.
    Пишемо транзакцію магазину (wallet_id=None, supplier_id).
    Повертає суму, що пішла в борг (0, якщо вистачило балансу).
    """
    covered = min(int(supplier.balance or 0), amount_kopecks)
    debt_increase = amount_kopecks - covered
    supplier.balance = int(supplier.balance or 0) - covered
    if debt_increase > 0:
        supplier.managers_debt = int(supplier.managers_debt or 0) + debt_increase
    session.add(
        Transaction(
            wallet_id=None,
            supplier_id=supplier.id,
            amount=-amount_kopecks,
            type=tx_type,
            description=description + (
                f" (+{debt_increase} коп. у борг перед менеджерами)"
                if debt_increase > 0
                else ""
            ),
            reference_id=reference_id,
        )
    )
    return debt_increase


async def process_order_income(
    session: AsyncSession,
    order: "Order",
    supplier_id: int,
) -> int:
    """
    Нарахування ДОХОДУ магазину за замовлення (supplier_income).

    Правила:
    - рахуємо лише позиції OrderItem цього supplier_id (завантажуємо
      прямим запитом — lazy-load order.items в async заборонений);
    - сума = Σ(price_per_item × quantity) у копійках;
    - supplier.balance += total; погашення managers_debt новими коштами
      (до 0, залишок боргу не втрачається);
    - запис Transaction(type='supplier_income', supplier_id, wallet_id=None,
      amount=+total, reference_id=str(order.id));
    - повторний виклик для того самого (order, supplier) — no-op (idempotent).

    Commit робить викликець. Повертає суму доходу у копійках (0 — якщо
    позицій немає або дохід уже нараховано).
    """
    # Позиції цього магазину — прямим запитом (не order.items!)
    items = (
        await session.execute(
            select(OrderItem).where(
                OrderItem.order_id == order.id,
                OrderItem.supplier_id == supplier_id,
            )
        )
    ).scalars().all()
    if not items:
        return 0

    if await _supplier_income_already_done(session, order.id, supplier_id):
        logger.warning(
            "Білінг замовлення #%s: дохід магазину #%s уже нараховано — пропуск.",
            order.id, supplier_id,
        )
        return 0

    supplier = await session.get(Supplier, supplier_id)
    if supplier is None:
        logger.warning(
            "Білінг замовлення #%s: магазин #%s не знайдено — дохід не нараховано.",
            order.id, supplier_id,
        )
        return 0

    total_income = sum(_item_income_kopecks(i) for i in items)
    if total_income <= 0:
        return 0

    # Дохід повністю приходить на баланс…
    supplier.balance = int(supplier.balance or 0) + total_income
    session.add(
        Transaction(
            wallet_id=None,
            supplier_id=supplier.id,
            amount=total_income,
            type="supplier_income",
            description=f"Дохід від замовлення {order.order_uid or order.id}",
            reference_id=str(order.id),
        )
    )

    # …а ПОТІМ нові кошти погашають борг перед менеджерами (до 0).
    # Це реальний відтік з балансу: платформа вже виплатила менеджеру
    # авансом (див. process_ticket_payout), тепер магазин його покриває.
    old_debt = int(supplier.managers_debt or 0)
    debt_covered = min(old_debt, total_income)
    if debt_covered > 0:
        supplier.managers_debt = old_debt - debt_covered
        supplier.balance = int(supplier.balance or 0) - debt_covered
        session.add(
            Transaction(
                wallet_id=None,
                supplier_id=supplier.id,
                amount=-debt_covered,
                type="managers_debt_repayment",
                description=(
                    f"Погашення боргу менеджерам з доходу замовлення "
                    f"{order.order_uid or order.id}"
                ),
                reference_id=str(order.id),
            )
        )

    logger.info(
        "Білінг замовлення #%s: дохід магазину #%s = %s коп. (борг менеджерам: %s → %s).",
        order.id, supplier.id, total_income, old_debt, supplier.managers_debt,
    )
    return total_income


async def process_order_payout(
    order_id: int,
    supplier_id: int,
    manager_user_id: int,
    session: AsyncSession,
) -> int:
    """
    Винагорода МЕНЕДЖЕРУ за переведення замовлення у 'delivered' (Виконано).

    ФІНАНСОВИЙ СПЛІТ:
    - тариф rate_per_order (копійки) з контракту supplier_managers;
    - rate <= 0 → виплати немає (безтарифний менеджер);
    - менеджер отримує rate на свій глобальний гаманець ПОВНІСТЮ;
    - платник — операційний баланс магазину; дефіцит → managers_debt;
    - ДВІ транзакції в Ledger: 'order_reward' (менеджеру, +rate,
      reference_id=order_id) та 'supplier_order_fee' (магазину, -rate);
    - подвійна виплата за той самий order_id заблокована.

    Commit робить виклинець (ендпоінт статусу). Повертає суму винагороди
    у копійках (0 — виплати не було: безтарифний / власник / повторно).
    """
    if await _order_reward_already_done(session, order_id):
        logger.warning(
            "Білінг замовлення #%s: винагорода менеджеру уже виплачена — пропуск.",
            order_id,
        )
        return 0

    rate = await get_manager_order_rate(session, supplier_id, manager_user_id)
    if rate <= 0:
        logger.info(
            "Білінг замовлення #%s: rate_per_order=0 (manager user=%s, supplier=%s) — виплати немає.",
            order_id, manager_user_id, supplier_id,
        )
        return 0

    order = await session.get(Order, order_id)
    if order is None:
        logger.warning("Білінг замовлення #%s: замовлення не знайдено.", order_id)
        return 0

    supplier = await session.get(Supplier, supplier_id)
    if supplier is None:
        logger.warning(
            "Білінг замовлення #%s: магазин #%s не знайдено — платити нікому.",
            order_id, supplier_id,
        )
        return 0

    # Гаманець менеджера (гарант-створення; всередині лише flush, без commit)
    manager_wallet = await ensure_user_wallet(manager_user_id, session)

    # Списання з балансу магазину (+ борг при дефіциті) і запис у Ledger
    debt_increase = await _debit_supplier_balance(
        session, supplier, rate,
        tx_type="supplier_order_fee",
        description=f"Оплата менеджеру за замовлення {order.order_uid or order.id}",
        reference_id=str(order.id),
    )

    # Нарахування менеджеру + запис у Ledger
    manager_wallet.main_balance += rate
    session.add(
        Transaction(
            wallet_id=manager_wallet.id,
            supplier_id=None,
            amount=rate,
            type="order_reward",
            description=f"Винагорода за виконане замовлення {order.order_uid or order.id}",
            reference_id=str(order.id),
        )
    )

    logger.info(
        "Білінг замовлення #%s: винагорода %s коп. менеджеру user=%s (магазин #%s: борг менеджерам +%s коп.).",
        order_id, rate, manager_user_id, supplier_id, debt_increase,
    )
    return rate

