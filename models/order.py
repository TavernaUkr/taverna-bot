# models/order.py
from sqlalchemy import Column, Integer, String, Enum as SQLAlchemyEnum, DateTime, \
                     Text, Boolean, BigInteger, ForeignKey, DECIMAL
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from enum import Enum
from .base import Base

class OrderStatus(str, Enum):
    NEW = 'new' # Нове, очікує обробки
    PROCESSING = 'processing' # В обробці
    SHIPPED = 'shipped' # Відправлено
    DELIVERED = 'delivered' # Доставлено (для MyDrop)
    COMPLETED = 'completed' # Доставлено (для Independent, підтверджено вручну)
    CANCELED = 'canceled' # Скасовано
    RETURNED = 'returned' # Повернення

class Order(Base):
    __tablename__ = 'orders'

    id = Column(Integer, primary_key=True) # Використовуємо Integer PK
    order_uid = Column(String(50), unique=True, index=True) # Наш `tavX`
    user_telegram_id = Column(BigInteger, ForeignKey('users.telegram_id'), index=True)

    customer_name = Column(String(255))
    customer_phone = Column(String(20))

    delivery_type = Column(String(50)) # branch, courier, pickup
    delivery_service = Column(String(100)) # Нова Пошта, Укрпошта
    delivery_city = Column(String(255), nullable=True)
    delivery_address = Column(Text) # Повна адреса або відділення

    payment_method = Column(String(50)) # cod, full, partial
    payment_status = Column(String(50), default='pending', index=True) # pending, paid

    notes = Column(Text, nullable=True)
    total_amount = Column(DECIMAL(10, 2), nullable=False)
    status = Column(SQLAlchemyEnum(OrderStatus, name="order_status_enum"), default=OrderStatus.NEW, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Зв'язок: одне замовлення має багато позицій
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    user = relationship("User")

class OrderItem(Base):
    __tablename__ = 'order_items'

    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey('orders.id'), nullable=False, index=True)
    product_variant_id = Column(Integer, ForeignKey('product_variants.id'), nullable=False)
    supplier_id = Column(Integer, ForeignKey('suppliers.id'), nullable=False, index=True)

    quantity = Column(Integer, nullable=False)
    price_per_item = Column(DECIMAL(10, 2), nullable=False) # Ціна на момент покупки

    ttn = Column(String(100), nullable=True, index=True) # ТТН для цієї позиції
    status = Column(SQLAlchemyEnum(OrderStatus, name="order_item_status_enum"), default=OrderStatus.NEW) # Статус позиції

    order = relationship("Order", back_populates="items")
    variant = relationship("ProductVariant")
    supplier = relationship("Supplier")