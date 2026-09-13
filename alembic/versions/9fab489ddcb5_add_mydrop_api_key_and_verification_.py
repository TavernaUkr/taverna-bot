"""add mydrop api key and verification fields to supplier

Revision ID: 9fab489ddcb5
Revises: e03e5517cb5c
Create Date: 2026-09-13 02:31:27.838229

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9fab489ddcb5'
down_revision: Union[str, Sequence[str], None] = 'e03e5517cb5c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("suppliers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("mydrop_api_key", sa.String(length=255), nullable=True))
        batch_op.add_column(
            sa.Column(
                "mydrop_api_key_verified",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=False,
            )
        )
        batch_op.add_column(sa.Column("mydrop_api_key_verified_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("suppliers", schema=None) as batch_op:
        batch_op.drop_column("mydrop_api_key_verified_at")
        batch_op.drop_column("mydrop_api_key_verified")
        batch_op.drop_column("mydrop_api_key")
