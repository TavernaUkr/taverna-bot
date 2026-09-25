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
  погашається при наступних надходженнях на баланс магазину.

Транзакційність: функція лише додає об'єкти в session (session.add),
commit робить викликець (ендпоінт) — тож переказ атомарний із
закриттям тікета: або все пройшло, або нічого.
"""
import logging

from sqlalchemy import select

from database.db import AsyncSession, ensure_user_wallet
from database.models import (
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

