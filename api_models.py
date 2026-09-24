# api_models.py
from pydantic import BaseModel, EmailStr, HttpUrl, Field, ConfigDict, field_serializer
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime, timezone
from database.models import (
    SupplierType, SupplierStatus, OrderStatus, UserRole, PayoutMethod,
    PriceRuleType, SupplierLegalType
)


def datetime_to_utc_z(value: Optional[datetime]) -> Optional[str]:
    """Naive час = UTC. JSON: 2026-09-19T00:49:00Z."""
    if value is None:
        return None
    dt = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


class UtcJsonDates(BaseModel):
    @field_serializer(
        "created_at",
        "approved_at",
        "restored_at",
        "deleted_at",
        "trial_ends_at",
        "expires_at",
        when_used="json",
        check_fields=False,
    )
    def _utc_z(self, value: Optional[datetime]) -> Optional[str]:
        return datetime_to_utc_z(value)


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
    sub_category: Optional[str] = None
    season: Optional[str] = None
    target_niche: Optional[str] = None
    gender: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None
    search_tags: Optional[List[str]] = None
    supplier_name: Optional[str] = None
    
    options: List[ProductOptionAPI] = []
    variants: List[ProductVariantAPI] = []


class CategorySubAPI(BaseModel):
    name: str
    count: int


class CategoryNicheAPI(BaseModel):
    name: str
    count: int
    subcategories: List[CategorySubAPI] = []


class CategoryAPI(BaseModel):
    """Головна AI-категорія для меню MiniApp (без MyDrop ID)."""
    name: str
    count: int
    subcategories: List[CategorySubAPI] = []
    niches: List[CategoryNicheAPI] = []


class FilterAttributeAPI(BaseModel):
    name: str
    values: List[str] = []


class DynamicFilterAPI(BaseModel):
    """Унікальні опції однієї JSON-характеристики (Виробник, Пам'ять...)."""
    name: str
    options: List[str] = []


class ProductFiltersAPI(BaseModel):
    """Унікальні PIM-значення для динамічної панелі фільтрів MiniApp."""
    target_niche: List[str] = []
    season: List[str] = []
    gender: List[str] = []
    attributes: List[FilterAttributeAPI] = []
    sub_categories: List[CategorySubAPI] = []
    total: int = 0
    categories: List[str] = []
    dynamic_filters: List[DynamicFilterAPI] = []


class ProductListAPI(BaseModel):
    """Пагінований каталог: GET /api/v1/products/."""
    items: List[ProductAPI] = []
    total: int = 0


class ProductColorVariantAPI(BaseModel):
    """Інший колір тієї ж моделі (окремий товар того ж постачальника)."""
    product_id: int
    color: str = ""
    # Перше медіа товару (може бути фото АБО відео/гіфка) — лишили заради
    # сумісності зі старими клієнтами.
    image_url: Optional[str] = None
    # Усі медіа товару. Фронтенд сам обирає серед них перше НЕ-відео фото
    # для кружечка кольору (CSS не вміє показати .mp4 як фон/картинку).
    images: List[str] = []

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
    haptic_enabled: bool = True
    notifications_enabled: bool = True


class UserSettingsUpdate(BaseModel):
    haptic_enabled: Optional[bool] = None
    notifications_enabled: Optional[bool] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse # (Вкладена модель)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TelegramLoginRequest(BaseModel):
    initData: Optional[str] = None
    init_data: Optional[str] = None

    def resolved_init_data(self) -> str:
        return (self.initData or self.init_data or "").strip()


TelegramAuthRequest = TelegramLoginRequest


class TelegramAuthUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    telegram_id: int
    username: Optional[str] = None
    full_name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: str
    created_at: Optional[datetime] = None
    haptic_enabled: bool = True
    notifications_enabled: bool = True


class TelegramAuthResponse(BaseModel):
    user: TelegramAuthUserResponse
    role: str
    is_guest: bool = False


class PartnerRegisterRequest(BaseModel):
    """Форма Mini App «Стати постачальником» — усі поля з React."""
    supplier_type: str = Field(min_length=1)
    name: Optional[str] = None
    shop_name: Optional[str] = None
    store_name: Optional[str] = None
    yml_link: Optional[str] = None
    xml_url: Optional[str] = None
    source_type: Optional[str] = "xml"  # "xml" або "telegram"
    telegram_channel_link: Optional[str] = None
    channel_link: Optional[str] = None
    telegram_channel: Optional[str] = None
    telegram_id: Optional[int] = None
    full_name: Optional[str] = None
    company_name: Optional[str] = None
    tax_id: Optional[str] = None
    edrpou_ipn: Optional[str] = None
    edrpou: Optional[str] = None
    ipn: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    telegram_username: Optional[str] = None
    manager_telegram: Optional[str] = None
    description: Optional[str] = None
    store_description: Optional[str] = None
    payment_iban: Optional[str] = None
    iban: Optional[str] = None
    payment_card_holder: Optional[str] = None
    payment_bank_name: Optional[str] = None
    bank_name: Optional[str] = None

    def resolved_name(self) -> str:
        value = (self.store_name or self.shop_name or self.name or self.company_name or "").strip()
        if not value:
            raise ValueError("name is required")
        return value

    def resolved_source_type(self) -> str:
        raw = (self.source_type or "xml").strip().lower()
        if raw in ("telegram", "tg", "channel"):
            return "telegram"
        return "xml"

    def resolved_yml(self) -> Optional[str]:
        if self.resolved_source_type() == "telegram":
            return None
        value = (self.yml_link or self.xml_url or "").strip()
        return value or None

    def resolved_telegram_channel_link(self) -> Optional[str]:
        value = (self.telegram_channel_link or "").strip()
        if value:
            return value
        if self.resolved_source_type() == "telegram":
            return (self.channel_link or self.telegram_channel or "").strip() or None
        return None

    def resolved_channel(self) -> Optional[str]:
        if self.resolved_source_type() == "telegram":
            return self.resolved_telegram_channel_link()
        value = (self.channel_link or self.telegram_channel or "").strip()
        return value or None

    def resolved_edrpou_ipn(self) -> Optional[str]:
        value = (self.edrpou_ipn or self.tax_id or self.edrpou or self.ipn or "").strip()
        return value or None

    def resolved_iban(self) -> Optional[str]:
        value = (self.iban or self.payment_iban or "").strip()
        return value or None

    def resolved_bank(self) -> Optional[str]:
        value = (self.bank_name or self.payment_bank_name or "").strip()
        return value or None

    def resolved_description(self) -> Optional[str]:
        value = (self.store_description or self.description or "").strip()
        return value or None

    def resolved_legal_type(self) -> SupplierLegalType:
        raw = (self.supplier_type or "").strip().lower()
        if raw in ("business", "company"):
            return SupplierLegalType.business
        if raw in ("individual", "fop", "person"):
            return SupplierLegalType.individual
        raise ValueError("supplier_type must be 'individual' or 'business'")


class PartnerRegisterResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: Optional[int] = None
    name: str
    supplier_type: Optional[str] = None
    yml_link: Optional[str] = None
    channel_link: Optional[str] = None
    is_verified: bool = False
    status: Optional[str] = None
    has_duplicates: bool = False
    trial_ends_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class SupplierQueueShopProgress(BaseModel):
    """Один магазин у AI-черзі (віджет і адмінка)."""
    supplier_id: int = 0
    shop_name: str
    status: str = "waiting"
    total: int = 0
    processed: int = 0
    pending_count: int = 0
    queue_position: int = 0
    items_ahead: int = 0
    estimated_minutes: int = 0
    wait_minutes: int = 0
    is_processing: bool = False
    is_fetching_xml: bool = False


class SupplierImportProgressResponse(BaseModel):
    """Прогрес AI лише для магазинів поточного користувача."""
    total: int = 0
    completed: int = 0
    processed: int = 0
    estimated_minutes: int = 0
    is_importing: bool = False
    queue_ahead: int = 0
    queue_position: int = 0
    items_ahead: int = 0
    shop_name: Optional[str] = None
    supplier_id: Optional[int] = None
    pending_count: int = 0
    wait_minutes: int = 0
    is_fetching_xml: bool = False
    shops: list[SupplierQueueShopProgress] = []


class AdminAiQueueCurrentResponse(UtcJsonDates):
    supplier_id: int
    shop_name: str
    processed: int = 0
    total: int = 0
    pending_count: int = 0
    remaining_minutes: int = 0
    wait_minutes: int = 0
    estimated_minutes: int = 0
    created_at: Optional[datetime] = None
    is_fetching_xml: bool = False


class AdminAiQueueWaitingItem(UtcJsonDates):
    supplier_id: int
    shop_name: str
    pending_count: int = 0
    queue_position: int = 0
    processed: int = 0
    total: int = 0
    remaining_minutes: int = 0
    wait_minutes: int = 0
    estimated_minutes: int = 0
    created_at: Optional[datetime] = None
    is_fetching_xml: bool = False


class AdminAiQueueResponse(BaseModel):
    current_processing: Optional[AdminAiQueueCurrentResponse] = None
    waiting_list: list[AdminAiQueueWaitingItem] = []
    shops: list[SupplierQueueShopProgress] = []


class SupplierMeResponse(UtcJsonDates):
    """Картка магазину поточного постачальника (GET /suppliers/me)."""
    id: int
    store_name: str
    supplier_type: Optional[str] = None
    status: str
    is_verified: bool = False
    product_count: int = 0
    completed_products: int = 0
    deletion_requested: bool = False
    created_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    restored_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None


class SupplierDeletionRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=2000)


class SupplierDeletionResponse(BaseModel):
    ok: bool = True
    detail: str = "Заявка на видалення надіслана адміністратору"


class ManagerPermissions(BaseModel):
    """Матриця прав менеджера (RBAC, B2B)."""
    can_edit_info: bool = False
    can_manage_products: bool = True
    can_view_balance: bool = False
    can_resolve_disputes: bool = False


class ManagerContractRates(BaseModel):
    """Тарифікація послуг менеджера (B2B-економіка). Суми в копійках/центах."""
    rate_per_order: int = Field(default=0, ge=0, description="Оплата за обробку замовлення")
    rate_per_dispute: int = Field(default=0, ge=0, description="Оплата за вирішення спору")


class ManagerCommSettings(BaseModel):
    """Omnichannel: як менеджер працює з комунікацією."""
    chat_channel: Literal["webapp", "telegram"] = "webapp"
    receive_notifications: bool = True


class SupplierManagerResponse(BaseModel):
    """Менеджер магазину для GET /suppliers/me/managers."""
    user_id: int
    telegram_id: Optional[int] = None
    username: Optional[str] = None
    full_name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    permissions: ManagerPermissions = Field(default_factory=ManagerPermissions)
    rates: ManagerContractRates = Field(default_factory=ManagerContractRates)
    comm_settings: ManagerCommSettings = Field(default_factory=ManagerCommSettings)


class ManagerPermissionsUpdateRequest(BaseModel):
    """Тіло PATCH /suppliers/me/managers/{user_id}/permissions."""
    permissions: ManagerPermissions


class ManagerContractUpdateRequest(BaseModel):
    """
    Тіло PATCH /suppliers/me/managers/{user_id}/contract.
    Доступно ЛИШЕ власнику: тарифи + права (все опційне, крім хоча б одного поля).
    """
    rates: Optional[ManagerContractRates] = None
    permissions: Optional[ManagerPermissions] = None


class ManagerCommSettingsUpdateRequest(BaseModel):
    """
    Тіло PATCH /suppliers/me/managers/{user_id}/communication.
    Доступно самому менеджеру (щоб обрати канал) або власнику.
    """
    comm_settings: ManagerCommSettings


class SupplierInviteLinkResponse(BaseModel):
    """Відповідь POST /suppliers/me/invite-link."""
    ok: bool = True
    link: str
    token: str
    expires_at: Optional[datetime] = None


class SupplierShopCardResponse(UtcJsonDates):
    """Магазин для «Мої магазини»: власник або менеджер (GET /suppliers/me/shops)."""
    id: int
    store_name: str
    supplier_type: Optional[str] = None
    status: str
    is_active: bool = False
    role: str  # 'owner' | 'manager'
    shop_url: Optional[str] = None
    logo_url: Optional[str] = None
    product_count: int = 0
    completed_products: int = 0
    deletion_requested: bool = False
    created_at: Optional[datetime] = None


class SupplierUpdateRequest(BaseModel):
    """PATCH /suppliers/{id}: профіль магазину (власник або менеджер)."""
    store_name: Optional[str] = None
    store_description: Optional[str] = None
    manager_telegram: Optional[str] = None
    payout_method: Optional[str] = None  # 'iban' | 'card_token'
    payout_iban: Optional[str] = None
    payout_card_token: Optional[str] = None
    # --- Поля дизайну/політик (Live-ensure колонок у database/db.py) ---
    logo_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    shop_photos: Optional[List[str]] = None
    return_policy: Optional[str] = None
    exchange_policy: Optional[str] = None
    shipping_schedule: Optional[str] = None
    shipping_days: Optional[List[str]] = None
    return_contact_info: Optional[str] = None
    allow_bot_chat: Optional[bool] = None
    telegram_forward_enabled: Optional[bool] = None


class SupplierDetailResponse(UtcJsonDates):
    """Повна картка магазину (GET/PATCH /suppliers/{id})."""
    id: int
    store_name: str
    store_description: Optional[str] = None
    supplier_type: Optional[str] = None
    status: str
    is_active: bool = False
    role: str  # 'owner' | 'manager'
    shop_url: Optional[str] = None
    manager_telegram: Optional[str] = None
    contact_phone: Optional[str] = None
    email: Optional[str] = None
    payout_method: Optional[str] = None
    payout_iban: Optional[str] = None
    payout_card_token: Optional[str] = None
    # --- Поля дизайну/політик ---
    logo_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    shop_photos: List[str] = []
    return_policy: Optional[str] = None
    exchange_policy: Optional[str] = None
    shipping_schedule: Optional[str] = None
    shipping_days: List[str] = []
    return_contact_info: Optional[str] = None
    allow_bot_chat: bool = True
    telegram_forward_enabled: bool = False
    product_count: int = 0
    completed_products: int = 0
    deletion_requested: bool = False
    # RBAC: власні права поточного менеджера (owner отримує None —
    # йому дозволено все). Заповнюється лише в GET /suppliers/{id}.
    my_permissions: Optional[ManagerPermissions] = None
    # B2B-контракт поточного менеджера: тарифи та комунікація
    # (owner отримує None — він не менеджер). Заповнюється лише в GET /suppliers/{id}.
    my_rates: Optional[ManagerContractRates] = None
    my_comm_settings: Optional[ManagerCommSettings] = None
    created_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None


class PublicSupplierResponse(UtcJsonDates):
    """
    Публічна вітрина магазину (GET /suppliers/{id}/public).
    БЕЗ авторизації — те, що бачить покупець на сторінці /supplier/{id}.
    Ніяких email / телефонів / реквізитів / внутрішніх статусів.
    """
    id: int
    name: Optional[str] = None
    store_name: str
    store_description: Optional[str] = None
    logo_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    telegram_channel_link: Optional[str] = None
    # Поля вкладки «Інфо» сторінки магазину (політики/доставка) —
    # без них UI показував би загальні заглушки замість даних власника.
    is_active: bool = True
    return_policy: Optional[str] = None
    exchange_policy: Optional[str] = None
    shipping_schedule: Optional[str] = None
    shipping_days: List[str] = []
    created_at: Optional[datetime] = None
    # Статистика магазину: заповнюється лише у списку
    # GET /suppliers/public (сторінка «Постачальники»), через _product_stats.
    # На вітрині /{id}/public лишається 0 — фронт там ці поля не показує.
    product_count: int = 0
    completed_products: int = 0


class PendingSupplierApplicationResponse(UtcJsonDates):
    """Заявка для React-адмінки, включно з AI-звітом."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_name: str
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company_name: Optional[str] = None
    supplier_type: Optional[str] = None
    tax_id: Optional[str] = None
    description: Optional[str] = None
    xml_url: Optional[str] = None
    yml_link: Optional[str] = None
    source_type: Optional[str] = "xml"
    telegram_channel_link: Optional[str] = None
    channel_link: Optional[str] = None
    manager_telegram: Optional[str] = None
    iban: Optional[str] = None
    bank_name: Optional[str] = None
    status: str
    is_verified: bool = False
    telegram_id: Optional[int] = None
    ai_score_report: Optional[str] = None
    scoring_result: Optional[str] = None
    trial_ends_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    restored_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    import_started: bool = False
    deletion_reason: Optional[str] = None


class AdminStoreListItem(BaseModel):
    """Картка магазину для вкладки «Усі магазини» в адмінці."""
    id: int
    shop_name: str
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    is_active: bool = True
    markup_percentage: Optional[float] = None
    created_at: Optional[datetime] = None
    manager_telegram: Optional[str] = None
    xml_url: Optional[str] = None
    description: Optional[str] = None
    product_count: int = 0
    user_id: Optional[int] = None
    telegram_id: Optional[int] = None
    status: str


class AdminSupplierDeleteResponse(BaseModel):
    ok: bool = True
    supplier_id: int
    user_reverted: bool = False
    detail: str = "Постачальника та його товари видалено."


class AdminApproveDeletionResponse(BaseModel):
    ok: bool = True
    supplier_id: int
    status: str = "deleted"
    user_reverted: bool = False
    products_archived: int = 0
    ai_cancelled: int = 0
    detail: str = "Магазин видалено. Товари архівовано, користувач знову клієнт."


class AdminDirectCreateSupplierRequest(BaseModel):
    """Швидке створення магазину адміном (без обов'язкового ІПН/ЄДРПОУ)."""
    shop_name: Optional[str] = None
    name: Optional[str] = None
    store_name: Optional[str] = None
    yml_link: Optional[str] = None
    xml_url: Optional[str] = None
    source_type: Optional[str] = "xml"  # "xml" або "telegram"
    telegram_channel_link: Optional[str] = None
    description: Optional[str] = None
    store_description: Optional[str] = None
    edrpou_ipn: Optional[str] = None
    tax_id: Optional[str] = None
    iban: Optional[str] = None
    payment_iban: Optional[str] = None
    bank_name: Optional[str] = None
    payment_bank_name: Optional[str] = None
    manager_telegram: Optional[str] = None
    channel_link: Optional[str] = None
    telegram_channel_url: Optional[str] = None
    legal_name: Optional[str] = None
    payment_card_holder: Optional[str] = None
    supplier_type: Optional[str] = None
    telegram_id: Optional[int] = None
    user_id: Optional[int] = None
    owner_telegram_id: Optional[int] = None

    def resolved_name(self) -> str:
        value = (self.shop_name or self.store_name or self.name or "").strip()
        if not value:
            raise ValueError("shop_name is required")
        return value

    def resolved_source_type(self) -> str:
        raw = (self.source_type or "xml").strip().lower()
        if raw in ("telegram", "tg", "channel"):
            return "telegram"
        return "xml"

    def resolved_yml(self) -> Optional[str]:
        if self.resolved_source_type() == "telegram":
            return None
        value = (self.yml_link or self.xml_url or "").strip()
        return value or None

    def resolved_telegram_channel_link(self) -> Optional[str]:
        value = (self.telegram_channel_link or "").strip()
        if value:
            return value
        if self.resolved_source_type() == "telegram":
            return (self.channel_link or self.telegram_channel_url or "").strip() or None
        return None

    def resolved_description(self) -> Optional[str]:
        value = (self.store_description or self.description or "").strip()
        return value or None

    def resolved_edrpou_ipn(self) -> Optional[str]:
        value = (self.edrpou_ipn or self.tax_id or "").strip()
        return value or None

    def resolved_iban(self) -> Optional[str]:
        value = (self.iban or self.payment_iban or "").strip()
        return value or None

    def resolved_bank(self) -> Optional[str]:
        value = (self.bank_name or self.payment_bank_name or "").strip()
        return value or None

    def resolved_channel(self) -> Optional[str]:
        if self.resolved_source_type() == "telegram":
            return self.resolved_telegram_channel_link()
        value = (self.channel_link or self.telegram_channel_url or "").strip()
        return value or None

    def resolved_legal_name(self) -> Optional[str]:
        value = (self.legal_name or self.payment_card_holder or "").strip()
        return value or None


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
    created_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    restored_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

class AdminManualAddRequest(BaseModel):
    name: str
    type: SupplierType
    contact_email: EmailStr
    xml_url: Optional[HttpUrl] = None
    shop_url: Optional[HttpUrl] = None
    telegram_channel: Optional[str] = None

class AdminTransferRequest(BaseModel):
    new_owner_telegram_id: int


class SupplierTransferRequest(BaseModel):
    """Адмін передає магазин користувачу за Telegram username."""
    new_owner_username: str = Field(min_length=1)


class SupplierTransferResponse(BaseModel):
    message: str = "Права успішно передано"


class TelegramChannelVerifyRequest(BaseModel):
    telegram_channel_link: str = Field(min_length=1)


class TelegramChannelVerifyResponse(BaseModel):
    message: str = "Доступ підтверджено"


class AICategorizationRuleCreate(BaseModel):
    keyword: str = Field(min_length=1, max_length=255)
    correct_category: str = Field(min_length=1, max_length=255)


class AICategorizationRuleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    keyword: str
    correct_category: str
    created_at: Optional[datetime] = None

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


class SupplierCreate(BaseModel):
    """Вхідні дані для створення постачальника з типом джерела товарів."""
    source_type: Optional[str] = "xml"  # "xml" або "telegram"
    telegram_channel_link: Optional[str] = None


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
    source_type: Optional[str] = "xml"
    telegram_channel_link: Optional[str] = None

    supplier_address: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None

    legal_name: Optional[str] = None
    ipn: Optional[str] = None
    edrpou: Optional[str] = None

    payout_method: Optional[PayoutMethod] = None
    payout_iban: Optional[str] = None
    payout_card_token: Optional[str] = None
    created_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    restored_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None


# --- МОДЕЛІ ДЛЯ `api/wallets.py` (Фінансове ядро: Wallet + Ledger) ---

class WalletResponse(BaseModel):
    """Гаманець поточного користувача. Усі суми — в копійках."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    main_balance: int = 0
    hold_balance: int = 0
    bonus_balance: int = 0
    updated_at: Optional[datetime] = None


class TransactionResponse(BaseModel):
    """Запис журналу транзакцій (Ledger). amount в копійках: > 0 — нарахування, < 0 — списання."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    wallet_id: int
    amount: int
    currency: str = "UAH"
    type: str
    description: Optional[str] = None
    reference_id: Optional[str] = None
    created_at: Optional[datetime] = None