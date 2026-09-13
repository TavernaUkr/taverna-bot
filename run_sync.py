# run_sync.py
"""
Ручний тестовий запуск синхронізації товарів постачальника з MyDrop
REST API (замінює старий run_parser.py — XML-парсинг видалено повністю).

Використання:
    python run_sync.py <supplier_id>              # ключ береться з БД (Supplier.mydrop_api_key)
    python run_sync.py <supplier_id> <api_key>     # ключ передається явно (тест без реєстрації)
"""
import asyncio
import logging
import sys
from pathlib import Path

# --- [ФІКС PYTHONPATH] ---
current_dir = Path(__file__).parent
sys.path.append(str(current_dir))
# ---

from database.db import AsyncSessionLocal
from database.models import Supplier
from services.mydrop_sync import sync_supplier_products

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main() -> None:
    if len(sys.argv) < 2:
        print("Використання: python run_sync.py <supplier_id> [mydrop_api_key]")
        sys.exit(1)

    try:
        supplier_id = int(sys.argv[1])
    except ValueError:
        print("supplier_id має бути числом (ID постачальника в нашій БД).")
        sys.exit(1)

    api_key: str | None = sys.argv[2] if len(sys.argv) > 2 else None

    if AsyncSessionLocal is None:
        print("❌ AsyncSessionLocal не інціалізовано — перевір DATABASE_URL у .env.")
        sys.exit(1)

    async with AsyncSessionLocal() as db:
        if not api_key:
            supplier = await db.get(Supplier, supplier_id)
            if not supplier:
                print(f"❌ Постачальника з id={supplier_id} не знайдено в БД.")
                sys.exit(1)
            api_key = supplier.mydrop_api_key
            if not api_key:
                print(f"❌ У постачальника #{supplier_id} не заповнено mydrop_api_key.")
                sys.exit(1)

        print(f"🚀 Синхронізую постачальника #{supplier_id} з MyDrop REST API...")
        stats = await sync_supplier_products(supplier_id, api_key, db)
        print(
            f"✅ Синхронізацію завершено: "
            f"товарів={stats['products']}, варіантів={stats['variants']}, помилок={stats['errors']}"
        )


if __name__ == "__main__":
    asyncio.run(main())
