# models/user.py
from sqlalchemy import Column, BigInteger, String, Integer, Boolean, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .base import Base

class User(Base):
    __tablename__ = 'users'

    telegram_id = Column(BigInteger, primary_key=True) # Telegram IDs можуть бути великими
    full_name = Column(String(255), nullable=True) # Ім'я з Telegram
    username = Column(String(100), nullable=True, index=True) # Username з Telegram
    loyalty_points = Column(Integer, default=0, nullable=False)
    # Чи пройшов користувач реєстрацію в боті для програми лояльності тощо
    is_registered_customer = Column(Boolean, default=False, nullable=False)

    # Зв'язок з замовленнями
    orders = relationship("Order", back_populates="user")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    def __repr__(self):
        return f"<User(telegram_id={self.telegram_id}, username='{self.username}')>"