# models/channel.py
from sqlalchemy import Column, BigInteger, String, Boolean, Integer, ForeignKey
from sqlalchemy.orm import relationship
from .base import Base

class Channel(Base):
    __tablename__ = 'channels'

    id = Column(Integer, primary_key=True)
    telegram_id = Column(BigInteger, nullable=False, unique=True, index=True) # ID каналу/чату
    name = Column(String(255), nullable=False) # Назва (напр. "Тактичний Одяг")
    is_category_channel = Column(Boolean, default=True) # Чи це канал для товарів
    is_chat = Column(Boolean, default=False) # Чи це чат (напр. Відгуки)

    # Зв'язок з постачальниками (які можуть сюди постити)
    suppliers = relationship("Supplier", secondary="supplier_channels", back_populates="channels")

class SupplierChannel(Base):
    __tablename__ = 'supplier_channels'

    supplier_id = Column(Integer, ForeignKey('suppliers.id'), primary_key=True)
    channel_id = Column(Integer, ForeignKey('channels.id'), primary_key=True)