"""add sub_category and season to products

Revision ID: b7e3c1a04d92
Revises: c4f1a92b7e08
Create Date: 2026-09-13 21:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b7e3c1a04d92"
down_revision: Union[str, Sequence[str], None] = "c4f1a92b7e08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("products", schema=None) as batch_op:
        batch_op.add_column(sa.Column("sub_category", sa.String(length=150), nullable=True))
        batch_op.add_column(sa.Column("season", sa.String(length=50), nullable=True))
        batch_op.create_index(
            batch_op.f("ix_products_sub_category"),
            ["sub_category"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_products_season"),
            ["season"],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("products", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_products_season"))
        batch_op.drop_index(batch_op.f("ix_products_sub_category"))
        batch_op.drop_column("season")
        batch_op.drop_column("sub_category")
