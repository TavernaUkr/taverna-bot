# models/supplier.py
from sqlalchemy import Column, Integer, String, Enum as SQLAlchemyEnum, DateTime, Text, Boolean, BigInteger
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from enum import Enum
from .base import Base

# Використовуємо str Enum для легшої серіалізації та записів у БД
class SupplierType(str, Enum):
    MYDROP = 'mydrop'
    INDEPENDENT = 'independent'

class SupplierStatus(str, Enum):
    PENDING = 'pending' # Очікує підтвердження адміном
    ACTIVE = 'active'   # Активний
    BLOCKED = 'blocked' # Заблокований (адміном або за порушення)

class Supplier(Base):
    __tablename__ = 'suppliers'

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False, index=True) # Назва магазину
    type = Column(SQLAlchemyEnum(SupplierType, name="supplier_type_enum"), nullable=False, default=SupplierType.INDEPENDENT)
    status = Column(SQLAlchemyEnum(SupplierStatus, name="supplier_status_enum"), nullable=False, default=SupplierStatus.PENDING, index=True)

    # Дані власника/контактної особи
    owner_pib = Column(String(255), nullable=True)
    owner_phone = Column(String(20), nullable=True)
    owner_email = Column(String(255), unique=True, index=True, nullable=True) # Email має бути унікальним
    # Використовуємо BigInteger для ID чату/користувача Telegram
    contact_telegram_id = Column(BigInteger, index=True, nullable=True) # ID для сповіщень менеджеру

    # Верифікація
    verification_code = Column(String(10), nullable=True) # Код для SMS/Email
    is_verified = Column(Boolean, default=False, nullable=False) # Чи підтвердив контакти

    # Специфічні налаштування джерел даних
    mydrop_api_key = Column(String(255), nullable=True) # Тільки для MyDrop
    xml_url = Column(Text, nullable=True) # Тільки для MyDrop
    website_url = Column(Text, nullable=True) # URL сайту/сторінки для Independent

    # Зв'язок з каналами
    channels = relationship("Channel", secondary="supplier_channels", back_populates="suppliers")
    # Зв'язок з продуктами
    products = relationship("Product", back_populates="supplier", cascade="all, delete-orphan")

    # Фінансові дані
    bank_details = Column(Text, nullable=True) # IBAN або номер картки для виплат

    # Технічні поля
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Додаємо server_default=func.now() щоб поле заповнювалось при створенні
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    def __repr__(self):
        return f"<Supplier(id={self.id}, name='{self.name}', type='{self.type.value}')>"