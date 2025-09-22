import logging
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

# ... (без змін)
logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """
    Клас для читання та валідації всіх змінних середовища.
    """
    # --- Основні налаштування бота ---
    bot_token: str
    admin_id: int
    bot_username: str
    main_channel_url: str

    # --- Налаштування каналів ---
    main_channel: str
    test_channel: int
    test_channel_url: str
    supplier_channel: str
    # --- ЗМІНЕНО ---
    # Поле знову стало обов'язковим.
    review_chat: int

    # --- (решта змінних без змін) ---
    tg_api_id: int
    tg_api_hash: str
    session_name: str = "bot1"
    mydrop_api_key: str
    mydrop_export_url: str
    mydrop_orders_url: str
    supplier_name: str = "Landliz DROP"
    np_api_key: Optional[str] = None
    np_api_url: Optional[str] = None
    use_gdrive: bool = False
    gdrive_folder_id: Optional[str] = None
    gdrive_orders_folder_name: str = "ZamovLandLiz"
    use_gcs: bool = False
    gcs_bucket: Optional[str] = None
    service_account_json: Optional[str] = None
    gemini_api_key: str
    test_mode: bool = False
    page_size: int = 6
    orders_dir: str = "/data/orders"
    posted_ids_file_path: str = "/data/posted_ids.txt"
    webhook_url: Optional[str] = None
    webhook_path: str = "/webhook"

    model_config = SettingsConfigDict(
        env_file=".env", 
        env_file_encoding="utf-8"
    )

# ... (решта файлу без змін) ...
try:
    config = Settings()
    logger.info("✅ Конфігурацію успішно завантажено.")
except Exception as e:
    logger.error(f"❌ Помилка завантаження конфігурації: {e}")
    exit()
