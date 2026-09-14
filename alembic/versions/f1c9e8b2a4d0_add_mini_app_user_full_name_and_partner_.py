"""add mini app user full_name and partner fields

Revision ID: f1c9e8b2a4d0
Revises: 4c7eb32c5e20
Create Date: 2026-09-14 20:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision: str = "f1c9e8b2a4d0"
down_revision: Union[str, Sequence[str], None] = "4c7eb32c5e20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set:
    bind = op.get_bind()
    names = set(inspect(bind).get_table_names())
    if table not in names:
        return set()
    return {col["name"] for col in inspect(bind).get_columns(table)}


def _pg_add_enum_value(type_name: str, value: str) -> None:
    op.execute(text(f"ALTER TYPE {type_name} ADD VALUE IF NOT EXISTS '{value}'"))


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    user_cols = _columns("users")
    supplier_cols = _columns("suppliers")

    if dialect == "postgresql":
        for type_name in ("userrole", "user_role"):
            exists = bind.execute(
                text("SELECT 1 FROM pg_type WHERE typname = :n"),
                {"n": type_name},
            ).fetchone()
            if exists:
                _pg_add_enum_value(type_name, "client")

    if "users" in inspect(bind).get_table_names() and "full_name" not in user_cols:
        with op.batch_alter_table("users", schema=None) as batch_op:
            batch_op.add_column(sa.Column("full_name", sa.String(length=255), nullable=True))

    supplier_new = []
    if "supplier_type" not in supplier_cols:
        supplier_new.append(
            sa.Column("supplier_type", sa.String(length=32), nullable=True)
        )
    if "yml_link" not in supplier_cols:
        supplier_new.append(sa.Column("yml_link", sa.Text(), nullable=True))
    if "channel_link" not in supplier_cols:
        supplier_new.append(sa.Column("channel_link", sa.String(length=255), nullable=True))
    if "is_verified" not in supplier_cols:
        supplier_new.append(
            sa.Column(
                "is_verified",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            )
        )

    if supplier_new:
        with op.batch_alter_table("suppliers", schema=None) as batch_op:
            for col in supplier_new:
                batch_op.add_column(col)


def downgrade() -> None:
    supplier_cols = _columns("suppliers")
    user_cols = _columns("users")

    drop_supplier = [
        name
        for name in ("is_verified", "channel_link", "yml_link", "supplier_type")
        if name in supplier_cols
    ]
    if drop_supplier:
        with op.batch_alter_table("suppliers", schema=None) as batch_op:
            for name in drop_supplier:
                batch_op.drop_column(name)

    if "full_name" in user_cols:
        with op.batch_alter_table("users", schema=None) as batch_op:
            batch_op.drop_column("full_name")
