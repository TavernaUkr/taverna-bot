"""
Аварійне розблокування магазинів, завислих у статусі `parsing`.

Запуск (вручну, з кореня проєкту):
    python unstick.py          — розблокувати ВСІ завислі parsing-магазини
    python unstick.py 2 5      — розблокувати лише магазини #2 і #5

Коли використовувати:
  * Парсер упав на 503/таймауті ДО того, як finally встиг повернути active
    (наприклад, жорсткий kill процесу під час імпорту).
  * Автоматичні гарантії: telegram_sync.py / mydrop_sync.py самі повертають
    parsing→active у finally; AI-черга (ai_queue_worker.py) обходить завислий
    магазин і обробляє інші — цей скрипт лише підстрахова на випадок
    жорсткого крашу процесу.
"""
import asyncio
import sys

from sqlalchemy import select

from database.db import AsyncSessionLocal
from database.models import Supplier, SupplierStatus


async def main() -> None:
    # Опційні аргументи: конкретні ID магазинів (unstick.py 2 5).
    only_ids: set[int] = set()
    for arg in sys.argv[1:]:
        if arg.strip().isdigit():
            only_ids.add(int(arg))

    async with AsyncSessionLocal() as db:
        stmt = select(Supplier).where(Supplier.status == SupplierStatus.parsing)
        stuck = (await db.execute(stmt)).scalars().all()

        if only_ids:
            stuck = [s for s in stuck if int(s.id) in only_ids]

        if not stuck:
            print("Немає магазинів у статусі parsing — розблоковувати нічого.")
            return

        for shop in stuck:
            shop.status = SupplierStatus.active
            print(f"✅ Магазин #{shop.id} ({shop.store_name or shop.name}): parsing → active")

        await db.commit()
        print(f"Розблоковано магазинів: {len(stuck)}.")


if __name__ == "__main__":
    asyncio.run(main())
