# api_models.py
from pydantic import BaseModel, EmailStr, HttpUrl, Field, ConfigDict
from typing import List, Optional, Dict, Any
from datetime import datetime
from database.models import (
    SupplierType, SupplierStatus, OrderStatus, UserRole, PayoutMethod,
    PriceRuleType
)

# --- МОДЕЛІ З `web_app.py` ---

class ProductOptionValueAPI(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    value: str

class ProductOptionAPI(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    values: List[ProductOptionValueAPI] = []

class ProductVariantAPI(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    supplier_offer_id: str
    final_price: int
    quantity: int
    is_available: bool
    option_value_ids: List[int] = Field(default_factory=list) # Ми заповнимо це в Кроці 2

class ProductAPI(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    # --- [ВИПРАВЛЕННЯ 1 (Помилка 2)] ---
    sku: str = Field(alias='supplier_sku') # Pydantic "перейменовує" supplier_sku -> sku
    # ---------------------------------
    
    name: str
    description: Optional[str] = None
    pictures: Optional[List[str]] = None
    category: Optional[str] = Field(alias='category')
    
    options: List[ProductOptionAPI] = []
    variants: List[ProductVariantAPI] = []

# --- МОДЕЛІ З `auth_handlers.py` ---
class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    telegram_id: Optional[str] = None
    email: Optional[EmailStr] = None
    first_name: str
    last_name: Optional[str] = None
    username: Optional[str] = None
    loyalty_points: int
    role: UserRole

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse # (Вкладена модель)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TelegramLoginRequest(BaseModel):
    initData: str
    
# --- МОДЕЛІ З `admin_handlers.py` ---
class SupplierAdminResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    status: SupplierStatus
    type: SupplierType
    contact_email: Optional[EmailStr] = None
    contact_telegram_id: Optional[int] = None
    xml_url: Optional[HttpUrl] = None
    shop_url: Optional[HttpUrl] = None
    admin_notes: Optional[str] = None

class AdminManualAddRequest(BaseModel):
    name: str
    type: SupplierType
    contact_email: EmailStr
    xml_url: Optional[HttpUrl] = None
    shop_url: Optional[HttpUrl] = None
    telegram_channel: Optional[str] = None

class AdminTransferRequest(BaseModel):
    new_owner_telegram_id: int

class AdminForcePostRequest(BaseModel):
    product_id: int

class AdminForceAdRequest(BaseModel):
    product_id: int
    platforms: List[str]
    days: int = 1

class PriceRuleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    priority: int
    category_tag: Optional[str] = None
    supplier_id: Optional[int] = None
    min_price: Optional[int] = None
    max_price: Optional[int] = None
    rule_type: PriceRuleType
    value: float
    is_active: bool

class PriceRuleRequest(BaseModel):
    name: str
    priority: int = 100
    category_tag: Optional[str] = None
    supplier_id: Optional[int] = None
    min_price: Optional[int] = None
    max_price: Optional[int] = None
    rule_type: PriceRuleType
    value: float
    is_active: bool = True

# --- МОДЕЛІ З `supplier_dashboard_handlers.py` ---
class SupplierOrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    order_uid: str
    status: OrderStatus
    total_price: int 
    customer_name: str
    delivery_address: str
    created_at: datetime

class SupplierStatsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    pending_orders: int
    completed_orders: int
    total_products: int
    total_earned: int

class RequestPaidPostRequest(BaseModel):
    product_id: int
    service_type: str 
    amount: int

class PlatformResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    price_per_day: int

class RequestPaidAdRequest(BaseModel):
    product_id: int
    service_type: str
    amount: int
    days: int
    platforms: List[str]

# --- МОДЕЛІ З `web_app.py` (Order) ---
class CartItemAPI(BaseModel):
    id: str # supplier_offer_id
    quantity: int

class SecureAddItemRequest(BaseModel):
    variant_offer_id: str
    quantity: int = Field(ge=1)

class SecureUpdateItemRequest(BaseModel):
    variant_offer_id: str
    new_quantity: int = Field(ge=0)

class SecureRemoveItemRequest(BaseModel):
    variant_offer_id: str

class SecureCreateOrderRequest(BaseModel):
    cart: List[CartItemAPI]
    payment_type: str 
    customer_name: str
    customer_phone: str
    delivery_service: str
    delivery_city_ref: str
    delivery_warehouse_ref: str
    delivery_address: str

class AuthRequest(BaseModel):
    initData: str

class EmailRegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    first_name: str = Field(min_length=1)
    last_name: Optional[str] = None


class EmailLoginRequest(BaseModel):
    email: EmailStr
    password: str


class SupplierRegisterRequest(BaseModel):
    supplier_name: str = Field(min_length=2)
    supplier_type: SupplierType

    # для MyDrop
    mydrop_xml_url: Optional[HttpUrl] = None

    # для Independent
    shop_url: Optional[HttpUrl] = None

    supplier_address: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[EmailStr] = None

    agreed_to_tos: bool = False

    # ФОП/ТОВ
    legal_name: Optional[str] = None
    ipn: Optional[str] = None
    edrpou: Optional[str] = None

    # Виплати (План 24)
    payout_method: Optional[PayoutMethod] = None
    payout_iban: Optional[str] = None
    payout_card_token: Optional[str] = None


# --- МОДЕЛІ ДЛЯ `api/orders.py` (Checkout з Mini App) ---

class OrderItemCreate(BaseModel):
    """
    Один товар у замовленні з чекауту.

    `variant_id` — головний спосіб ідентифікувати конкретний розмір/колір
    (посилається на `product_variants.id`). Якщо у товару немає варіантів
    (розмір/колір не потрібні), `variant_id` можна не передавати — тоді
    зберігаємо позицію просто по `product_id` / `product_name`.
    """
    variant_id: Optional[int] = None
    product_id: Optional[int] = None
    product_name: str = Field(min_length=1)
    quantity: int = Field(ge=1)
    price: int = Field(ge=0)  # ціна за 1 шт., яку бачив клієнт у кошику
    options_text: Optional[str] = None  # напр. "Розмір: XL, Колір: Чорний"


class OrderCreate(BaseModel):
    """Вхідні дані для POST /api/v1/orders/ (чекаут з Mini App, без JWT/сесії)."""
    customer_name: str = Field(min_length=1)
    customer_phone: str = Field(min_length=5)
    delivery_address: str = Field(min_length=1)
    delivery_service: Optional[str] = None
    payment_type: Optional[str] = None
    note: Optional[str] = None
    items: List[OrderItemCreate] = Field(min_length=1)


class OrderCreateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    order_uid: str
    total_price: int
    status: OrderStatus


class SupplierResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    key: str
    name: str
    type: SupplierType
    status: SupplierStatus

    xml_url: Optional[str] = None
    shop_url: Optional[str] = None

    supplier_address: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None

    legal_name: Optional[str] = None
    ipn: Optional[str] = None
    edrpou: Optional[str] = None

    payout_method: Optional[PayoutMethod] = None
    payout_iban: Optional[str] = None
    payout_card_token: Optional[str] = None