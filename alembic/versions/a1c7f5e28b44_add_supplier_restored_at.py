"""add supplier restored_at timestamp

Revision ID: a1c7f5e28b44
Revises: f6d9e4c13a20
Create Date: 2026-09-19 00:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "a1c7f5e28b44"
down_revision: Union[str, Sequence[str], None] = "f6d9e4c13a20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set:
    bind = op.get_bind()
    names = set(inspect(bind).get_table_names())
    if table not in names:
        return set()
    return {col["name"] for col in inspect(bind).get_columns(table)}


def upgrade() -> None:
    existing = _columns("suppliers")
    if "restored_at" not in existing:
        with op.batch_alter_table("suppliers", schema=None) as batch_op:
            batch_op.add_column(
                sa.Column("restored_at", sa.DateTime(timezone=True), nullable=True)
            )


def downgrade() -> None:
    existing = _columns("suppliers")
    if "restored_at" not in existing:
        return
    with op.batch_alter_table("suppliers", schema=None) as batch_op:
        batch_op.drop_column("restored_at")
