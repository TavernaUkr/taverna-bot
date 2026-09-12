"""sync_models_with_frontend

Revision ID: e03e5517cb5c
Revises: 19fa5f8d5a64
Create Date: 2026-09-12 22:22:34.614559

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


# revision identifiers, used by Alembic.
revision: str = 'e03e5517cb5c'
down_revision: Union[str, Sequence[str], None] = '19fa5f8d5a64'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_ORDER_STATUSES = (
    "new",
    "pending",
    "confirmed",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
    "returned",
)


def _table_names() -> set:
    return set(inspect(op.get_bind()).get_table_names())


def _remap_legacy_statuses() -> None:
    """completed → delivered, canceled → cancelled. Працює на VARCHAR і після ADD VALUE в PG."""
    tables = _table_names()
    if "orders" in tables:
        op.execute(text(
            "UPDATE orders SET status = 'delivered' "
            "WHERE status IN ('completed', 'COMPLETED')"
        ))
        op.execute(text(
            "UPDATE orders SET status = 'cancelled' "
            "WHERE status IN ('canceled', 'CANCELED')"
        ))
    if "order_items" in tables:
        op.execute(text(
            "UPDATE order_items SET status = 'delivered' "
            "WHERE status IN ('completed', 'COMPLETED')"
        ))
        op.execute(text(
            "UPDATE order_items SET status = 'cancelled' "
            "WHERE status IN ('canceled', 'CANCELED')"
        ))


def _pg_udt_name(conn, table: str, column: str):
    row = conn.execute(text(
        "SELECT udt_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": column}).fetchone()
    return row[0] if row else None


def _pg_prepare_orderstatus_enum() -> None:
    """
    PostgreSQL не дає UPDATE на нове значення enum, поки його немає в типі.
    1) додаємо нові значення в існуючий тип (якщо він є)
    2) далі _remap_legacy_statuses() уже може писати delivered/cancelled
    3) після data-migration перестворюємо тип без старих completed/canceled
    """
    conn = op.get_bind()
    udt = _pg_udt_name(conn, "orders", "status")
    if not udt or udt in ("varchar", "text", "bpchar"):
        return

    for value in NEW_ORDER_STATUSES:
        op.execute(text(
            f"ALTER TYPE {udt} ADD VALUE IF NOT EXISTS '{value}'"
        ))


def _pg_rebuild_orderstatus_enum() -> None:
    conn = op.get_bind()
    udt = _pg_udt_name(conn, "orders", "status")
    if not udt or udt in ("varchar", "text", "bpchar"):
        return

    values_sql = ", ".join(f"'{v}'" for v in NEW_ORDER_STATUSES)
    op.execute(text("ALTER TYPE {udt} RENAME TO orderstatus_old".format(udt=udt)))
    op.execute(text(f"CREATE TYPE orderstatus AS ENUM ({values_sql})"))
    op.execute(text(
        "ALTER TABLE orders ALTER COLUMN status TYPE orderstatus "
        "USING ("
        "  CASE"
        "    WHEN status::text IN ('completed', 'COMPLETED') THEN 'delivered'"
        "    WHEN status::text IN ('canceled', 'CANCELED') THEN 'cancelled'"
        "    ELSE status::text"
        "  END"
        ")::orderstatus"
    ))
    op.execute(text("DROP TYPE orderstatus_old"))


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    dialect = conn.dialect.name

    # --- Data migration ---
    # PG: спочатку нові значення enum, інакше UPDATE на delivered/cancelled впаде.
    if dialect == "postgresql":
        _pg_prepare_orderstatus_enum()

    _remap_legacy_statuses()

    if dialect == "postgresql":
        _pg_rebuild_orderstatus_enum()

    # --- Schema ---
    op.create_table(
        "bonus_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_telegram_id", sa.BigInteger(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["user_telegram_id"], ["users.telegram_id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("bonus_history", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_bonus_history_user_telegram_id"),
            ["user_telegram_id"],
            unique=False,
        )

    with op.batch_alter_table("orders", schema=None) as batch_op:
        batch_op.add_column(sa.Column("subtotal", sa.Float(), server_default="0", nullable=False))
        batch_op.add_column(sa.Column("delivery_cost", sa.Float(), server_default="0", nullable=False))
        batch_op.add_column(sa.Column("warehouse_ref", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("tracking_status", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("last_tracking_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
        if dialect != "postgresql":
            batch_op.alter_column(
                "status",
                existing_type=sa.VARCHAR(length=9),
                type_=sa.String(length=20),
                existing_nullable=True,
            )
        batch_op.create_index(
            batch_op.f("ix_orders_tracking_status"),
            ["tracking_status"],
            unique=False,
        )

    with op.batch_alter_table("products", schema=None) as batch_op:
        batch_op.add_column(sa.Column("brand", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("model", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("ai_category", sa.String(length=255), nullable=True))
        batch_op.create_index(
            batch_op.f("ix_products_ai_category"),
            ["ai_category"],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("products", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_products_ai_category"))
        batch_op.drop_column("ai_category")
        batch_op.drop_column("model")
        batch_op.drop_column("brand")

    dialect = op.get_bind().dialect.name
    with op.batch_alter_table("orders", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_orders_tracking_status"))
        if dialect != "postgresql":
            batch_op.alter_column(
                "status",
                existing_type=sa.String(length=20),
                type_=sa.VARCHAR(length=9),
                existing_nullable=True,
            )
        batch_op.drop_column("updated_at")
        batch_op.drop_column("last_tracking_at")
        batch_op.drop_column("tracking_status")
        batch_op.drop_column("warehouse_ref")
        batch_op.drop_column("delivery_cost")
        batch_op.drop_column("subtotal")

    with op.batch_alter_table("bonus_history", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_bonus_history_user_telegram_id"))

    op.drop_table("bonus_history")
