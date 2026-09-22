"""add_manager_invites

Revision ID: 542faf918963
Revises: a1c7f5e28b44
Create Date: 2026-09-23 00:12:08.550308

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '542faf918963'
down_revision: Union[str, Sequence[str], None] = 'a1c7f5e28b44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Примітка: alter_column для orders.status та products.status,
    # які автогенерував Alembic (порівняння Enum у SQLite), свідомо прибрано —
    # це хибні зміни, реально колонки не змінювались.
    op.create_table('manager_invites',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('token', sa.String(length=100), nullable=False),
    sa.Column('supplier_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('is_used', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['supplier_id'], ['suppliers.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('manager_invites', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_manager_invites_supplier_id'), ['supplier_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_manager_invites_token'), ['token'], unique=True)

    op.create_table('supplier_managers',
    sa.Column('supplier_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['supplier_id'], ['suppliers.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('supplier_id', 'user_id')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('supplier_managers')
    with op.batch_alter_table('manager_invites', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_manager_invites_token'))
        batch_op.drop_index(batch_op.f('ix_manager_invites_supplier_id'))

    op.drop_table('manager_invites')
