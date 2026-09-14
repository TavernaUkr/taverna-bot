"""add is_ai_processed flag to products

Revision ID: c4f1a92b7e08
Revises: 9fab489ddcb5
Create Date: 2026-09-13 04:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c4f1a92b7e08"
down_revision: Union[str, Sequence[str], None] = "9fab489ddcb5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("products", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_ai_processed",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=False,
            )
        )
        batch_op.create_index(
            batch_op.f("ix_products_is_ai_processed"),
            ["is_ai_processed"],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("products", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_products_is_ai_processed"))
        batch_op.drop_column("is_ai_processed")
