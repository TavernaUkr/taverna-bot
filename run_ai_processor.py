# run_ai_processor.py
"""
Ручний запуск фонової AI-обробки сирих товарів (Gemini).

Використання:
    python run_ai_processor.py                 # 10 товарів
    python run_ai_processor.py 20              # 20 товарів
    python run_ai_processor.py 20 1            # 20 товарів постачальника #1
"""
import asyncio
import logging
import sys
from pathlib import Path

current_dir = Path(__file__).parent
sys.path.append(str(current_dir))

from sqlalchemy import select

from database.db import AsyncSessionLocal
from database.models import Product, ProductAIStatus
from services.ai_processor import ProductAIProcessor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 10
SLEEP_BETWEEN_REQUESTS_SEC = 4
RATE_LIMIT_SLEEP_SEC = 30


async def _fetch_next_raw_product(
    db,
    supplier_id: int | None,
    skip_ids: set[int],
) -> Product | None:
    stmt = select(Product).where(
        Product.is_ai_processed.is_(False),
        Product.ai_status.in_((ProductAIStatus.pending, ProductAIStatus.failed)),
    )
    if supplier_id is not None:
        stmt = stmt.where(Product.supplier_id == supplier_id)
    if skip_ids:
        stmt = stmt.where(Product.id.notin_(skip_ids))
    stmt = stmt.order_by(Product.id.asc()).limit(1)
    result = await db.execute(stmt)
    return result.scalars().first()


async def main() -> None:
    limit = DEFAULT_LIMIT
    supplier_id: int | None = None

    if len(sys.argv) >= 2:
        try:
            limit = max(1, int(sys.argv[1]))
        except ValueError:
            print("limit має бути числом. Приклад: python run_ai_processor.py 10")
            sys.exit(1)

    if len(sys.argv) >= 3:
        try:
            supplier_id = int(sys.argv[2])
        except ValueError:
            print("supplier_id має бути числом. Приклад: python run_ai_processor.py 10 1")
            sys.exit(1)

    if AsyncSessionLocal is None:
        print("❌ AsyncSessionLocal не ініціалізовано — перевір DATABASE_URL у .env.")
        sys.exit(1)

    processor = ProductAIProcessor()
    if not processor.is_ready:
        print("❌ GEMINI_API_KEYS відсутній або Gemini не ініціалізувався. Перевір .env.")
        sys.exit(1)

    stats = {"ok": 0, "fail": 0, "empty": 0}
    failed_ids: set[int] = set()

    async with AsyncSessionLocal() as db:
        print(
            f"🤖 AI-обробка: limit={limit}"
            + (f", supplier_id={supplier_id}" if supplier_id is not None else "")
        )

        for i in range(limit):
            product = await _fetch_next_raw_product(db, supplier_id, failed_ids)
            if product is None:
                stats["empty"] += 1
                print("ℹ️ Немає товарів з is_ai_processed=False (або всі решта в failed_ids).")
                break

            product_id = product.id
            print(f"[{i + 1}/{limit}] Обробляю товар #{product_id}: {product.name[:80]}")

            try:
                ok = await processor.process_product(product, db)
                if ok:
                    await db.commit()
                    stats["ok"] += 1
                    # 15 RPM Gemini: 4 с паузи після commit, перед наступним товаром
                    if i < limit - 1:
                        await asyncio.sleep(4)
                    continue
                else:
                    await db.rollback()
                    failed_ids.add(product_id)
                    stats["fail"] += 1
                    print(f"⚠️ Товар #{product_id} пропущено в цій сесії, беру наступний.")
            except Exception as e:
                await db.rollback()
                failed_ids.add(product_id)
                stats["fail"] += 1
                err = str(e)
                logger.error("Виняток на товарі #%s: %s", product_id, e, exc_info=True)
                print(f"⚠️ Товар #{product_id} пропущено після винятку, беру наступний.")
                if "429" in err:
                    print(f"⏳ Rate limit (429). Пауза {RATE_LIMIT_SLEEP_SEC}с...")
                    await asyncio.sleep(RATE_LIMIT_SLEEP_SEC)
                    continue

            if i < limit - 1:
                await asyncio.sleep(SLEEP_BETWEEN_REQUESTS_SEC)

    print(
        f"✅ Готово: успішно={stats['ok']}, помилок={stats['fail']}, "
        f"немає сирих={stats['empty']}"
    )


if __name__ == "__main__":
    asyncio.run(main())
