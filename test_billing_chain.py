# test_billing_chain.py
"""
Live-перевірка фінансового ланцюга тікетів (без запиту до API):
постачальник + менеджер + контракт + тікет → process_ticket_payout → баланси/ledger.
Запуск: python test_billing_chain.py

Фінансовий спліт: магазин платить зі СВОГО операційного балансу
(suppliers.balance), а не з гаманця власника. Гаманець менеджера
поповнюється як і раніше. Якщо балансу не вистачає — дефіцит
фіксується як БОРГ перед менеджерами (managers_debt), баланс = 0
(від'ємним бути не може).
"""
import asyncio
import os
import sys

# Тестова SQLite-БД у пам'яті, щоб не чіпати реальну.
# config_reader при імпорті робить load_dotenv(override=True) — тому спочатку
# імпортуємо його, потім ставимо свій DATABASE_URL, і лише тоді database.db
# (engine створюється саме в момент імпорту database.db).
import config_reader
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"
config_reader.config.database_url = os.environ["DATABASE_URL"]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database.db import Base, engine, AsyncSessionLocal, ensure_user_wallet
from database.models import (
    Supplier, User, UserRole, SupportTicket, TicketMessage,
    Transaction, supplier_managers,
)
from sqlalchemy import select, insert, func
from core.billing_service import process_ticket_payout


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as s:
        # --- Фікстури ---
        owner = User(telegram_id=111, role=UserRole.supplier)
        manager = User(telegram_id=222, role=UserRole.user)
        customer = User(telegram_id=333, role=UserRole.client)
        s.add_all([owner, manager, customer])
        await s.flush()

        sup = Supplier(name="TestShop", user_id=owner.id)
        s.add(sup)
        await s.flush()

        # Контракт: 5000 коп. = 50 грн за тікет
        await s.execute(insert(supplier_managers).values(
            supplier_id=sup.id, user_id=manager.id, rate_per_dispute=5000
        ))

        t = SupportTicket(
            customer_id=customer.id, supplier_id=sup.id,
            assigned_manager_id=manager.id, status="escalated", topic="refund",
        )
        s.add(t)
        await s.flush()
        s.add(TicketMessage(ticket_id=t.id, sender_id=customer.id,
                            sender_role="customer", text="Проблема з доставкою"))
        await s.commit()

        owner_w = await ensure_user_wallet(owner.id, s)
        manager_w = await ensure_user_wallet(manager.id, s)
        owner_w.main_balance = 100000  # 1000 грн (гаманець власника НЕ бере участі)
        manager_w.main_balance = 0
        sup.balance = 100000  # 1000 грн операційного балансу магазину
        await s.commit()

        # --- Тест 1: нормальна виплата ---
        paid = await process_ticket_payout(t.id, s)
        await s.commit()
        print(f"[1] Виплачено: {paid} коп. (очікуємо 5000)")
        assert paid == 5000
        print(f"[1] Баланс магазину: {sup.balance} (очікуємо 95000)")
        assert sup.balance == 95000
        print(f"[1] Гаманець власника: {owner_w.main_balance} (очікуємо 100000 — не зачіпається)")
        assert owner_w.main_balance == 100000
        print(f"[1] Баланс менеджера: {manager_w.main_balance} (очікуємо 5000)")
        assert manager_w.main_balance == 5000

        rows = (await s.execute(select(Transaction).order_by(Transaction.id))).scalars().all()
        print(f"[1] Ledger: {[(r.type, r.amount, r.reference_id) for r in rows]}")
        # Після фінансового спліту — ДВІ сторони переказу:
        # ticket_reward (менеджеру) + supplier_ticket_payout (списання з магазину)
        assert len(rows) == 2
        assert rows[0].type == "ticket_reward" and rows[0].amount == 5000
        assert rows[1].type == "supplier_ticket_payout" and rows[1].amount == -5000

        # --- Тест 2: подвійна виплата заблокована ---
        paid2 = await process_ticket_payout(t.id, s)
        await s.commit()
        total = (await s.execute(select(func.count(Transaction.id)))).scalar()
        print(f"[2] Повторний виклик: paid={paid2}, ledger записів: {total} (очікуємо 0, 2)")
        assert paid2 == 0 and total == 2

        # --- Тест 3: тікет без менеджера ---
        t2 = SupportTicket(customer_id=customer.id, supplier_id=sup.id,
                           assigned_manager_id=None, status="escalated", topic="question")
        s.add(t2)
        await s.commit()
        paid3 = await process_ticket_payout(t2.id, s)
        print(f"[3] Без менеджера: paid={paid3} (очікуємо 0)")
        assert paid3 == 0

        # --- Тест 4: менеджер із нульовим тарифом ---
        await s.execute(insert(supplier_managers).values(
            supplier_id=sup.id, user_id=customer.id, rate_per_dispute=0
        ))
        t3 = SupportTicket(customer_id=owner.id, supplier_id=sup.id,
                           assigned_manager_id=customer.id, status="escalated", topic="delivery")
        s.add(t3)
        await s.commit()
        paid4 = await process_ticket_payout(t3.id, s)
        print(f"[4] Тариф 0: paid={paid4} (очікуємо 0)")
        assert paid4 == 0

        # --- Тест 5: балансу не вистачає → борг менеджерам, баланс = 0 ---
        t4 = SupportTicket(customer_id=customer.id, supplier_id=sup.id,
                           assigned_manager_id=manager.id, status="escalated", topic="other")
        s.add(t4)
        await s.commit()
        sup.balance = 100  # лише 1 грн — дефіцит піде в борг
        sup.managers_debt = 0
        await s.commit()
        paid5 = await process_ticket_payout(t4.id, s)
        await s.commit()
        print(f"[5] Дефіцит: paid={paid5}, баланс={sup.balance} (очікуємо 5000, 0), борг менеджерам={sup.managers_debt} (очікуємо 4900)")
        assert paid5 == 5000 and sup.balance == 0
        assert sup.managers_debt == 4900
        print(f"[5] Гаманець власника досі: {owner_w.main_balance} (очікуємо 100000)")
        assert owner_w.main_balance == 100000
        print(f"[5] Гаманець менеджера: {manager_w.main_balance} (очікуємо 10000 — дві повні виплати)")
        assert manager_w.main_balance == 10000

        print("\n[OK] USI 5 TESTIV PROIDENO")

    # aiosqlite тримає процес живим після завершення — закриваємо engine явно,
    # інакше python-процес «зависає» після успішного фінішу.
    await engine.dispose()


asyncio.run(main())
