# database/db.py
import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from config_reader import config
from sqlalchemy import inspect, text

logger = logging.getLogger(__name__)

Base = declarative_base()
engine = None
AsyncSessionLocal = None


def is_postgres_url(url: str) -> bool:
    u = (url or "").lower()
    return u.startswith("postgresql") or u.startswith("postgres://")


def normalize_database_url(url: str) -> str:
    """
    Async SQLAlchemy потребує драйвер у URL:
    postgresql:// → postgresql+asyncpg://
    sqlite:// → sqlite+aiosqlite://
    """
    raw = (url or "").strip()
    lower = raw.lower()

    if lower.startswith("postgresql+asyncpg://") or lower.startswith("postgresql+psycopg://"):
        return raw
    if lower.startswith("postgresql://"):
        return "postgresql+asyncpg://" + raw[len("postgresql://"):]
    if lower.startswith("postgres://"):
        return "postgresql+asyncpg://" + raw[len("postgres://"):]
    if lower.startswith("sqlite+aiosqlite://"):
        return raw
    if lower.startswith("sqlite://"):
        return raw.replace("sqlite://", "sqlite+aiosqlite://", 1)
    return raw


def _engine_kwargs(url: str) -> dict:
    kwargs = {"pool_pre_ping": True}
    if is_postgres_url(url):
        return kwargs
    kwargs["connect_args"] = {"timeout": 60}
    return kwargs


# Перевіряємо, чи є DATABASE_URL
if not config.database_url:
    logger.error("Критична помилка: DATABASE_URL не знайдено в .env файлі.")
    # (Ми не кидаємо Exception тут, щоб дати `models.py` шанс імпортуватися)
else:
    try:
        db_url = normalize_database_url(str(config.database_url))
        engine = create_async_engine(db_url, **_engine_kwargs(db_url))

        AsyncSessionLocal = async_sessionmaker(
            bind=engine,
            class_=AsyncSession,
            expire_on_commit=False
        )

        backend = "PostgreSQL" if is_postgres_url(db_url) else "SQLite"
        logger.info("SQLAlchemy engine та AsyncSessionLocal успішно створено (%s).", backend)

    except Exception as e:
        logger.error(f"Помилка створення SQLAlchemy engine: {e}")
        engine = None
        AsyncSessionLocal = None


async def init_db_pragmas() -> None:
    """SQLite-only. Для PostgreSQL нічого не робить."""
    if engine is None:
        return
    if engine.dialect.name != "sqlite":
        return
    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA journal_mode=WAL;"))
        await conn.execute(text("PRAGMA synchronous=NORMAL;"))


async def ensure_product_ai_status_column() -> None:
    """
    Live-режим: додає ai_status, якщо колонки ще немає (без обов'язкового alembic).
    """
    if engine is None:
        return

    def _ensure(sync_conn) -> None:
        insp = inspect(sync_conn)
        if "products" not in set(insp.get_table_names()):
            return
        cols = {col["name"] for col in insp.get_columns("products")}
        if "ai_status" not in cols:
            sync_conn.execute(text(
                "ALTER TABLE products ADD COLUMN ai_status VARCHAR(32) DEFAULT 'pending' NOT NULL"
            ))
            logger.info("Додано колонку products.ai_status.")
        indexes = {idx["name"] for idx in insp.get_indexes("products")}
        if "ix_products_ai_status" not in indexes:
            try:
                sync_conn.execute(text(
                    "CREATE INDEX ix_products_ai_status ON products (ai_status)"
                ))
            except Exception:
                pass
        dialect = sync_conn.dialect.name
        if dialect == "sqlite":
            sync_conn.execute(text(
                "UPDATE products SET ai_status = 'completed' "
                "WHERE is_ai_processed = 1 AND ai_status = 'pending'"
            ))
            sync_conn.execute(text(
                "UPDATE products SET ai_status = 'pending' "
                "WHERE is_ai_processed = 0 AND (ai_status IS NULL OR ai_status = '')"
            ))
        else:
            sync_conn.execute(text(
                "UPDATE products SET ai_status = 'completed' "
                "WHERE is_ai_processed IS TRUE AND ai_status = 'pending'"
            ))
            sync_conn.execute(text(
                "UPDATE products SET ai_status = 'pending' "
                "WHERE is_ai_processed IS FALSE AND (ai_status IS NULL OR ai_status = '')"
            ))
            try:
                sync_conn.execute(text(
                    "ALTER TYPE productstatus ADD VALUE IF NOT EXISTS 'deleted'"
                ))
            except Exception:
                pass

    async with engine.begin() as conn:
        await conn.run_sync(_ensure)


async def ensure_supplier_status_timestamps() -> None:
    """Live-режим: approved_at / restored_at / deleted_at на suppliers, якщо колонок ще немає."""
    if engine is None:
        return

    def _ensure(sync_conn) -> None:
        insp = inspect(sync_conn)
        if "suppliers" not in set(insp.get_table_names()):
            return
        cols = {col["name"] for col in insp.get_columns("suppliers")}
        if "approved_at" not in cols:
            sync_conn.execute(text("ALTER TABLE suppliers ADD COLUMN approved_at DATETIME"))
            logger.info("Додано колонку suppliers.approved_at.")
        if "deleted_at" not in cols:
            sync_conn.execute(text("ALTER TABLE suppliers ADD COLUMN deleted_at DATETIME"))
            logger.info("Додано колонку suppliers.deleted_at.")
        if "restored_at" not in cols:
            sync_conn.execute(text("ALTER TABLE suppliers ADD COLUMN restored_at DATETIME"))
            logger.info("Додано колонку suppliers.restored_at.")
        if "queue_joined_at" not in cols:
            sync_conn.execute(text("ALTER TABLE suppliers ADD COLUMN queue_joined_at DATETIME"))
            logger.info("Додано колонку suppliers.queue_joined_at.")
            try:
                sync_conn.execute(text(
                    "UPDATE suppliers SET queue_joined_at = created_at "
                    "WHERE queue_joined_at IS NULL"
                ))
            except Exception:
                pass
            try:
                sync_conn.execute(text(
                    "CREATE INDEX ix_suppliers_queue_joined_at ON suppliers (queue_joined_at)"
                ))
            except Exception:
                pass

    async with engine.begin() as conn:
        await conn.run_sync(_ensure)


async def ensure_supplier_parsing_status() -> None:
    """Live-режим: значення parsing у enum статусів постачальника (PostgreSQL)."""
    if engine is None:
        return

    def _ensure(sync_conn) -> None:
        if sync_conn.dialect.name != "postgresql":
            return
        for type_name in ("supplierstatus", "supplier_status_enum"):
            try:
                sync_conn.execute(text(
                    f"ALTER TYPE {type_name} ADD VALUE IF NOT EXISTS 'parsing'"
                ))
                logger.info("Додано значення %s.parsing.", type_name)
            except Exception:
                pass

    async with engine.begin() as conn:
        await conn.run_sync(_ensure)


async def ensure_supplier_telegram_source_columns() -> None:
    """Live-режим: source_type / telegram_channel_link на suppliers, якщо колонок ще немає."""
    if engine is None:
        return

    def _ensure(sync_conn) -> None:
        insp = inspect(sync_conn)
        if "suppliers" not in set(insp.get_table_names()):
            return
        cols = {col["name"] for col in insp.get_columns("suppliers")}
        if "source_type" not in cols:
            sync_conn.execute(text(
                "ALTER TABLE suppliers ADD COLUMN source_type VARCHAR DEFAULT 'xml'"
            ))
            logger.info("Додано колонку suppliers.source_type.")
        if "telegram_channel_link" not in cols:
            sync_conn.execute(text(
                "ALTER TABLE suppliers ADD COLUMN telegram_channel_link VARCHAR"
            ))
            logger.info("Додано колонку suppliers.telegram_channel_link.")

    async with engine.begin() as conn:
        await conn.run_sync(_ensure)


async def ensure_user_settings_columns() -> None:
    """Live-режим: haptic_enabled / notifications_enabled на users, якщо колонок ще немає."""
    if engine is None:
        return

    def _ensure(sync_conn) -> None:
        insp = inspect(sync_conn)
        if "users" not in set(insp.get_table_names()):
            return
        cols = {col["name"] for col in insp.get_columns("users")}
        dialect = sync_conn.dialect.name
        bool_default = "TRUE" if dialect == "postgresql" else "1"
        if dialect == "postgresql":
            sync_conn.execute(text("SET lock_timeout = '3s'"))
        try:
            if "haptic_enabled" not in cols:
                sync_conn.execute(text(
                    f"ALTER TABLE users ADD COLUMN haptic_enabled BOOLEAN DEFAULT {bool_default}"
                ))
                logger.info("Додано колонку users.haptic_enabled.")
            if "notifications_enabled" not in cols:
                sync_conn.execute(text(
                    f"ALTER TABLE users ADD COLUMN notifications_enabled BOOLEAN DEFAULT {bool_default}"
                ))
                logger.info("Додано колонку users.notifications_enabled.")
        except Exception as e:
            logger.warning("Не вдалося додати колонки налаштувань users: %s", e)

    async with engine.begin() as conn:
        await conn.run_sync(_ensure)


async def ensure_ai_categorization_rules_table() -> None:
    """Live-режим: таблиця ai_categorization_rules, якщо її ще немає."""
    if engine is None:
        return

    def _ensure(sync_conn) -> None:
        insp = inspect(sync_conn)
        if "ai_categorization_rules" in set(insp.get_table_names()):
            return
        from database.models import AICategorizationRule
        AICategorizationRule.__table__.create(bind=sync_conn, checkfirst=True)
        logger.info("Створено таблицю ai_categorization_rules.")

    async with engine.begin() as conn:
        await conn.run_sync(_ensure)


async def ensure_supplier_history_log_table() -> None:
    """Live-режим: таблиця supplier_history_log, якщо її ще немає."""
    if engine is None:
        return

    def _ensure(sync_conn) -> None:
        insp = inspect(sync_conn)
        if "supplier_history_log" in set(insp.get_table_names()):
            return
        from database.models import SupplierHistoryLog
        SupplierHistoryLog.__table__.create(bind=sync_conn, checkfirst=True)
        logger.info("Створено таблицю supplier_history_log.")

    async with engine.begin() as conn:
        await conn.run_sync(_ensure)


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

    await init_db_pragmas()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await ensure_supplier_status_timestamps()
    await ensure_user_settings_columns()
    await ensure_supplier_telegram_source_columns()
    await ensure_supplier_parsing_status()
    await ensure_ai_categorization_rules_table()
    await ensure_supplier_history_log_table()
