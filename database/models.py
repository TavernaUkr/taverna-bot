# database/models.py
import enum
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Boolean, ForeignKey, Float,
    Enum, UniqueConstraint, JSON
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database.db import Base

# --- Перелічувані типи (Enum) ---

class SupplierType(str, enum.Enum):
    mydrop = "mydrop"
    independent = "independent" # Незалежні (URL/Канал)

# --- НОВИЙ ENUM ---
class SupplierStatus(str, enum.Enum):
    pending_ai_analysis = "pending_ai_analysis" # Щойно зареєструвався, чекає на AI
    ai_in_progress = "ai_in_progress" # <-- ДОДАЙ ЦЕЙ РЯДОК (Агент взяв в роботу)
    pending_admin_approval = "pending_admin_approval" # AI проаналізував, чекає на Адміна
    active = "active" # Схвалено, працює
    rejected = "rejected" # Відхилено
    disabled = "disabled" # Заблоковано

class OrderStatus(str, enum.Enum):
    new = "new"           # Нове, щойно створене
    pending = "pending"   # Очікує обробки
    confirmed = "confirmed" # Підтверджено постачальником
    shipped = "shipped"   # Відправлено
    completed = "completed" # Успішно завершено
    cancelled = "cancelled" # Скасовано
    refunded = "refunded"   # Повернення

class PaymentStatus(str, enum.Enum):
    pending = "pending"   # Очікує оплати
    paid = "paid"       # Повністю оплачено
    partial = "partial"   # Часткова передоплата
    cod = "cod"         # Накладений платіж
    failed = "failed"     # Помилка оплати
    paid_to_supplier = "paid_to_supplier"

class UserRole(str, enum.Enum):
    user = "user"
    supplier = "supplier"
    admin = "admin"

class PayoutMethod(str, enum.Enum):
    iban = "iban" # Реквізити (UA)
    card_token = "card_token" # Токен карти

# --- Таблиці Користувачів та Постачальників ---

class User(Base):
    """Модель Клієнта (покупця) ТА Користувача Системи."""
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    telegram_id = Column(String(100), unique=True, nullable=True, index=True) # <-- ЗМІНЕНО: nullable=True (для Email-реєстрації)
    
    # --- НОВІ ПОЛЯ (План 21) ---
    email = Column(String(255), unique=True, nullable=True, index=True)
    password_hash = Column(String(255), nullable=True) # Для Email/Pass
    role = Column(Enum(UserRole), default=UserRole.user, nullable=False, index=True)
    # ---
    
    first_name = Column(String(100), nullable=True) # <-- ЗМІНЕНО: nullable=True
    last_name = Column(String(100))
    username = Column(String(100), index=True)
    loyalty_points = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Зв'язки
    orders = relationship("Order", back_populates="user")
    suppliers = relationship("Supplier", back_populates="user") # Якщо клієнт = постачальник

class Supplier(Base):
    """Модель Постачальника (MyDrop або Independent)."""
    __tablename__ = "suppliers"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id")) # Хто власник (з Фази 3)
    key = Column(String(50), unique=True, nullable=False, index=True) # Унікальний ключ (napr. 'landliz')
    name = Column(String(255), nullable=False)
    type = Column(Enum(SupplierType), nullable=False)
    status = Column(Enum(SupplierStatus), default=SupplierStatus.pending_ai_analysis, index=True)
    category_tag = Column(String(50), ForeignKey("channels.category_tag"), nullable=True)
    contact_email = Column(String(100))
    last_posted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    legal_name = Column(String(255), nullable=True) # Назва ФОП / ТОВ
    ipn = Column(String(20), nullable=True, index=True) # ІПН
    edrpou = Column(String(20), nullable=True, index=True) # ЄДРПОУ

    # --- НОВІ ПОЛЯ (План 24G - Авто-Виплати) ---
    payout_method = Column(Enum(PayoutMethod), nullable=True, default=PayoutMethod.iban)
    payout_iban = Column(String(100), nullable=True, index=True) # UA...
    payout_card_token = Column(String(255), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Джерела даних
    xml_url = Column(Text)
    api_key = Column(Text) # для MyDrop API
    shop_url = Column(Text) # для Independent (URL магазину)
    telegram_channel = Column(String(100)) # для Independent (канал)
    supplier_address = Column(Text)

    # Контакти
    contact_phone = Column(String(20))
    contact_email = Column(String(100))
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Зв'язки
    user = relationship("User", back_populates="suppliers")
    products = relationship("Product", back_populates="supplier")

class Channel(Base):
    """Канали (Теми) в TavernaGroup для автопостингу."""
    __tablename__ = "channels"
    id = Column(Integer, primary_key=True)
    telegram_id = Column(String(100), unique=True, index=True) # ID каналу або теми
    name = Column(String(255), nullable=False) # Напр. 'Взуття'
    category_tag = Column(String(50), unique=True) # Напр. 'shoes'

# ---
# НОВА ГНУЧКА СТРУКТУРА ПРОДУКТІВ (Фаза 2.5)
# ---

class Product(Base):
    """Головна картка товару."""
    __tablename__ = "products"
    id = Column(Integer, primary_key=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
    sku = Column(String(100), nullable=False, index=True) # Головний SKU/Артикул
    name = Column(String(255), nullable=False)
    description = Column(Text)
    pictures = Column(JSON) # Список URL: ["url1", "url2"]
    category_tag = Column(String(100), index=True) # Категорія (napr. 'shoes')
    attributes = Column(JSON, index=True)

    # --- ДОДАЙ ЦЕЙ РЯДОК (ДЛЯ "ЧЕРГИ" ТОВАРІВ) ---
    last_posted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # JSONB поле для динамічних фільтрів (Твоя ідея!)
    # Напр: {"brand": "Nike", "year": 2024, "material": "Leather"}
    attributes = Column(JSON, index=True) 
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_updated = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Зв'язки
    supplier = relationship("Supplier", back_populates="products")
    options = relationship("ProductOption", back_populates="product")
    variants = relationship("ProductVariant", back_populates="product")
    order_items = relationship("OrderItem", back_populates="product")
    
    __table_args__ = (
        UniqueConstraint("supplier_id", "sku", name="uq_supplier_sku"),
    )

class ProductOption(Base):
    """
    Гнучкі Опції для товару (Розмір, Колір, Вага, Пам'ять).
    """
    __tablename__ = "product_options"
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    name = Column(String(100), nullable=False) # Напр. 'Розмір'
    
    # Зв'язки
    product = relationship("Product", back_populates="options")
    values = relationship("ProductOptionValue", back_populates="option", cascade="all, delete-orphan")
    
    __table_args__ = (
        UniqueConstraint("product_id", "name", name="uq_product_option_name"),
    )

    last_posted_at = Column(DateTime(timezone=True), nullable=True, index=True) # Для "Черги" (План 20.1)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ProductOptionValue(Base):
    """
    Значення для Опцій (S, M, L, Червоний, 250г, 128ГБ).
    """
    __tablename__ = "product_option_values"
    id = Column(Integer, primary_key=True)
    option_id = Column(Integer, ForeignKey("product_options.id"), nullable=False)
    value = Column(String(100), nullable=False) # Напр. 'S' або '250г'
    
    # Зв'язки
    option = relationship("ProductOption", back_populates="values")
    
    __table_args__ = (
        UniqueConstraint("option_id", "value", name="uq_option_value"),
    )

class ProductVariant(Base):
    """
    Конкретний варіант товару (напр. Червона Футболка, Розмір M).
    Це те, що клієнт кладе в кошик.
    """
    __tablename__ = "product_variants"
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    supplier_offer_id = Column(String(100), unique=True, index=True) # Унікальний ID від MyDrop
    
    # Ціна та Наявність
    base_price = Column(Float(precision=10, asdecimal=True), nullable=False) # Дроп ціна
    final_price = Column(Integer, nullable=False) # Наша ціна (+33%)
    quantity = Column(Integer, default=0)
    is_available = Column(Boolean, default=True)
    
    last_updated = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Зв'язки
    product = relationship("Product", back_populates="variants")
    # Гнучкий зв'язок з опціями (Variant 'Червоний, M' посилається на [Value('Червоний'), Value('M')])
    option_values = relationship("ProductOptionValue", secondary="product_variant_option_values")
    order_items = relationship("OrderItem", back_populates="variant")

# --- Допоміжна таблиця для зв'язку Variant <-> OptionValues ---
# (Потрібна для гнучкої схеми Many-to-Many)
class ProductVariantOptionValue(Base):
    __tablename__ = "product_variant_option_values"
    variant_id = Column(Integer, ForeignKey("product_variants.id"), primary_key=True)
    value_id = Column(Integer, ForeignKey("product_option_values.id"), primary_key=True)


# --- Таблиці Замовлень ---
class Order(Base):
    """(Оновлено для Плану 25)
    ...
    """
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True)
    
    # --- НОВЕ ПОЛЕ (План 25) ---
    parent_order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    # ---
    
    order_uid = Column(String(50), unique=True, index=True) 
    user_telegram_id = Column(Integer, ForeignKey("users.id"), index=True)
    status = Column(Enum(OrderStatus), default=OrderStatus.new, index=True)
    payment_status = Column(Enum(PaymentStatus), default=PaymentStatus.pending, index=True)
    total_price = Column(Integer, nullable=False) 
    
    # --- НОВЕ ПОЛЕ (для Child-замовлень) ---
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)
    # ---
    
    # --- НОВЕ ПОЛЕ (для "Інтерактивності" План 25) ---
    customer_message_id = Column(Integer, nullable=True) # ID повідомлення клієнта для .edit()
    # ---
    
    # ... (всі інші поля: customer_name, phone, ... rating) ...
    customer_name = Column(String(255))
    customer_phone = Column(String(20))
    delivery_service = Column(String(50))
    delivery_address = Column(Text)
    address_ref = Column(String(100), nullable=True) 
    city_ref = Column(String(100), nullable=True) 
    ttn = Column(String(50), index=True)
    payment_type = Column(String(50))
    note = Column(Text)
    rating = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # ... (Зв'язки user, items) ...
    user = relationship("User", back_populates="orders")
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    
    # --- НОВІ ЗВ'ЯЗКИ (План 25) ---
    supplier = relationship("Supplier") # До якого постачальника відноситься ChildOrder
    parent = relationship("Order", remote_side=[id], back_populates="children")
    children = relationship("Order", back_populates="parent", cascade="all, delete-orphan")

# --- НОВИЙ ENUM (План 25 - Інтерактивність) ---
class OrderItemStatus(str, enum.Enum):
    pending = "pending" # Очікує
    confirmed = "confirmed" # Підтверджено Постачальником
    cancelled_supplier = "cancelled_supplier" # Скасовано Постачальником
    shipped = "shipped" # Відправлено
    delivered = "delivered" # Доставлено
# ---

class OrderItem(Base):
    __tablename__ = "order_items"
    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=True)
    
    # --- НОВЕ ПОЛЕ (для "Розумного Кошика") ---
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), index=True)
    
    # ... (всі інші поля: product_name, sku, options_text, ...)
    product_name = Column(String(255), nullable=False)
    sku = Column(String(100))
    options_text = Column(String(255)) 
    quantity = Column(Integer, nullable=False)
    price_per_item = Column(Integer, nullable=False) # Це ЗАВЖДИ final_price (з націнкою)
    
    # --- НОВЕ ПОЛЕ (для Авто-Виплат План 24/25) ---
    drop_price_per_item = Column(Integer, nullable=True) # Дроп-ціна
    
    supplier_offer_id = Column(String(100))
    
    # --- ОНОВЛЕНО (План 25) ---
    status = Column(Enum(OrderItemStatus), default=OrderItemStatus.pending, index=True) 
    cancel_reason = Column(Text, nullable=True) # Причина скасування
    # ---
    
    # Зв'язки
    order = relationship("Order", back_populates="items")
    product = relationship("Product", back_populates="order_items")
    variant = relationship("ProductVariant", back_populates="order_items")
    supplier = relationship("Supplier")

class PaidServiceType(str, enum.Enum):
    paid_post = "paid_post" # Платний постинг (поза чергою)
    paid_ad = "paid_ad"     # Платна реклама (на Prom/Insta)

class PaidServiceStatus(str, enum.Enum):
    pending_payment = "pending_payment" # Рахунок створено, чекає оплати
    payment_failed = "payment_failed"   # Помилка оплати
    awaiting_execution = "awaiting_execution" # Оплачено, чекає на виконання (ботом)
    completed = "completed"         # Виконано

class PaidService(Base):
    """
    (Фаза 5.2 / План 20)
    Таблиця для відстеження платних послуг (Платний Пост, Платна Реклама).
    """
    __tablename__ = "paid_services"
    id = Column(Integer, primary_key=True)
    
    # ID рахунку (напр. "SRV-123-ABC")
    service_uid = Column(String(50), unique=True, index=True) 
    
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    
    type = Column(Enum(PaidServiceType), nullable=False, index=True)
    status = Column(Enum(PaidServiceStatus), default=PaidServiceStatus.pending_payment, index=True)
    
    # З чим пов'язана послуга
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True) # (для "Платного Посту")
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True) # (для "Інвойсингу Комісії")
    
    amount = Column(Integer, nullable=False) # Сума до сплати (в копійках)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    paid_at = Column(DateTime(timezone=True), nullable=True)
    
    # Зв'язки
    supplier = relationship("Supplier")
    user = relationship("User")
    product = relationship("Product")
    order = relationship("Order")

class PriceRuleType(str, enum.Enum):
    percentage = "percentage" # +33%
    fixed_amount = "fixed_amount" # +100 грн

class PriceRule(Base):
    """
    (План 27G) "God Mode" Керування Націнками.
    Дозволяє Адміну динамічно змінювати націнки.
    """
    __tablename__ = "price_rules"
    id = Column(Integer, primary_key=True)
    
    name = Column(String(255), nullable=False) # Напр. "Націнка на Взуття > 1000"
    priority = Column(Integer, default=100, index=True) # Пріоритет (0 = найвищий)
    
    # --- Умови (IF) ---
    # (Якщо NULL - застосовується до всіх)
    category_tag = Column(String(50), ForeignKey("channels.category_tag"), nullable=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    min_price = Column(Integer, nullable=True) # Дроп-ціна ВІД
    max_price = Column(Integer, nullable=True) # Дроп-ціна ДО
    
    # --- Дія (THEN) ---
    rule_type = Column(Enum(PriceRuleType), nullable=False)
    value = Column(Float, nullable=False) # 33.0 (для %) або 100.0 (для фікс.)
    
    is_active = Column(Boolean, default=True)