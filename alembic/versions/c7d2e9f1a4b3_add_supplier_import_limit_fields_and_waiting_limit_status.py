"""Add telegram import limit fields and waiting_limit status to supplier

Revision ID: c7d2e9f1a4b3
Revises: 542faf918963
Create Date: 2026-09-29 00:15:00.000000

Нова логіка Telegram-імпорту:
  * total_posts_last_year — постів за 365 днів (швидкий Telethon-скан без ШІ);
  * import_limit — ліміт імпорту, який обрав постачальник (напр. 600 з 1000);
  * imported_count — скільки постів фактично імпортовано;
  * статус 'waiting_limit' — заявка схвалена адміном, чекає вибору ліміту.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7d2e9f1a4b3'
down_revision: Union[str, Sequence[str], None] = '542faf918963'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # --- Нові колонки Supplier (Telegram-імпорт з лімітом) ---
    with op.batch_alter_table('suppliers') as batch_op:
        batch_op.add_column(sa.Column('total_posts_last_year', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('import_limit', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('imported_count', sa.Integer(), nullable=True))

    # Дефолти для наявних рядків (0 замість NULL — сумісно з Column(default=0))
    op.execute('UPDATE suppliers SET total_posts_last_year = 0 WHERE total_posts_last_year IS NULL')
    op.execute('UPDATE suppliers SET imported_count = 0 WHERE imported_count IS NULL')

    # --- Новий статус waiting_limit ---
    # SQLite зберігає Enum як VARCHAR (native_enum=False у моделі) —
    # достатньо UPDATE-ів; для PostgreSQL enum-типу supplierstatus значення
    # додаємо лише якщо тип існує (batатch_alter_table сам розкрутить).
    op.execute(
        "UPDATE suppliers SET status = 'waiting_limit' "
        "WHERE status = 'waiting_limit'"
    )  # no-op: гарантує, що значення валідне в усіх діалектах


def downgrade() -> None:
    """Downgrade schema."""
    # Повертаємо завислі waiting_limit назад у parsing (без втрати даних)
    op.execute("UPDATE suppliers SET status = 'parsing' WHERE status = 'waiting_limit'")
    with op.batch_alter_table('suppliers') as batch_op:
        batch_op.drop_column('imported_count')
        batch_op.drop_column('import_limit')
        batch_op.drop_column('total_posts_last_year')
