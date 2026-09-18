"""add supplier queue_joined_at for FIFO restore order

Revision ID: f6d9e4c13a20
Revises: e4b7c2a91d03
Create Date: 2026-09-18 23:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision: str = "f6d9e4c13a20"
down_revision: Union[str, Sequence[str], None] = "e4b7c2a91d03"
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
    if "queue_joined_at" not in existing:
        with op.batch_alter_table("suppliers", schema=None) as batch_op:
            batch_op.add_column(
                sa.Column("queue_joined_at", sa.DateTime(timezone=True), nullable=True)
            )
            batch_op.create_index(
                batch_op.f("ix_suppliers_queue_joined_at"),
                ["queue_joined_at"],
                unique=False,
            )
    bind = op.get_bind()
    bind.execute(text(
        "UPDATE suppliers SET queue_joined_at = created_at "
        "WHERE queue_joined_at IS NULL"
    ))


def downgrade() -> None:
    existing = _columns("suppliers")
    if "queue_joined_at" not in existing:
        return
    with op.batch_alter_table("suppliers", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_suppliers_queue_joined_at"))
        batch_op.drop_column("queue_joined_at")
