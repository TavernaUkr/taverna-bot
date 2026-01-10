# models/base.py
import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from config_reader import config

logger = logging.getLogger(__name__)

# --- ВИПРАВЛЕННЯ ---
# 1. Отримуємо URL з конфігу
db_url_object = config.database_url

engine = None
async_session_maker = None

# 2. Перевіряємо, чи URL взагалі існує
if db_url_object:
    # 3. Перетворюємо на РЯДОК (str) ОДИН РАЗ
    db_url_str = str(db_url_object)
    
    # 4. Використовуємо РЯДОК (db_url_str) для всіх операцій
    if "user:password@host:port/dbname" not in db_url_str:
        try:
            engine = create_async_engine(db_url_str, echo=False)
            async_session_maker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            logger.info("SQLAlchemy engine та session maker створено успішно.")
        except Exception as e:
            logger.error(f"Помилка створення SQLAlchemy engine: {e}")
    else:
        logger.warning("Використовується DATABASE_URL за замовчуванням. Пропуск створення engine.")
else:
    logger.error("DATABASE_URL не знайдено в конфігурації.")
# --- КІНЕЦЬ ВИПРАВЛЕННЯ ---


Base = declarative_base()

async def get_async_session():
    if not async_session_maker:
        logger.error("Session maker не ініціалізовано!")
        yield None
    else:
        async with async_session_maker() as session:
            yield session