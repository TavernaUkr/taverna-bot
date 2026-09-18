"""add supplier_history_log table for AI memory after purge

Revision ID: e4b7c2a91d03
Revises: c9e1d4a7b3f2
Create Date: 2026-09-18 23:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "e4b7c2a91d03"
down_revision: Union[str, Sequence[str], None] = "c9e1d4a7b3f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> set:
    bind = op.get_bind()
    return set(inspect(bind).get_table_names())


def upgrade() -> None:
    if "supplier_history_log" in _tables():
        return
    op.create_table(
        "supplier_history_log",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("original_supplier_id", sa.Integer(), nullable=False),
        sa.Column("supplier_name", sa.String(length=255), nullable=False),
        sa.Column("source_link", sa.Text(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("reason", sa.String(length=512), nullable=True),
    )
    op.create_index(
        "ix_supplier_history_log_original_supplier_id",
        "supplier_history_log",
        ["original_supplier_id"],
        unique=False,
    )
    op.create_index(
        "ix_supplier_history_log_source_link",
        "supplier_history_log",
        ["source_link"],
        unique=False,
    )
    op.create_index(
        "ix_supplier_history_log_deleted_at",
        "supplier_history_log",
        ["deleted_at"],
        unique=False,
    )


def downgrade() -> None:
    if "supplier_history_log" not in _tables():
        return
    op.drop_index("ix_supplier_history_log_deleted_at", table_name="supplier_history_log")
    op.drop_index("ix_supplier_history_log_source_link", table_name="supplier_history_log")
    op.drop_index("ix_supplier_history_log_original_supplier_id", table_name="supplier_history_log")
    op.drop_table("supplier_history_log")
