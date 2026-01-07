# api_models.py
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime
from database.models import SupplierType, SupplierStatus, OrderStatus, UserRole, PayoutMethod

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
    option_value_ids: List[int] = Field(default_factory=list) 
    @classmethod
    def from_orm(cls, obj: Any) -> 'ProductVariantAPI':
        option_ids = [val.id for val in obj.option_values]
        variant_api = super().from_orm(obj)
        variant_api.option_value_ids = option_ids
        return variant_api
class ProductAPI(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sku: str
    name: str
    description: Optional[str] = None
    pictures: Optional[List[str]] = None
    category_tag: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None
    options: List[ProductOptionAPI] = []
    variants: List[ProductVariantAPI] = []
    
class CustomerDataAPI(BaseModel):
    pib: str = Field(..., min_length=5)
    phone: str = Field(..., min_length=10)
    delivery_service: str
    address: str = Field(..., min_length=5)
    address_ref: Optional[str] = None
    city_ref: Optional[str] = None
    payment_type: str
    note: Optional[str] = None
class SecureCreateOrderRequest(BaseModel):
    customer_data: CustomerDataAPI
class SecureAddItemRequest(BaseModel):
    variant_offer_id: str
    quantity: int = Field(..., gt=0)
class SecureUpdateItemRequest(BaseModel):
    variant_offer_id: str
    new_quantity: int = Field(..., ge=0)
class SecureRemoveItemRequest(BaseModel):
    variant_offer_id: str

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
class AuthRequest(BaseModel):
    initData: str = Field(..., description="Рядок window.Telegram.WebApp.initData")
class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
class EmailRegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    first_name: str
    last_name: Optional[str] = None
class EmailLoginRequest(BaseModel):
    email: EmailStr
    password: str

# --- МОДЕЛІ З `supplier_handlers.py` ---
class SupplierRegisterRequest(BaseModel):
    supplier_name: str = Field(..., min_length=3)
    supplier_type: SupplierType
    contact_phone: str
    contact_email: EmailStr
    agreed_to_tos: bool
    legal_name: str
    ipn: str
    edrpou: Optional[str] = None
    mydrop_xml_url: Optional[str] = None
    shop_url: Optional[str] = None
    supplier_address: Optional[str] = None
    payout_method: PayoutMethod
    payout_iban: Optional[str] = None
    payout_card_token: Optional[str] = None
class SupplierResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    type: SupplierType
    status: SupplierStatus

# --- МОДЕЛІ З `admin_handlers.py` ---
class SupplierAdminResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    status: SupplierStatus
    type: SupplierType
    xml_url: Optional[str] = None
    shop_url: Optional[str] = None
    contact_email: EmailStr
    admin_notes: Optional[str] = None
class AdminManualAddRequest(BaseModel):
    supplier_name: str
    supplier_type: SupplierType
    contact_email: EmailStr
    xml_url: Optional[str] = None
    shop_url: Optional[str] = None
class AdminTransferRequest(BaseModel):
    new_manager_email: EmailStr
class AdminForcePostRequest(BaseModel):
    """(План 23) Адмін примусово постить товар"""
    product_id: int
class AdminForceAdRequest(BaseModel):
    """(План 23) Адмін примусово запускає рекламу"""
    product_id: int
    platforms: List[str] # ['instagram_story', 'olx_top']
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
    """Модель для СТВОРЕННЯ правила"""
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
    total_price: int # (Це дроп-ціна)
    customer_name: str
    delivery_address: str
    created_at: datetime
class SupplierStatsResponse(BaseModel):
    pending_orders: int
    completed_orders: int
    total_products: int
    total_earned: int

# --- НОВА МОДЕЛЬ (План 20) ---
class RequestPaidPostRequest(BaseModel):
    product_id: int
    service_type: str # 'paid_post'
    amount: int # Сума (в гривнях)

# --- НОВІ МОДЕЛІ (План 20/27) ---
class PlatformResponse(BaseModel):
    """(План 5.3) Інформація про рекламну платформу"""
    id: str
    name: str
    price_per_day: int # Наша базова ціна (без націнки)

class RequestPaidAdRequest(BaseModel):
    """(План 5.3) Запит на платну рекламу"""
    product_id: int
    service_type: str # 'paid_ad'
    amount: int # Фінальна сума (в гривнях), яку розрахував frontend
    days: int
    platforms: List[str] # ['instagram_story', 'olx_top']