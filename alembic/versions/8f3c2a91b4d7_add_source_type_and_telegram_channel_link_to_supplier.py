"""add source_type and telegram_channel_link to supplier

Revision ID: 8f3c2a91b4d7
Revises: d2a4b6c8e0f1
Create Date: 2026-09-17 23:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "8f3c2a91b4d7"
down_revision: Union[str, Sequence[str], None] = "d2a4b6c8e0f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_COLUMNS = (
    (
        "source_type",
        sa.Column("source_type", sa.String(), nullable=True, server_default="xml"),
    ),
    (
        "telegram_channel_link",
        sa.Column("telegram_channel_link", sa.String(), nullable=True),
    ),
)


def _columns(table: str) -> set:
    bind = op.get_bind()
    names = set(inspect(bind).get_table_names())
    if table not in names:
        return set()
    return {col["name"] for col in inspect(bind).get_columns(table)}


def upgrade() -> None:
    existing = _columns("suppliers")
    to_add = [col for name, col in NEW_COLUMNS if name not in existing]
    if not to_add:
        return
    with op.batch_alter_table("suppliers", schema=None) as batch_op:
        for col in to_add:
            batch_op.add_column(col)


def downgrade() -> None:
    existing = _columns("suppliers")
    drop_cols = [name for name, _col in reversed(NEW_COLUMNS) if name in existing]
    if not drop_cols:
        return
    with op.batch_alter_table("suppliers", schema=None) as batch_op:
        for name in drop_cols:
            batch_op.drop_column(name)
