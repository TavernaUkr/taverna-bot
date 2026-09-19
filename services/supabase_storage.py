# services/supabase_storage.py
"""Завантаження фото/відео з Telegram у публічний бакет Supabase Storage."""
import logging

from config_reader import config

logger = logging.getLogger(__name__)

_BUCKET = "products"
_client = None


def _secret(value) -> str:
    if value is None:
        return ""
    if hasattr(value, "get_secret_value"):
        return str(value.get_secret_value() or "").strip()
    return str(value).strip()


def _supabase_url() -> str:
    return (getattr(config, "supabase_url", None) or "").strip().rstrip("/")


def _supabase_key() -> str:
    service = _secret(getattr(config, "supabase_service_role_key", None))
    if service:
        return service
    return _secret(getattr(config, "supabase_key", None))


def _get_supabase_client():
    """Один клієнт на процес. У database.db його немає — беремо URL/ключ з config_reader."""
    global _client
    if _client is not None:
        return _client

    url = _supabase_url()
    key = _supabase_key()
    if not url or not key:
        raise RuntimeError(
            "Supabase не налаштовано: у .env потрібні SUPABASE_URL і "
            "SUPABASE_SERVICE_ROLE_KEY (або SUPABASE_KEY)."
        )

    try:
        from supabase import create_client
    except ImportError as e:
        raise RuntimeError(
            "Пакет supabase не встановлено. Виконай: pip install supabase"
        ) from e

    _client = create_client(url, key)
    return _client


def _normalize_folder_path(folder_path: str) -> str:
    raw = (folder_path or "").replace("\\", "/").strip().strip("/")
    parts = [p for p in raw.split("/") if p and p not in (".", "..")]
    return "/".join(parts)


def _as_public_url(result, storage_path: str) -> str:
    if isinstance(result, str):
        url = result
    elif isinstance(result, dict):
        url = str(result.get("publicUrl") or result.get("publicURL") or "")
    else:
        url = str(result or "")
    url = url.strip().rstrip("?")
    if url:
        return url
    base = _supabase_url()
    if not base:
        return ""
    return f"{base}/storage/v1/object/public/{_BUCKET}/{storage_path}"


def upload_media_to_supabase(
    file_bytes: bytes,
    file_name: str,
    content_type: str,
    folder_path: str,
) -> str:
    """
    Кладе файл у бакет `products` за шляхом `{folder_path}/{file_name}`
    і повертає публічний URL. Помилка — порожній рядок (парсинг тексту триває).
    """
    if not file_bytes:
        logger.warning("upload_media_to_supabase: порожні байти, файл %s пропущено.", file_name)
        return ""
    name = (file_name or "").strip().lstrip("/")
    if not name:
        logger.warning("upload_media_to_supabase: порожнє ім'я файлу.")
        return ""
    folder = _normalize_folder_path(folder_path)
    if not folder:
        logger.warning("upload_media_to_supabase: порожній folder_path.")
        return ""
    mime = (content_type or "application/octet-stream").strip()
    storage_path = f"{folder}/{name}"

    try:
        supabase = _get_supabase_client()
        supabase.storage.from_(_BUCKET).upload(
            storage_path,
            file_bytes,
            file_options={
                "content-type": mime,
                "upsert": "true",
            },
        )
        try:
            public_url = _as_public_url(
                supabase.storage.from_(_BUCKET).get_public_url(storage_path),
                storage_path,
            )
        except BaseException:
            public_url = _as_public_url(None, storage_path)
        if not public_url:
            logger.warning("upload_media_to_supabase: get_public_url порожній для %s.", storage_path)
            return ""
        logger.info("upload_media_to_supabase: збережено %s", storage_path)
        return public_url
    except Exception as e:
        logger.error(f"Supabase Upload Error: {str(e)} | Type: {type(e)}")
        return ""
    except BaseException as e:
        logger.error(f"Supabase Upload Error: {str(e)} | Type: {type(e)}")
        return ""


def _storage_path_from_public_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    marker = f"/object/public/{_BUCKET}/"
    idx = raw.find(marker)
    if idx < 0:
        return ""
    path = raw[idx + len(marker):].split("?", 1)[0].lstrip("/")
    return path


def delete_product_pictures_from_supabase(pictures) -> int:
    """
    Прибирає файли нашого бакета products. Чужі URL (YML) не чіпає.
    Помилка Storage — 0, записи в БД все одно можна видаляти далі.
    """
    urls: list[str] = []
    if isinstance(pictures, str) and pictures.strip():
        urls = [pictures.strip()]
    elif isinstance(pictures, list):
        for item in pictures:
            if isinstance(item, str) and item.strip():
                urls.append(item.strip())
            elif isinstance(item, dict):
                for key in ("url", "src", "publicUrl", "publicURL"):
                    val = str(item.get(key) or "").strip()
                    if val:
                        urls.append(val)
                        break
    paths = []
    seen = set()
    for url in urls:
        path = _storage_path_from_public_url(url)
        if path and path not in seen:
            seen.add(path)
            paths.append(path)
    if not paths:
        return 0
    try:
        supabase = _get_supabase_client()
        supabase.storage.from_(_BUCKET).remove(paths)
        logger.info("Supabase remove: %s файл(ів).", len(paths))
        return len(paths)
    except Exception as e:
        logger.warning("Supabase remove пропущено: %s", e)
        return 0
