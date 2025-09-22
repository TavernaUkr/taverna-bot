# config_reader.py
import logging
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

# Налаштовуємо логування для виводу інформації
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """
    Клас для читання та валідації всіх змінних середовища.
    Автоматично перетворює рядки на потрібні типи (int, bool, etc.).
    """
    # --- Основні налаштування бота ---
    bot_token: str
    admin_id: int
    bot_username: Optional[str] = None

    # --- Webhook патч---
    webhook_url: Optional[str] = None
    webhook_path: str = "/webhook" # Додаємо шлях з значенням за замовчуванням

    # --- Налаштування каналів ---
    main_channel: str  # Наприклад: '@taverna_army'
    test_channel: int
    test_channel_url: str
    supplier_channel: str
    review_chat: int # ID чату для відгуків, якщо не вказано, використовується ADMIN_ID

    # --- Налаштування клієнта Telegram (для парсингу каналу) ---
    tg_api_id: int
    tg_api_hash: str
    session_name: str = "bot1"

    # --- API MyDrop ---
    mydrop_api_key: str
    mydrop_export_url: str
    mydrop_orders_url: str
    supplier_name: str = "Landliz DROP"

    # --- API Нової Пошти (опціонально) ---
    np_api_key: Optional[str] = None
    np_api_url: Optional[str] = None
    
    # --- Сервіси Google (GDRIVE, GCS) ---
    use_gdrive: bool = False
    gdrive_folder_id: Optional[str] = None
    gdrive_orders_folder_name: str = "ZamovLandLiz"
    use_gcs: bool = False
    gcs_bucket: Optional[str] = None
    service_account_json: Optional[str] = None

    # --- Сервіси AI ---
    gemini_api_key: str

    # --- Логіка та деплой ---
    test_mode: bool = False
    page_size: int = 6
    orders_dir: str = "/data/orders"
    posted_ids_file_path: str = "/data/posted_ids.txt"
    webhook_url: Optional[str] = None

    # Конфігурація для Pydantic: вказуємо, що треба читати файл .env
    model_config = SettingsConfigDict(
        env_file=".env", 
        env_file_encoding="utf-8"
    )


# Створюємо єдиний екземпляр конфігурації, який будемо імпортувати
try:
    config = Settings()
    logger.info("✅ Конфігурацію успішно завантажено.")
except Exception as e:
    logger.error(f"❌ Помилка завантаження конфігурації: {e}")
    exit()