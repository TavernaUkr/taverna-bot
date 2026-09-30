"""Add rejection_reason to supplier (admin reject flow)

Revision ID: b8f1a2c3d4e5
Revises: c7d2e9f1a4b3
Create Date: 2026-09-29 23:15:00.000000

Причина відхилення заявки адміном:
  * suppliers.rejection_reason — текст причини (nullable), який адмін
    вказує при reject; разом із Role Reversion (User.role → client),
    якщо в користувача не лишилось жодного «живого» магазину.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8f1a2c3d4e5'
down_revision: Union[str, Sequence[str], None] = 'c7d2e9f1a4b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('suppliers') as batch_op:
        batch_op.add_column(sa.Column('rejection_reason', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('suppliers') as batch_op:
        batch_op.drop_column('rejection_reason')
