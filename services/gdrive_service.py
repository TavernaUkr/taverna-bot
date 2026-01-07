# services/gdrive_service.py
import logging
import json
import tempfile
import os
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError

from config_reader import config

logger = logging.getLogger(__name__)

_gdrive_service = None

def _get_gdrive_service():
    """Ініціалізує та кешує GDrive service."""
    global _gdrive_service
    if _gdrive_service:
        return _gdrive_service

    if not config.service_account_json:
        logger.error("SERVICE_ACCOUNT_JSON не налаштовано. Google Drive не працюватиме.")
        return None
        
    try:
        info = json.loads(config.service_account_json)
        creds = Credentials.from_service_account_info(
            info, 
            scopes=["https://www.googleapis.com/auth/drive.file"]
        )
        _gdrive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
        logger.info("Сервіс Google Drive успішно ініціалізовано.")
        return _gdrive_service
    except json.JSONDecodeError:
        logger.error("SERVICE_ACCOUNT_JSON має невірний JSON формат.")
        return None
    except Exception as e:
        logger.error(f"Помилка ініціалізації GDrive: {e}", exc_info=True)
        return None

def _find_or_create_folder(service, folder_name: str, parent_folder_id: str) -> Optional[str]:
    """Знаходить або створює папку та повертає її ID."""
    try:
        query = (
            f"'{parent_folder_id}' in parents and "
            f"name = '{folder_name}' and "
            f"mimeType = 'application/vnd.google-apps.folder' and "
            f"trashed = false"
        )
        response = service.files().list(q=query, spaces='drive', fields='files(id)').execute()
        files = response.get('files', [])
        
        if files:
            return files[0].get('id')

        logger.info(f"GDrive: Папку '{folder_name}' не знайдено. Створюю нову...")
        folder_metadata = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [parent_folder_id]
        }
        folder = service.files().create(body=folder_metadata, fields='id').execute()
        return folder.get('id')
    except HttpError as e:
        logger.error(f"Помилка GDrive API під час пошуку/створення папки '{folder_name}': {e}")
        return None
    except Exception as e:
        logger.error(f"Неочікувана помилка GDrive (folder): {e}", exc_info=True)
        return None

async def upload_order_to_gdrive(order_uid: str, order_data: dict) -> bool:
    """
    Головна функція. Завантажує словник `order_data` як JSON файл на GDrive.
    """
    service = _get_gdrive_service()
    if not service or not config.gdrive_folder_id:
        logger.warning("GDrive service не налаштований. Завантаження замовлення пропущено.")
        return False

    try:
        # 1. Знаходимо/створюємо папку для замовлень (напр. "ZamovLandLiz")
        orders_parent_folder_id = _find_or_create_folder(
            service, 
            config.gdrive_orders_folder_name, 
            config.gdrive_folder_id
        )
        
        if not orders_parent_folder_id:
            logger.error("Не вдалося знайти або створити головну папку для замовлень GDrive.")
            return False

        # 2. Конвертуємо dict в JSON-рядок
        order_json_str = json.dumps(order_data, ensure_ascii=False, indent=4)
        
        # 3. Створюємо тимчасовий файл для завантаження
        # (GDrive API v3 вимагає завантаження з файлу)
        with tempfile.NamedTemporaryFile(delete=False, mode='w', encoding='utf-8', suffix=".json") as tmp_file:
            tmp_file.write(order_json_str)
            tmp_filepath = tmp_file.name

        file_name = f"{order_uid}.json"
        
        # 4. Завантажуємо файл
        file_metadata = {'name': file_name, 'parents': [orders_parent_folder_id]}
        media = MediaFileUpload(tmp_filepath, mimetype='application/json')
        
        service.files().create(body=file_metadata, media_body=media, fields="id").execute()
        
        logger.info(f"Замовлення {order_uid} успішно завантажено на Google Drive.")
        return True
        
    except HttpError as e:
        logger.error(f"Помилка GDrive API під час завантаження файлу '{file_name}': {e}")
        return False
    except Exception as e:
        logger.error(f"Неочікувана помилка GDrive (upload): {e}", exc_info=True)
        return False
    finally:
        # 5. Гарантовано видаляємо тимчасовий файл
        if 'tmp_filepath' in locals() and os.path.exists(tmp_filepath):
            os.remove(tmp_filepath)