# database/db.py
import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from config_reader import config
from sqlalchemy import text

logger = logging.getLogger(__name__)

# Перевіряємо, чи є DATABASE_URL
if not config.database_url:
    logger.error("Критична помилка: DATABASE_URL не знайдено в .env файлі.")
    # (Ми не кидаємо Exception тут, щоб дати `models.py` шанс імпортуватися)
    engine = None
    AsyncSessionLocal = None
    Base = declarative_base() # Створюємо Base, навіть якщо engine = None
else:
    try:
        # Створюємо "двигун" (engine)
        # Ми використовуємо str() для Pydantic v2 Secret/Url типів
        engine = create_async_engine(
            str(config.database_url),
            pool_pre_ping=True,
            connect_args={"timeout": 60},
        )

        async def init_db_pragmas() -> None:
            async with engine.begin() as conn:
                await conn.execute(text("PRAGMA journal_mode=WAL;"))
                await conn.execute(text("PRAGMA synchronous=NORMAL;"))
        
        # Створюємо "фабрику" сесій
        AsyncSessionLocal = async_sessionmaker(
            bind=engine,
            class_=AsyncSession,
            expire_on_commit=False
        )
        
        # Створюємо базовий клас для наших моделей (models.py)
        Base = declarative_base()
        
        logger.info("SQLAlchemy engine та AsyncSessionLocal успішно створено.")

    except Exception as e:
        logger.error(f"Помилка створення SQLAlchemy engine: {e}")
        # Це критична помилка, бо `models.py` впаде
        Base = declarative_base() # Створюємо Base, навіть якщо engine = None
        engine = None
        AsyncSessionLocal = None

async def get_db() -> AsyncSession:
    """
    FastAPI "Dependency" для отримання сесії БД.
    """
    if AsyncSessionLocal is None:
        logger.error("Неможливо створити сесію БД: AsyncSessionLocal is None. Перевір DATABASE_URL.")
        raise Exception("Database session factory is not initialized.")
        
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

async def init_db() -> None:
    """
    Створює всі таблиці БЕЗ Alembic (для локального тесту).
    """
    if engine is None:
        logger.error("Не можу ініціалізувати БД: engine is None.")
        return

    # застосувати PRAGMA (SQLite)
    await init_db_pragmas()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)