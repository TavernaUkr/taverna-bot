"""add pim fields to products

Revision ID: 4c7eb32c5e20
Revises: b7e3c1a04d92
Create Date: 2026-09-13 22:40:53.946892

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4c7eb32c5e20"
down_revision: Union[str, Sequence[str], None] = "b7e3c1a04d92"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("products", schema=None) as batch_op:
        batch_op.add_column(sa.Column("target_niche", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("gender", sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column("attributes", sa.JSON(), nullable=True))
        batch_op.create_index(batch_op.f("ix_products_gender"), ["gender"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_products_target_niche"),
            ["target_niche"],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("products", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_products_target_niche"))
        batch_op.drop_index(batch_op.f("ix_products_gender"))
        batch_op.drop_column("attributes")
        batch_op.drop_column("gender")
        batch_op.drop_column("target_niche")
