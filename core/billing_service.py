# core/billing_service.py
"""
Фінансовий ланцюг тікетів (B2B-білінг).

При закритті тікета платформа автоматично розраховується з менеджером
за його тарифом rate_per_dispute (У КОПІЙКАХ) з таблиці контрактів
supplier_managers: гаманець постачальника → гаманець менеджера.

Правила:
- Немає assigned_manager_id (тікет закрив власник або AI) → нікому не платимо;
- Немає контракту менеджера в цьому магазині → пропускаємо;
- rate_per_dispute = 0 / None → пропускаємо (безтарифний менеджер);
- Подвійна виплата неможлива: перед переказом шукаємо в журналі (Ledger)
  вже наявну транзакцію 'ticket_reward' з цим reference_id;
- Баланс постачальника МОЖЕ піти в мінус — це свідомо дозволено
  (платформа пізніше виставить рахунок або спише з наложених платежів).

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

    # Хто платить: власник магазину (гаманці в системі прив'язані до users)
    supplier = await session.get(Supplier, ticket.supplier_id)
    if supplier is None or supplier.user_id is None:
        logger.warning(
            "Білінг тікета #%s: у постачальника #%s немає user_id — платити нікому.",
            ticket_id, ticket.supplier_id,
        )
        return 0

    # 4. Гаманці (гарант-створення; всередині лише flush, без commit)
    supplier_wallet = await ensure_user_wallet(supplier.user_id, session)
    manager_wallet = await ensure_user_wallet(ticket.assigned_manager_id, session)

    # 5. Переказ балансів (мінус постачальнику допускається свідомо)
    supplier_wallet.main_balance -= rate
    manager_wallet.main_balance += rate

    # 6. Два записи в журнал транзакцій (Ledger)
    session.add(
        Transaction(
            wallet_id=supplier_wallet.id,
            amount=-rate,
            type="ticket_fee",
            description=f"Оплата менеджеру за тікет #{ticket.id}",
            reference_id=str(ticket.id),
        )
    )
    session.add(
        Transaction(
            wallet_id=manager_wallet.id,
            amount=rate,
            type="ticket_reward",
            description=f"Винагорода за вирішення тікету #{ticket.id}",
            reference_id=str(ticket.id),
        )
    )

    logger.info(
        "Білінг тікета #%s: нараховано %s коп. менеджеру user=%s (сплачує власник user=%s).",
        ticket.id, rate, ticket.assigned_manager_id, supplier.user_id,
    )
    return rate
