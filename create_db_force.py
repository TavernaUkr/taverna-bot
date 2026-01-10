# create_db_force.py
import asyncio
import logging
import sys
from pathlib import Path

# --- [ФІКС PYTHONPATH] ---
current_dir = Path(__file__).parent
sys.path.append(str(current_dir))
# --- [КІНЕЦЬ ФІКСУ] ---

from database.db import init_db, engine, Base
from database import models # <-- ВАЖЛИВО: Імпортуємо моделі, щоб Base їх "побачив"

logging.basicConfig(level=logging.INFO)

async def main():
    if engine is None:
        print("❌ Помилка: Не вдалося створити 'engine' в db.py. Перевір DATABASE_URL в .env")
        return
        
    print("🚀 Примусове створення бази даних (Direct SQLAlchemy)...")
    
    # Ця команда створить ВСІ таблиці, які знає `Base` (з `models.py`)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
    print("🏁 Готово! Таблиці створено (включаючи suppliers.key та suppliers.user_id).")

if __name__ == "__main__":
    asyncio.run(main())