# alembic/env.py
import asyncio
from logging.config import fileConfig

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import pool

from alembic import context

# --- НОВІ ІМПОРТИ ---
import sys
from pathlib import Path

# Додаємо корінь проекту (D:\TavernaBot) до шляхів Python
sys.path.append(str(Path(__file__).parent.parent))
# ---

# Імпортуємо моделі ТА конфіг
from models.base import Base # Завдяки sys.path.append
from config_reader import config # Завдяки sys.path.append
# ---

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config_obj = context.config # Перейменовуємо, щоб не було конфлікту з 'config' з config_reader

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config_obj.config_file_name is not None:
    fileConfig(config_obj.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata

# --- ВИПРАВЛЕННЯ ---
# 1. Отримуємо URL з нашого config_reader'а
db_url_object = config.database_url
db_url_str = None

if db_url_object:
    # 2. Одразу перетворюємо на РЯДОК
    db_url_str = str(db_url_object)

# 3. Перевіряємо РЯДОК
if not db_url_str or "user:password@host:port/dbname" in db_url_str:
    raise ValueError(
        "DATABASE_URL не налаштовано коректно у .env файлі. "
        "Alembic не може продовжити."
    )

# 4. Передаємо РЯДОК (db_url_str) в Alembic
config_obj.set_main_option('sqlalchemy.url', db_url_str)
# --- КІНЕЦЬ ВИПРАВЛЕННЯ ---


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.
    # ... (решта файлу залишається без змін) ...
    """
    url = config_obj.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations in 'online' mode.
    # ... (решта файлу залишається без змін) ...
    """
    
    # Використовуємо наш `engine` з `models/base.py`
    from models.base import engine
    
    if engine is None:
        raise Exception("Engine in models/base.py is None. Check DATABASE_URL.")

    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())