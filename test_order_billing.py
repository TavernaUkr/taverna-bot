# test_order_billing.py
"""
Live-перевірка фінансового ланцюга замовлень (без запиту до API):
замовлення + позиції + контракт менеджера → PATCH-логіка білінгу →
process_order_income + process_order_payout → баланси/ledger.
Запуск: python test_order_billing.py

Фінансовий спліт замовлень:
1) 'delivered' → дохід магазину supplier_income (Σ price×qty ×100 коп.)
   → supplier.balance; нові кошти спершу погашають managers_debt;
2) менеджер, який перевів статус, отримує rate_per_order на гаманець;
   платник — баланс магазину; дефіцит → managers_debt;
3) подвійне нарахування/виплата за той самий order_id — заблоковані.
"""
import asyncio
import os
import sys

# Тестова SQLite-БД у пам'яті (як у test_billing_chain.py).
import config_reader
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"
config_reader.config.database_url = os.environ["DATABASE_URL"]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import select, func, insert
from sqlalchemy.orm import selectinload

from database.db import Base, engine, AsyncSessionLocal, ensure_user_wallet
from database.models import (
    Order, OrderItem, OrderStatus, Supplier, User, UserRole,
    Transaction, supplier_managers,
)
from core.billing_service import process_order_income, process_order_payout


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as s:
        # --- Фікстури ---
        owner = User(telegram_id=111, role=UserRole.supplier)
        manager = User(telegram_id=222, role=UserRole.user)
        s.add_all([owner, manager])
        await s.flush()

        sup = Supplier(name="TestShop", user_id=owner.id)
        s.add(sup)
        await s.flush()

        # Контракт: 1000 коп. = 10 грн за замовлення
        await s.execute(insert(supplier_managers).values(
            supplier_id=sup.id, user_id=manager.id, rate_per_order=1000
        ))

        # Замовлення: 2 позиції × 150 грн і 1 × 500 грн = 800 грн = 80000 коп.
        order = Order(order_uid="WEB-TEST-1", status=OrderStatus.shipped,
                      total_price=800, subtotal=800.0,
                      customer_name="Тест", customer_phone="380...")
        s.add(order)
        await s.flush()
        s.add_all([
            OrderItem(order_id=order.id, supplier_id=sup.id,
                      product_name="Товар 1", quantity=2, price_per_item=150),
            OrderItem(order_id=order.id, supplier_id=sup.id,
                      product_name="Товар 2", quantity=1, price_per_item=500),
        ])
        await s.commit()

        manager_w = await ensure_user_wallet(manager.id, s)
        await s.commit()

        # --- Тест 1: дохід магазину ---
        income = await process_order_income(s, order, sup.id)
        await s.commit()
        print(f"[1] Дохід: {income} коп. (очікуємо 80000)")
        assert income == 80000
        print(f"[1] Баланс магазину: {sup.balance} (очікуємо 80000)")
        assert sup.balance == 80000

        rows = (await s.execute(select(Transaction).order_by(Transaction.id))).scalars().all()
        print(f"[1] Ledger: {[(r.type, r.amount) for r in rows]}")
        assert len(rows) == 1
        assert rows[0].type == "supplier_income" and rows[0].amount == 80000
        assert rows[0].supplier_id == sup.id and rows[0].wallet_id is None

        # --- Тест 2: повторний дохід — заблоковано ---
        income2 = await process_order_income(s, order, sup.id)
        await s.commit()
        total = (await s.execute(select(func.count(Transaction.id)))).scalar()
        print(f"[2] Повторний дохід: {income2}, записів: {total} (очікуємо 0, 1)")
        assert income2 == 0 and total == 1

        # --- Тест 3: винагорода менеджеру (балансу вистачає) ---
        reward = await process_order_payout(order.id, sup.id, manager.id, s)
        await s.commit()
        print(f"[3] Винагорода: {reward} коп. (очікуємо 1000)")
        assert reward == 1000
        print(f"[3] Баланс магазину: {sup.balance} (очікуємо 79000)")
        assert sup.balance == 79000
        print(f"[3] Гаманець менеджера: {manager_w.main_balance} (очікуємо 1000)")
        assert manager_w.main_balance == 1000
        print(f"[3] Борг менеджерам: {sup.managers_debt} (очікуємо 0)")
        assert sup.managers_debt == 0

        # --- Тест 4: подвійна винагорода — заблоковано ---
        reward2 = await process_order_payout(order.id, sup.id, manager.id, s)
        await s.commit()
        total = (await s.execute(select(func.count(Transaction.id)))).scalar()
        print(f"[4] Повторна виплата: {reward2}, записів: {total} (очікуємо 0, 3)")
        assert reward2 == 0 and total == 3

        # --- Тест 5: дохід погашає борг менеджерам ---
        # Імітуємо борг 30000 коп. (наприклад, з дефіцитних тікетів)
        sup.managers_debt = 30000
        await s.commit()
        order2 = Order(order_uid="WEB-TEST-2", status=OrderStatus.shipped,
                       total_price=200, subtotal=200.0,
                       customer_name="Тест", customer_phone="380...")
        s.add(order2)
        await s.flush()
        s.add(OrderItem(order_id=order2.id, supplier_id=sup.id,
                        product_name="Товар 3", quantity=1, price_per_item=200))
        await s.commit()

        income3 = await process_order_income(s, order2, sup.id)
        await s.commit()
        # Дохід 20000 коп. на баланс, потім 20000 списано на погашення боргу:
        # борг 30000 → 10000, баланс лишається 79000 (гроші реально пішли
        # на покриття авансу менеджерам, а не зникли з повітря)
        print(f"[5] Дохід: {income3}, борг: {sup.managers_debt} (очікуємо 20000, 10000)")
        assert income3 == 20000
        assert sup.managers_debt == 10000
        print(f"[5] Баланс магазину: {sup.balance} (очікуємо 79000 — без змін, борг з'їв дохід)")
        assert sup.balance == 79000

        # --- Тест 6: винагорода при нульовому балансі → повністю в борг ---
        sup.balance = 0
        await s.commit()
        order3 = Order(order_uid="WEB-TEST-3", status=OrderStatus.shipped,
                       total_price=100, subtotal=100.0,
                       customer_name="Тест", customer_phone="380...")
        s.add(order3)
        await s.flush()
        s.add(OrderItem(order_id=order3.id, supplier_id=sup.id,
                        product_name="Товар 4", quantity=1, price_per_item=100))
        await s.commit()

        reward3 = await process_order_payout(order3.id, sup.id, manager.id, s)
        await s.commit()
        print(f"[6] Винагорода: {reward3}, баланс: {sup.balance}, борг: {sup.managers_debt}")
        print(f"    (очікуємо 1000, 0, 11000)")
        assert reward3 == 1000
        assert sup.balance == 0
        assert sup.managers_debt == 11000
        print(f"[6] Гаманець менеджера: {manager_w.main_balance} (очікуємо 2000 — завжди повністю)")
        assert manager_w.main_balance == 2000

        # --- Тест 7: власник (без контракту rate_per_order) — виплати немає ---
        reward4 = await process_order_payout(order3.id, sup.id, owner.id, s)
        print(f"[7] Власник без тарифу: {reward4} (очікуємо 0)")
        assert reward4 == 0

        # Фінальний стан Ledger
        rows = (await s.execute(select(Transaction).order_by(Transaction.id))).scalars().all()
        print(f"\n[LEDGER] {[(r.type, r.amount, r.reference_id) for r in rows]}")

        print("\n[OK] USI 7 TESTIV PROIDENO")

    await engine.dispose()


asyncio.run(main())
