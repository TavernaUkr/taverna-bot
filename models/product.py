# models/product.py
from sqlalchemy import Column, Integer, String, Text, Enum as SQLAlchemyEnum, \
                     ForeignKey, DateTime, Boolean, DECIMAL
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from enum import Enum
from .base import Base

class ProductStatus(str, Enum):
    ACTIVE = 'active'
    INACTIVE = 'inactive' # Напр., якщо постачальник вимкнув
    ARCHIVED = 'archived' # Видалено

class Product(Base):
    __tablename__ = 'products'

    id = Column(Integer, primary_key=True)
    supplier_id = Column(Integer, ForeignKey('suppliers.id'), nullable=False, index=True)
    supplier_sku = Column(String(255), nullable=False, index=True) # SKU від постачальника
    name = Column(String(512), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), index=True) # Категорія (для прив'язки до каналу)
    status = Column(SQLAlchemyEnum(ProductStatus, name="product_status_enum"), default=ProductStatus.ACTIVE)
    pictures = Column(Text, nullable=True) # Головне фото або JSON-список

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Зв'язок: один продукт має багато варіантів
    variants = relationship("ProductVariant", back_populates="product", cascade="all, delete-orphan")
    supplier = relationship("Supplier") # Зв'язок з постачальником

class ProductVariant(Base):
    __tablename__ = 'product_variants'

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey('products.id'), nullable=False, index=True)
    supplier_offer_id = Column(String(255), unique=True, index=True) # offer_id з XML

    size = Column(String(100), nullable=True)
    color = Column(String(100), nullable=True)

    # Використовуємо DECIMAL для точного зберігання цін
    base_price = Column(DECIMAL(10, 2), nullable=False)
    final_price = Column(DECIMAL(10, 2), nullable=False)

    quantity_in_stock = Column(Integer, default=0)
    is_available = Column(Boolean, default=False)

    last_synced_at = Column(DateTime(timezone=True), server_default=func.now()) # Коли востаннє оновлено з XML

    product = relationship("Product", back_populates="variants")