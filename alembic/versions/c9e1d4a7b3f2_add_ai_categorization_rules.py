"""add ai_categorization_rules table

Revision ID: c9e1d4a7b3f2
Revises: 8f3c2a91b4d7
Create Date: 2026-09-18 00:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "c9e1d4a7b3f2"
down_revision: Union[str, Sequence[str], None] = "8f3c2a91b4d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> set:
    bind = op.get_bind()
    return set(inspect(bind).get_table_names())


def upgrade() -> None:
    if "ai_categorization_rules" in _tables():
        return
    op.create_table(
        "ai_categorization_rules",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("keyword", sa.String(length=255), nullable=False),
        sa.Column("correct_category", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_ai_categorization_rules_keyword",
        "ai_categorization_rules",
        ["keyword"],
        unique=False,
    )


def downgrade() -> None:
    if "ai_categorization_rules" not in _tables():
        return
    op.drop_index("ix_ai_categorization_rules_keyword", table_name="ai_categorization_rules")
    op.drop_table("ai_categorization_rules")
