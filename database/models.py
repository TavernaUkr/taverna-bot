# database/models.py
import enum
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Boolean, ForeignKey, Float,
    Enum, UniqueConstraint, JSON, BigInteger, Table # <-- ДОДАВ Table
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database.db import Base

# --- Перелічувані типи (Enum) ---

class SupplierType(str, enum.Enum):
    mydrop = "mydrop"
    independent = "independent"


class SupplierLegalType(str, enum.Enum):
    """Тип партнера з форми Mini App «Стати постачальником»."""
    individual = "individual"  # ФОП / фіз. особа
    business = "business"      # ТОВ / юр. особа

class SupplierStatus(str, enum.Enum):
    pending_ai_analysis = "pending_ai_analysis"
    ai_in_progress = "ai_in_progress"
    pending_admin_approval = "pending_admin_approval"
    active = "active"
    rejected = "rejected"
    disabled = "disabled"
    deletion_requested = "deletion_requested"
    deleted = "deleted"
    banned = "banned"

class OrderStatus(str, enum.Enum):
    new = "new"
    pending = "pending"
    confirmed = "confirmed"
    processing = "processing"
    shipped = "shipped"
    delivered = "delivered"
    cancelled = "cancelled"
    returned = "returned"

class PaymentStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    partial = "partial"
    cod = "cod"
    failed = "failed"
    paid_to_supplier = "paid_to_supplier"

class UserRole(str, enum.Enum):
    user = "user"
    client = "client"
    admin = "admin"
    supplier = "supplier"

class PayoutMethod(str, enum.Enum):
    iban = "iban"
    card_token = "card_token"

class ProductStatus(str, enum.Enum):
    active = 'active'
    inactive = 'inactive'
    archived = 'archived'
    deleted = 'deleted'

class ProductAIStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"

class OrderItemStatus(str, enum.Enum):
    pending = "pending"
    confirmed = "confirmed"
    cancelled_supplier = "cancelled_supplier"
    shipped = "shipped"
    delivered = "delivered"

class PriceRuleType(str, enum.Enum):
    percentage = "percentage"
    fixed_amount = "fixed_amount"

class PaidServiceType(str, enum.Enum):
    paid_post = "paid_post"
    paid_ad = "paid_ad"

class PaidServiceStatus(str, enum.Enum):
    pending_payment = "pending_payment"
    payment_failed = "payment_failed"
    awaiting_execution = "awaiting_execution"
    completed = "completed"

# --- Таблиця-посередник (Association Table) ---
# ВОНА МАЄ БУТИ ТУТ, ПЕРЕД класами Supplier та Channel
supplier_channels = Table(
    'supplier_channels',
    Base.metadata,
    Column('supplier_id', Integer, ForeignKey('suppliers.id'), primary_key=True),
    Column('channel_id', Integer, ForeignKey('channels.id'), primary_key=True)
)

# --- Моделі ---

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True) # Внутрішній ID
    telegram_id = Column(BigInteger, unique=True, index=True, nullable=False) # Реальний TG ID
    username = Column(String(100), nullable=True, index=True)
    first_name = Column(String(255), nullable=True)
    last_name = Column(String(255), nullable=True)
    full_name = Column(String(255), nullable=True)
    email = Column(String(255), unique=True, index=True, nullable=True)
    password_hash = Column(String(255), nullable=True)
    role = Column(Enum(UserRole), default=UserRole.client, nullable=False)
    loyalty_points = Column(Integer, default=0)
    haptic_enabled = Column(Boolean, default=True)
    notifications_enabled = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    orders = relationship("Order", back_populates="user")
    bonus_history = relationship("BonusHistory", back_populates="user")
    suppliers = relationship("Supplier", back_populates="user")

class Channel(Base):
    __tablename__ = 'channels'
    id = Column(Integer, primary_key=True)
    telegram_id = Column(BigInteger, unique=True, index=True) # ID каналу (напр. -100123456789)
    title = Column(String(255))
    username = Column(String(100), nullable=True)
    category_tag = Column(String(50), unique=True, index=True) # Тег категорії (напр. 'tactic_clothes')
    
    suppliers = relationship("Supplier", secondary=supplier_channels, back_populates="channels")

class Supplier(Base):
    __tablename__ = 'suppliers'
    id = Column(Integer, primary_key=True)
    
    key = Column(String(50), unique=True, index=True, nullable=True) # Для системних постачальників
    
    name = Column(String(255), nullable=False, index=True)
    type = Column(Enum(SupplierType), nullable=False, default=SupplierType.independent)
    status = Column(Enum(SupplierStatus), nullable=False, default=SupplierStatus.pending_ai_analysis, index=True)

    owner_email = Column(String(255), unique=True, index=True, nullable=True)
    contact_telegram_id = Column(BigInteger, index=True, nullable=True)
    contact_phone = Column(String(20), nullable=True)
    
    api_key = Column(String(255), nullable=True)
    xml_url = Column(Text, nullable=True) 
    shop_url = Column(Text, nullable=True)

    # --- MyDrop REST API (заміна XML-парсингу) ---
    mydrop_api_key = Column(String(255), nullable=True)  # X-API-KEY постачальника з кабінету MyDrop
    mydrop_api_key_verified = Column(Boolean, nullable=False, default=False)  # чи ключ пройшов тестовий запит
    mydrop_api_key_verified_at = Column(DateTime(timezone=True), nullable=True)  # коли саме верифікували
    
    supplier_address = Column(Text, nullable=True)
    telegram_channel = Column(String(100), nullable=True)

    # --- Mini App «Стати партнером» ---
    supplier_type = Column(Enum(SupplierLegalType, native_enum=False, length=32), nullable=True)
    yml_link = Column(Text, nullable=True)
    channel_link = Column(String(255), nullable=True)
    is_verified = Column(Boolean, nullable=False, default=False)
    edrpou_ipn = Column(String(32), nullable=True, index=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(32), nullable=True)
    manager_telegram = Column(String(100), nullable=True)
    store_name = Column(String(255), nullable=True)
    store_description = Column(Text, nullable=True)
    iban = Column(String(64), nullable=True)
    bank_name = Column(String(255), nullable=True)
    trial_ends_at = Column(DateTime(timezone=True), nullable=True)
    ai_score_report = Column(Text, nullable=True)

    payout_method = Column(Enum(PayoutMethod), nullable=True, default=PayoutMethod.iban)
    payout_iban = Column(String(100), nullable=True)
    payout_card_token = Column(String(255), nullable=True)
    
    legal_name = Column(String(255), nullable=True)
    ipn = Column(String(20), nullable=True)
    edrpou = Column(String(20), nullable=True)
    admin_notes = Column(Text, nullable=True)

    last_posted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    approved_at = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user = relationship("User", back_populates="suppliers")
    
    channels = relationship("Channel", secondary=supplier_channels, back_populates="suppliers")
    products = relationship("Product", back_populates="supplier", cascade="all, delete-orphan")

class Product(Base):
    __tablename__ = 'products'
    id = Column(Integer, primary_key=True)
    supplier_id = Column(Integer, ForeignKey('suppliers.id'), nullable=False, index=True)
    supplier_sku = Column(String(255), nullable=False, index=True)

    __table_args__ = (
        UniqueConstraint('supplier_id', 'supplier_sku', name='uix_supplier_sku'),
    )

    name = Column(String(512), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), index=True)
    sub_category = Column(String(150), nullable=True, index=True)
    season = Column(String(50), nullable=True, index=True)
    target_niche = Column(String(100), nullable=True, index=True)
    gender = Column(String(50), nullable=True, index=True)
    attributes = Column(JSON, nullable=True)
    brand = Column(String(255), nullable=True)
    model = Column(String(255), nullable=True)
    ai_category = Column(String(255), nullable=True, index=True)
    is_ai_processed = Column(Boolean, nullable=False, default=False, index=True)
    ai_status = Column(
        Enum(ProductAIStatus, native_enum=False, length=32),
        nullable=False,
        default=ProductAIStatus.pending,
        index=True,
    )
    status = Column(
        Enum(ProductStatus, native_enum=False, length=32),
        default=ProductStatus.active,
    ) # 'active', 'inactive', 'archived', 'deleted'
    pictures = Column(JSON, nullable=True) # Зберігаємо як JSON список URL
    
    last_posted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    supplier = relationship("Supplier", back_populates="products")
    variants = relationship("ProductVariant", back_populates="product", cascade="all, delete-orphan")
    options = relationship("ProductOption", back_populates="product", cascade="all, delete-orphan")
    order_items = relationship("OrderItem", back_populates="product")

class ProductOption(Base):
    __tablename__ = 'product_options'
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey('products.id'), nullable=False, index=True)
    name = Column(String(100), nullable=False) # "Розмір", "Колір"

    __table_args__ = (
        UniqueConstraint('product_id', 'name', name='uix_product_option_name'),
    )
    
    product = relationship("Product", back_populates="options")
    values = relationship("ProductOptionValue", back_populates="option", cascade="all, delete-orphan")

class ProductOptionValue(Base):
    __tablename__ = 'product_option_values'
    id = Column(Integer, primary_key=True)
    option_id = Column(Integer, ForeignKey('product_options.id'), nullable=False, index=True)
    value = Column(String(100), nullable=False) # "XL", "Red"

    __table_args__ = (
        UniqueConstraint('option_id', 'value', name='uix_option_value'),
    )
    
    option = relationship("ProductOption", back_populates="values")

class ProductVariant(Base):
    __tablename__ = 'product_variants'
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey('products.id'), nullable=False, index=True)
    supplier_offer_id = Column(String(255), unique=True, index=True)
    
    base_price = Column(Float, nullable=False) # Дроп-ціна
    final_price = Column(Integer, nullable=False) # Наша ціна (грн)
    quantity = Column(Integer, default=0)
    is_available = Column(Boolean, default=True)
    
    last_updated = Column(DateTime(timezone=True), server_default=func.now())
    
    product = relationship("Product", back_populates="variants")
    option_values = relationship("ProductOptionValue", secondary="product_variant_option_values")
    order_items = relationship("OrderItem", back_populates="variant")

product_variant_option_values = Table(
    'product_variant_option_values',
    Base.metadata,
    Column('variant_id', Integer, ForeignKey('product_variants.id'), primary_key=True),
    Column('option_value_id', Integer, ForeignKey('product_option_values.id'), primary_key=True)
)

class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True)
    
    parent_order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    
    order_uid = Column(String(50), unique=True, index=True) 
    user_telegram_id = Column(BigInteger, ForeignKey("users.telegram_id"), index=True)
    status = Column(Enum(OrderStatus), default=OrderStatus.new, index=True)
    payment_status = Column(Enum(PaymentStatus), default=PaymentStatus.pending, index=True)
    total_price = Column(Integer, nullable=False)
    subtotal = Column(Float, default=0.0, nullable=False)
    delivery_cost = Column(Float, default=0.0, nullable=False)
    
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)
    customer_message_id = Column(Integer, nullable=True)
    
    customer_name = Column(String(255))
    customer_phone = Column(String(20))
    delivery_service = Column(String(50))
    delivery_address = Column(Text)
    address_ref = Column(String(100), nullable=True) 
    city_ref = Column(String(100), nullable=True)
    warehouse_ref = Column(String(100), nullable=True)
    ttn = Column(String(50), index=True)
    tracking_status = Column(String(100), nullable=True, index=True)
    last_tracking_at = Column(DateTime(timezone=True), nullable=True)
    payment_type = Column(String(50))
    note = Column(Text)
    rating = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    user = relationship("User", back_populates="orders")
    
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    supplier = relationship("Supplier") 
    parent = relationship("Order", remote_side=[id], back_populates="children")
    children = relationship("Order", back_populates="parent", cascade="all, delete-orphan")

class OrderItem(Base):
    __tablename__ = "order_items"
    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), index=True)
    
    product_name = Column(String(255), nullable=False)
    sku = Column(String(100))
    options_text = Column(String(255)) 
    quantity = Column(Integer, nullable=False)
    price_per_item = Column(Integer, nullable=False) 
    drop_price_per_item = Column(Integer, nullable=True) 
    supplier_offer_id = Column(String(100))
    ttn = Column(String(100), nullable=True, index=True)
    
    status = Column(Enum(OrderItemStatus), default=OrderItemStatus.pending, index=True) 
    cancel_reason = Column(Text, nullable=True)
    
    order = relationship("Order", back_populates="items")
    product = relationship("Product", back_populates="order_items")
    variant = relationship("ProductVariant", back_populates="order_items")
    supplier = relationship("Supplier")

class PriceRule(Base):
    __tablename__ = "price_rules"
    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    priority = Column(Integer, default=100, index=True)
    category_tag = Column(String(50), nullable=True) # Прибрав ForeignKey для простоти поки що
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    min_price = Column(Integer, nullable=True)
    max_price = Column(Integer, nullable=True)
    rule_type = Column(Enum(PriceRuleType), nullable=False)
    value = Column(Float, nullable=False)
    is_active = Column(Boolean, default=True)

class PaidService(Base):
    __tablename__ = "paid_services"
    id = Column(Integer, primary_key=True)
    service_uid = Column(String(50), unique=True, index=True) 
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(Enum(PaidServiceType), nullable=False, index=True)
    status = Column(Enum(PaidServiceStatus), default=PaidServiceStatus.pending_payment, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    amount = Column(Integer, nullable=False) 
    details = Column(JSON, nullable=True) # <-- ДОДАВ JSON для платформ
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    paid_at = Column(DateTime(timezone=True), nullable=True)
    
    supplier = relationship("Supplier")
    user = relationship("User")
    product = relationship("Product")
    order = relationship("Order")

class BonusHistory(Base):
    __tablename__ = "bonus_history"
    id = Column(Integer, primary_key=True)
    user_telegram_id = Column(BigInteger, ForeignKey("users.telegram_id"), nullable=False, index=True)
    amount = Column(Integer, nullable=False)
    reason = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="bonus_history")