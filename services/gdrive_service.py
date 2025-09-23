# services/gdrive_service.py
import json
import logging

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import gspread

# Імпортуємо наш централізований конфіг
from config_reader import config

# Налаштовуємо логер для цього файлу
logger = logging.getLogger(__name__)

# Визначаємо необхідні права доступу для API
SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
]

def _get_credentials():
    """
    Внутрішня функція для отримання облікових даних з конфігурації.
    Ніколи не викликається ззовні цього файлу.
    """
    if not config.service_account_json:
        logger.error("SERVICE_ACCOUNT_JSON не знайдено в конфігурації.")
        return None
    try:
        # Pydantic автоматично обробляє екранування, але ми можемо
        # додатково перевірити та завантажити JSON.
        creds_json = json.loads(config.service_account_json)
        credentials = Credentials.from_service_account_info(
            creds_json, scopes=SCOPES
        )
        return credentials
    except (json.JSONDecodeError, TypeError) as e:
        logger.error(f"Помилка парсингу SERVICE_ACCOUNT_JSON: {e}")
        return None

def get_drive_service():
    """Створює та повертає об'єкт для роботи з Google Drive API."""
    credentials = _get_credentials()
    if not credentials:
        return None
    try:
        service = build('drive', 'v3', credentials=credentials)
        logger.info("✅ Сервіс Google Drive успішно ініціалізовано.")
        return service
    except Exception as e:
        logger.error(f"Не вдалося створити сервіс Google Drive: {e}")
        return None

def get_sheets_client():
    """Створює та повертає клієнт для роботи з Google Sheets API."""
    credentials = _get_credentials()
    if not credentials:
        return None
    try:
        client = gspread.authorize(credentials)
        logger.info("✅ Клієнт Google Sheets успішно ініціалізовано.")
        return client
    except Exception as e:
        logger.error(f"Не вдалося створити клієнт Google Sheets: {e}")
        return None

def find_or_create_folder(drive_service, folder_name: str, parent_folder_id: str):
    """Знаходить папку за назвою, якщо не знаходить - створює нову."""
    query = f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder' and '{parent_folder_id}' in parents and trashed=false"
    try:
        response = drive_service.files().list(q=query, spaces='drive', fields='files(id, name)').execute()
        files = response.get('files', [])
        if files:
            logger.info(f"Знайдено папку '{folder_name}' з ID: {files[0].get('id')}")
            return files[0].get('id')
        else:
            file_metadata = {
                'name': folder_name,
                'mimeType': 'application/vnd.google-apps.folder',
                'parents': [parent_folder_id]
            }
            folder = drive_service.files().create(body=file_metadata, fields='id').execute()
            logger.info(f"Створено нову папку '{folder_name}' з ID: {folder.get('id')}")
            return folder.get('id')
    except HttpError as error:
        logger.error(f"Помилка при пошуку або створенні папки: {error}")
        return None

def create_order_sheet_in_gdrive(order_data: dict):
    """
    Головна функція: створює папку для замовлень (якщо її немає)
    та новий Google Sheet файл з даними замовлення.
    """
    if not config.use_gdrive:
        logger.info("Робота з Google Drive вимкнена в конфігурації.")
        return None

    drive_service = get_drive_service()
    sheets_client = get_sheets_client()

    if not drive_service or not sheets_client:
        logger.error("Не вдалося ініціалізувати сервіси Google. Операцію скасовано.")
        return None

    # Знаходимо або створюємо папку для замовлень
    orders_folder_id = find_or_create_folder(
        drive_service,
        folder_name=config.gdrive_orders_folder_name,
        parent_folder_id=config.gdrive_folder_id
    )

    if not orders_folder_id:
        return None

    try:
        # Створюємо новий Google Sheet
        order_id = order_data.get("id", "N/A")
        customer_name = order_data.get("name", "Unknown")
        spreadsheet_title = f"Замовлення #{order_id} - {customer_name}"
        
        spreadsheet = sheets_client.create(spreadsheet_title, folder_id=orders_folder_id)
        worksheet = spreadsheet.get_worksheet(0)
        
        # Додаємо заголовки та дані (приклад)
        headers = list(order_data.keys())
        values = list(order_data.values())
        worksheet.append_row(headers)
        worksheet.append_row(values)

        logger.info(f"Створено Google Sheet для замовлення: {spreadsheet.url}")
        return spreadsheet.url
    except Exception as e:
        logger.error(f"Помилка при створенні Google Sheet: {e}")
        return None

# --- Функції для роботи з постами (поки що заглушки) ---

async def save_post_to_drive(post_text: str, image_bytes: bytes, sku: str):
    """
    Зберігає текст та фото поста в Google Drive.
    TODO: Реалізувати логіку збереження файлів.
    """
    logger.info(f"Викликано збереження поста з артикулом {sku} в Google Drive.")
    # Тут буде ваша логіка:
    # 1. Отримати drive_service
    # 2. Створити папку для постів, якщо її немає
    # 3. Зберегти image_bytes як файл зображення
    # 4. Зберегти post_text як текстовий файл або в Google Docs
    pass

async def get_random_post_from_drive():
    """
    Дістає випадковий раніше збережений пост з Google Drive.
    TODO: Реалізувати логіку отримання файлів.
    """
    logger.info("Викликано отримання випадкового поста з Google Drive.")
    # Тут буде ваша логіка:
    # 1. Отримати drive_service
    # 2. Отримати список файлів з папки постів
    # 3. Вибрати випадковий
    # 4. Повернути його вміст
    return None