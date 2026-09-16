"""add user haptic_enabled and notifications_enabled

Revision ID: d2a4b6c8e0f1
Revises: c8d4e1a7b902
Create Date: 2026-09-16 15:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "d2a4b6c8e0f1"
down_revision: Union[str, Sequence[str], None] = "c8d4e1a7b902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set:
    bind = op.get_bind()
    names = set(inspect(bind).get_table_names())
    if table not in names:
        return set()
    return {col["name"] for col in inspect(bind).get_columns(table)}


def upgrade() -> None:
    existing = _columns("users")
    new_cols = []
    if "haptic_enabled" not in existing:
        new_cols.append(
            sa.Column(
                "haptic_enabled",
                sa.Boolean(),
                nullable=True,
                server_default=sa.true(),
            )
        )
    if "notifications_enabled" not in existing:
        new_cols.append(
            sa.Column(
                "notifications_enabled",
                sa.Boolean(),
                nullable=True,
                server_default=sa.true(),
            )
        )
    if not new_cols:
        return
    with op.batch_alter_table("users", schema=None) as batch_op:
        for col in new_cols:
            batch_op.add_column(col)


def downgrade() -> None:
    existing = _columns("users")
    drop_cols = [
        name for name in ("haptic_enabled", "notifications_enabled") if name in existing
    ]
    if not drop_cols:
        return
    with op.batch_alter_table("users", schema=None) as batch_op:
        for name in drop_cols:
            batch_op.drop_column(name)
