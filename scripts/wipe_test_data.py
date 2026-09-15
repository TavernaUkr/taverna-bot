# scripts/wipe_test_data.py
"""
Безпечне очищення каталогу перед End-to-End тестом.

Видаляє рядки (DELETE), НЕ робить DROP TABLE.
Таблицю users не чіпає — права Адміна залишаються.

Запуск з кореня проєкту:
    python scripts/wipe_test_data.py
    python scripts/wipe_test_data.py --yes
"""
import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import SQLAlchemyError

from database.db import AsyncSessionLocal
from database.models import (
    Order,
    OrderItem,
    PaidService,
    PriceRule,
    Product,
    ProductOption,
    ProductOptionValue,
    ProductVariant,
    Supplier,
    User,
    product_variant_option_values,
    supplier_channels,
)


async def _count(db, model) -> int:
    return int((await db.execute(select(func.count()).select_from(model))).scalar_one() or 0)


async def wipe(db) -> dict:
    """DELETE у порядку, щоб не впасти на зовнішніх ключах."""
    stats = {
        "users_before": await _count(db, User),
        "products": await _count(db, Product),
        "suppliers": await _count(db, Supplier),
        "orders": await _count(db, Order),
    }

    # 1. Зв'язки варіант ↔ опція
    await db.execute(delete(product_variant_option_values))

    # 2. Позиції замовлень (тримають product_id / variant_id / supplier_id)
    await db.execute(delete(OrderItem))

    # 3. Платні послуги (тримають product / order / supplier)
    await db.execute(delete(PaidService))

    # 4. Опції товару
    await db.execute(delete(ProductOptionValue))
    await db.execute(delete(ProductOption))

    # 5. Варіанти і товари (категорії — поля на Product, окремої таблиці немає)
    await db.execute(delete(ProductVariant))
    await db.execute(delete(Product))

    # 6. Замовлення: спочатку відв'язати дерево parent/child
    await db.execute(update(Order).values(parent_order_id=None))
    await db.execute(delete(Order))

    # 7. Правила цін, прив'язані до магазину (глобальні з supplier_id=NULL лишаємо)
    await db.execute(delete(PriceRule).where(PriceRule.supplier_id.is_not(None)))

    # 8. Зв'язок постачальник ↔ канал (самі канали бота не чіпаємо)
    await db.execute(delete(supplier_channels))

    # 9. Постачальники та заявки
    await db.execute(delete(Supplier))

    await db.commit()

    stats["users_after"] = await _count(db, User)
    return stats


async def main() -> int:
    parser = argparse.ArgumentParser(
        description="Очистити товари, заявки, магазини і замовлення. Користувачів не чіпає."
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Підтвердити видалення без запиту TAK",
    )
    args = parser.parse_args()

    if AsyncSessionLocal is None:
        print("❌ AsyncSessionLocal не ініціалізовано — перевір DATABASE_URL у .env.")
        return 1

    if not args.yes:
        print("Це видалить УСІ товари, заявки постачальників, магазини і замовлення.")
        print("Користувачів (включно з Адміном) НЕ чіпаємо.")
        answer = input("Напиши ТАК і натисни Enter, щоб продовжити: ").strip().upper()
        if answer not in ("ТАК", "TAK"):
            print("Скасовано. Нічого не видалено.")
            return 0

    try:
        async with AsyncSessionLocal() as db:
            stats = await wipe(db)
    except SQLAlchemyError as e:
        print(f"❌ Помилка очищення БД: {e}")
        return 1

    print(
        f"Видалено рядків (до очистки): "
        f"товарів={stats['products']}, постачальників={stats['suppliers']}, "
        f"замовлень={stats['orders']}."
    )
    print(f"Користувачів до/після: {stats['users_before']} / {stats['users_after']}.")
    if stats["users_before"] != stats["users_after"]:
        print("⚠️ Кількість користувачів змінилась — перевір БД вручну.")
        return 1

    print("✅ Базу даних успішно очищено! Товари та постачальники видалені. Користувачі збережені.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
