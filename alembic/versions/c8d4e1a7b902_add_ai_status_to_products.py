"""add ai_status queue column to products

Revision ID: c8d4e1a7b902
Revises: a2b8f0c91e11
Create Date: 2026-09-15 21:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision: str = "c8d4e1a7b902"
down_revision: Union[str, Sequence[str], None] = "a2b8f0c91e11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set:
    bind = op.get_bind()
    names = set(inspect(bind).get_table_names())
    if table not in names:
        return set()
    return {col["name"] for col in inspect(bind).get_columns(table)}


def upgrade() -> None:
    existing = _columns("products")
    if "ai_status" not in existing:
        with op.batch_alter_table("products", schema=None) as batch_op:
            batch_op.add_column(
                sa.Column(
                    "ai_status",
                    sa.String(length=32),
                    nullable=False,
                    server_default="pending",
                )
            )
            batch_op.create_index(
                batch_op.f("ix_products_ai_status"),
                ["ai_status"],
                unique=False,
            )

    bind = op.get_bind()
    bind.execute(text(
        "UPDATE products SET ai_status = 'completed' "
        "WHERE is_ai_processed = 1 OR is_ai_processed = true"
    ))
    bind.execute(text(
        "UPDATE products SET ai_status = 'pending' "
        "WHERE (is_ai_processed = 0 OR is_ai_processed = false) "
        "AND (ai_status IS NULL OR ai_status = '')"
    ))


def downgrade() -> None:
    existing = _columns("products")
    if "ai_status" not in existing:
        return
    with op.batch_alter_table("products", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_products_ai_status"))
        batch_op.drop_column("ai_status")
