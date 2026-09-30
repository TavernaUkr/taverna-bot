"""add notifications table (global bell for Mini App)

Revision ID: e5f7a8b9c0d1
Revises: b8f1a2c3d4e5
Create Date: 2026-09-30 00:10:00.000000

Глобальна система сповіщень («Дзвоник») Mini App:
  * notifications — сповіщення користувача (причина відхилення заявки
    постачальника, майбутні: статуси замовлень, фото-докази тощо).
    image_url підготовлений до майбутнього завантаження фото через адмінку.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f7a8b9c0d1'
down_revision: Union[str, Sequence[str], None] = 'b8f1a2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'notifications',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'user_id',
            sa.BigInteger(),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('image_url', sa.String(), nullable=True),
        sa.Column(
            'is_read',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index('ix_notifications_user_id', 'notifications', ['user_id'])
    op.create_index('ix_notifications_is_read', 'notifications', ['is_read'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_notifications_is_read', table_name='notifications')
    op.drop_index('ix_notifications_user_id', table_name='notifications')
    op.drop_table('notifications')
