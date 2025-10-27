# services/gdrive_service.py
import logging
import json
from io import BytesIO
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
from google.oauth2.service_account import Credentials

from config_reader import config

logger = logging.getLogger(__name__)

# --- Ініціалізація та отримання сервісу ---
_drive_service = None

def _get_credentials():
    """Внутрішня функція для отримання облікових даних."""
    try:
        creds_json = json.loads(config.service_account_json)
        return Credentials.from_service_account_info(
            creds_json, scopes=['https://www.googleapis.com/auth/drive']
        )
    except (json.JSONDecodeError, TypeError) as e:
        logger.error(f"Помилка парсингу SERVICE_ACCOUNT_JSON: {e}")
        return None

def get_drive_service():
    """Створює та повертає об'єкт для роботи з Google Drive API (Singleton)."""
    global _drive_service
    if _drive_service is None and config.use_gdrive:
        credentials = _get_credentials()
        if credentials:
            try:
                _drive_service = build('drive', 'v3', credentials=credentials)
                logger.info("✅ Сервіс Google Drive успішно ініціалізовано.")
            except Exception as e:
                logger.error(f"Не вдалося створити сервіс Google Drive: {e}")
    return _drive_service

# --- Робота з папками та файлами ---

def _find_or_create_folder(drive_service, folder_name: str, parent_folder_id: str):
    """Знаходить папку за назвою, якщо не знаходить - створює нову."""
    query = f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder' and '{parent_folder_id}' in parents and trashed=false"
    response = drive_service.files().list(q=query, spaces='drive', fields='files(id)').execute()
    files = response.get('files', [])
    if files:
        return files[0].get('id')
    
    logger.info(f"Папку '{folder_name}' не знайдено. Створюю нову...")
    folder_metadata = {'name': folder_name, 'mimeType': 'application/vnd.google-apps.folder', 'parents': [parent_folder_id]}
    folder = drive_service.files().create(body=folder_metadata, fields='id').execute()
    return folder.get('id')

async def save_post_files(post_text: str, image_bytes: bytes, photo_filename: str, text_filename: str):
    """
    Зберігає фото та текст поста в відповідні папки на Google Drive.
    - Фото зберігається в папку `FotoLandLiz`.
    - Текст зберігається в папку `PostLandLiz`.
    """
    drive_service = get_drive_service()
    if not drive_service:
        logger.warning("Спроба зберегти на GDrive, але сервіс не ініціалізовано.")
        return

    try:
        # 1. Знаходимо або створюємо головні папки для фото і текстів
        photo_parent_folder_id = _find_or_create_folder(drive_service, "FotoLandLiz", config.gdrive_folder_id)
        text_parent_folder_id = _find_or_create_folder(drive_service, "PostLandLiz", config.gdrive_folder_id)

        if not photo_parent_folder_id or not text_parent_folder_id:
            logger.error("Не вдалося знайти/створити базові папки на Google Drive.")
            return

        # 2. Зберігаємо файл зображення
        photo_metadata = {'name': photo_filename, 'parents': [photo_parent_folder_id]}
        media_photo = MediaIoBaseUpload(BytesIO(image_bytes), mimetype='image/jpeg', resumable=True)
        drive_service.files().create(body=photo_metadata, media_body=media_photo, fields='id').execute()
        
        # 3. Зберігаємо текстовий файл
        text_metadata = {'name': text_filename, 'parents': [text_parent_folder_id]}
        media_text = MediaIoBaseUpload(BytesIO(post_text.encode('utf-8')), mimetype='text/plain', resumable=True)
        drive_service.files().create(body=text_metadata, media_body=media_text, fields='id').execute()

        logger.info(f"✅ Файли {photo_filename} та {text_filename} успішно збережено на Google Drive.")

    except Exception as e:
        logger.error(f"Помилка під час збереження файлів на Google Drive: {e}")
        # Не кидаємо виняток далі, щоб не зупинити процес постингу