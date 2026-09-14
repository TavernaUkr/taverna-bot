"""add supplier application scoring fields

Revision ID: a2b8f0c91e11
Revises: f1c9e8b2a4d0
Create Date: 2026-09-14 21:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "a2b8f0c91e11"
down_revision: Union[str, Sequence[str], None] = "f1c9e8b2a4d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_COLUMNS = (
    ("edrpou_ipn", sa.Column("edrpou_ipn", sa.String(length=32), nullable=True)),
    ("email", sa.Column("email", sa.String(length=255), nullable=True)),
    ("phone", sa.Column("phone", sa.String(length=32), nullable=True)),
    ("manager_telegram", sa.Column("manager_telegram", sa.String(length=100), nullable=True)),
    ("store_name", sa.Column("store_name", sa.String(length=255), nullable=True)),
    ("store_description", sa.Column("store_description", sa.Text(), nullable=True)),
    ("iban", sa.Column("iban", sa.String(length=64), nullable=True)),
    ("bank_name", sa.Column("bank_name", sa.String(length=255), nullable=True)),
    ("trial_ends_at", sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True)),
    ("ai_score_report", sa.Column("ai_score_report", sa.Text(), nullable=True)),
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
        if "edrpou_ipn" not in existing:
            batch_op.create_index(
                batch_op.f("ix_suppliers_edrpou_ipn"),
                ["edrpou_ipn"],
                unique=False,
            )


def downgrade() -> None:
    existing = _columns("suppliers")
    with op.batch_alter_table("suppliers", schema=None) as batch_op:
        if "edrpou_ipn" in existing:
            batch_op.drop_index(batch_op.f("ix_suppliers_edrpou_ipn"))
        for name, _col in reversed(NEW_COLUMNS):
            if name in existing:
                batch_op.drop_column(name)
