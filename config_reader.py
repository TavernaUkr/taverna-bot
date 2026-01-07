# config_reader.py
import logging
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import SecretStr, AnyUrl, FilePath, field_validator, ConfigDict
from typing import Optional
from pathlib import Path

env_path = Path(__file__).parent / ".env" 
if not env_path.exists():
    env_path = Path(".env")
logging.info(f"Завантаження .env з: {env_path.resolve()}")

class Settings(BaseSettings):
    # --- Telegram Bot ---
    bot_token: SecretStr
    bot_username: str = "taverna_ukr_bot"
    admin_id: int
    
    # --- Канали (ОНОВЛЕНО - План 17.1 / 20.1) ---
    test_channel: int      # Тестовий канал адміна
    main_channel: int      # ID групи TavernaGroup (з "гілками")
    info_channel_id: int   # ID каналу TavernaInfo (для акцій)
    feedback_chat_id: int  # ID чату TavernaVoice (для відгуків)
    main_channel_url: str = "https://t.me/taverna_ukr_info" # Посилання на Info канал
    
    # --- Telethon ---
    tg_api_id: int
    tg_api_hash: SecretStr
    supplier_channel: str # @username
    session_name: str = "bot1"
    
    # --- MyDrop ---
    supplier_name: str = "LandLiz Drop"
    mydrop_api_key: SecretStr
    mydrop_export_url: AnyUrl
    mydrop_orders_url: AnyUrl
    
    # --- База даних та Redis ---
    database_url: AnyUrl
    redis_url: AnyUrl
    
    # --- AI та Сервіси ---
    gemini_api_key: SecretStr
    
    # --- Google Drive ---
    service_account_json: Optional[str] = None
    gdrive_folder_id: Optional[str] = None
    gdrive_orders_folder_name: str = "ZamovLandLiz"
    
    # --- Файли ---
    posted_ids_file_path: Path = Path("data/posted_ids.txt")
    
    # --- MiniApp ---
    webapp_url: Optional[AnyUrl] = None
    api_url: Optional[AnyUrl] = None
    
    # --- API Ключі (Фаза 3.3 / 4.1) ---
    np_api_key: Optional[SecretStr] = None 
    
    liqpay_public_key: Optional[str] = None
    liqpay_private_key: Optional[SecretStr] = None
    
    checkbox_api_key: Optional[SecretStr] = None 
    checkbox_login: Optional[str] = None 
    checkbox_password: Optional[SecretStr] = None 
    checkbox_cashier_id: Optional[str] = None 
    checkbox_kassa_id: Optional[str] = None
    prom_api_key: Optional[SecretStr] = None
    meta_app_id: Optional[str] = None
    meta_app_secret: Optional[SecretStr] = None
    meta_access_token: Optional[SecretStr] = None # (Довгоживучий токен)
    
    olx_client_id: Optional[str] = None
    olx_client_secret: Optional[SecretStr] = None

    mono_api_key: Optional[SecretStr] = None # (API токен ФОП)
    tax_jar_id: Optional[str] = None # (ID "Банки" на Податки 5%)
    ad_budget_jar_id: Optional[str] = None # (ID "Банки" на Рекламу)
    profit_jar_id: Optional[str] = None # (ID "Банки" на Чистий Прибуток)
    
    model_config = ConfigDict(
        env_file=env_path,
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Валідатор для шляху до файлу ID
    @field_validator('posted_ids_file_path', mode='before')
    def validate_posted_ids_path(cls, v):
        if isinstance(v, str): p = Path(v)
        elif isinstance(v, Path): p = v
        else: p = Path("data/posted_ids.txt")
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

try:
    config = Settings()
    if config.webapp_url and not config.api_url:
        config.api_url = config.webapp_url
except Exception as e:
    logging.error(f"!!! КРИТИЧНА ПОМИЛКА: Не вдалося завантажити конфігурацію з .env. !!!")
    logging.error(f"Шлях до .env: {env_path.resolve()}")
    logging.error(f"Помилка Pydantic: {e}")
    raise SystemExit(f"Помилка конфігурації: {e}")