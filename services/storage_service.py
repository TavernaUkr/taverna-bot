# services/storage_service.py
"""
Завантаження файлів вітрини магазину (логотип / банер) у Supabase Storage.

Використовує той самий singleton-клієнт, що й services/supabase_storage.py
(telegram-медіа), щоб не плодити дублікати з'єднань і конфігурацію:
    * SUPABASE_URL / SUPABASE_KEY (+ SUPABASE_SERVICE_ROLE_KEY) — з .env
    * бакет taverna-assets (public) — логотипи та обкладинки магазинів.

Публічний API:
    upload_file(file_bytes, file_name, folder="shop_assets") -> url | ""
Ключ у бакеті: {folder}/{uuid}.{ext} — кириличні/спецсимволи виключені,
колізії імен неможливі (UUID), розширення визначаємо за сигнатурою байтів.
"""
import logging
from uuid import uuid4

from services.supabase_storage import (
    _get_supabase_client,
    _normalize_folder_path,
    _resolve_allowed_image_ext,
)

logger = logging.getLogger(__name__)

# Публічний бакет асетів магазину (логотип/банер). Бакет products — тільки
# медіа товарів з Telegram; taverna-assets створено окремо у Supabase.
ASSETS_BUCKET = "taverna-assets"

# Верхня межа розміру файлу вітрини: 8 МБ. Обкладинка/лого не мають бути
# більшими — це лише декор профілю магазину, а не фото товару.
MAX_ASSET_FILE_BYTES = 8 * 1024 * 1024

# Дозволені формати зображень для вітрини (БЕЗ відео — це avatar/cover,
# а не кружечки товару).
_ALLOWED_ASSET_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _as_public_url(result, storage_path: str) -> str:
    """Нормалізує відповідь get_public_url у публічний URL (без ?-хвостів)."""
    if isinstance(result, str):
        url = result
    elif isinstance(result, dict):
        url = str(result.get("publicUrl") or result.get("publicURL") or "")
    else:
        url = str(result or "")
    return url.strip().rstrip("?")


def upload_file(
    file_bytes: bytes,
    file_name: str,
    folder: str = "shop_assets",
) -> str:
    """
    Кладе файл у бакет `taverna-assets` і повертає публічний URL.

    - Ключ у бакеті: {folder}/{uuid}{ext} (UUID — колізії неможливі).
    - Формат валідується двічі: за розширенням імені + magic bytes.
    - Помилка/невалідний формат → порожній рядок (ендпоінт поверне 400/503).
    """
    if not file_bytes:
        logger.warning("storage_service.upload_file: порожній файл %s.", file_name)
        return ""
    if len(file_bytes) > MAX_ASSET_FILE_BYTES:
        logger.warning(
            "storage_service.upload_file: файл %s занадто великий (%s > %s).",
            file_name, len(file_bytes), MAX_ASSET_FILE_BYTES,
        )
        return ""

    # Розширення: з назви, інакше — magic bytes (.jpg/.png/.webp/.gif).
    resolved_ext = _resolve_allowed_image_ext(file_name, file_bytes)
    if not resolved_ext or resolved_ext not in _ALLOWED_ASSET_EXTENSIONS:
        logger.warning(
            "storage_service.upload_file: %s — не зображення .jpg/.png/.webp/.gif, відхилено.",
            file_name,
        )
        return ""

    safe_folder = _normalize_folder_path(folder)
    if not safe_folder:
        safe_folder = "shop_assets"
    # Логотип/банер — картинки: унікальне ім'я, розширення обов'язкове.
    ext = resolved_ext if resolved_ext.startswith(".") else f".{resolved_ext}"
    storage_path = f"{safe_folder}/{uuid4()}{ext}"

    try:
        supabase = _get_supabase_client()
        supabase.storage.from_(ASSETS_BUCKET).upload(
            storage_path,
            file_bytes,
            file_options={"content-type": _mime_for_ext(ext), "upsert": "false"},
        )
        try:
            public_url = _as_public_url(
                supabase.storage.from_(ASSETS_BUCKET).get_public_url(storage_path),
                storage_path,
            )
        except BaseException:
            public_url = _as_public_url(None, storage_path)
        if not public_url:
            # Fallback: повний публичний URL вручну (клієнт міг не віддати JSON).
            from config_reader import config

            base = str(getattr(config, "supabase_url", "") or "").strip().rstrip("/")
            if base:
                public_url = (
                    f"{base}/storage/v1/object/public/{ASSETS_BUCKET}/{storage_path}"
                )
        if public_url:
            logger.info("storage_service.upload_file: збережено %s", storage_path)
        return public_url
    except Exception as e:
        logger.error(
            "storage_service.upload_file: помилка завантаження %s: %s",
            storage_path, e,
        )
        return ""


def _mime_for_ext(ext: str) -> str:
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(ext.lower(), "application/octet-stream")
