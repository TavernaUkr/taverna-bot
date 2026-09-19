# services/supabase_storage.py
"""Завантаження фото/відео з Telegram у публічний бакет Supabase Storage."""
import logging
import re

from config_reader import config

logger = logging.getLogger(__name__)

_BUCKET = "products"
_client = None

# Фото + гіфки + відео (кружечки товару) — фронтенд вміє автопрогравати
# .mp4/.webm через <video autoPlay loop muted playsInline>, .gif рендериться
# як звичайне зображення через <img>.
_ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm"}
_ALLOWED_IMAGE_MIME_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
    "video/mp4", "video/webm",
}


def _sniff_image_extension(file_bytes: bytes) -> str:
    """Визначає розширення медіафайлу за magic bytes (сигнатурою файлу)."""
    header = bytes(file_bytes[:16])
    if header.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return ".webp"
    if header.startswith(b"GIF87a") or header.startswith(b"GIF89a"):
        return ".gif"
    # MP4/MOV-контейнери: перші 4 байти — розмір box'у, далі "ftyp".
    if header[4:8] == b"ftyp":
        return ".mp4"
    # WebM/Matroska: EBML-сигнатура.
    if header.startswith(b"\x1a\x45\xdf\xa3"):
        return ".webm"
    return ""


def _resolve_allowed_image_ext(file_name: str, file_bytes: bytes) -> str:
    """
    Жорсткий фільтр: у Storage йдуть ТІЛЬКИ .jpg/.jpeg/.png/.webp/.gif/.mp4/.webm.
    Стікери (.tgs), документи (.pdf) та порожні файли — відсіюються.
    Якщо розширення в імені немає — пробуємо визначити тип за сигнатурою байтів.
    Повертає розширення, яке треба зберегти, або "" якщо файл не дозволено.
    """
    if not file_bytes:
        return ""
    name = (file_name or "").strip().lower()
    ext = "." + name.rsplit(".", 1)[-1] if "." in name else ""
    if ext in _ALLOWED_IMAGE_EXTENSIONS:
        return ext

    # Немає розширення (або невідоме) — пробуємо визначити тип за сигнатурою байтів.
    # Якщо й це не вдалось (mime необхідних доказів не дає) — ігноруємо файл.
    return _sniff_image_extension(file_bytes)


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


_UNSAFE_STORAGE_KEY_RE = re.compile(r"[^A-Za-z0-9_\-.]+")


def _ascii_safe_segment(part: str) -> str:
    """
    Supabase Storage повертає 400 InvalidKey, якщо ключ містить не-ASCII
    символи (напр. кирилицю в назві магазину). Захист "про всяк випадок"
    прямо на межі завантаження — навіть якщо якийсь виклик колись знову
    підставить сюди сире ім'я замість ID.
    """
    ascii_only = (part or "").encode("ascii", "ignore").decode("ascii")
    return _UNSAFE_STORAGE_KEY_RE.sub("_", ascii_only).strip("_") or "x"


def _normalize_folder_path(folder_path: str) -> str:
    raw = (folder_path or "").replace("\\", "/").strip().strip("/")
    parts = [p for p in raw.split("/") if p and p not in (".", "..")]
    safe_parts = [_ascii_safe_segment(p) for p in parts]
    return "/".join(safe_parts)


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

    # Жорсткий фільтр форматів: фото/гіфки/відео (.jpg/.jpeg/.png/.webp/.gif/.mp4/.webm).
    # Стікери/документи/биті файли сюди потрапити не повинні, навіть якщо
    # якийсь виклик все ж їх передасть.
    resolved_ext = _resolve_allowed_image_ext(name, file_bytes)
    if not resolved_ext:
        logger.warning(
            "upload_media_to_supabase: файл %s (%s) не є .jpg/.jpeg/.png/.webp/.gif/.mp4/.webm — завантаження скасовано.",
            name, content_type or "?",
        )
        return ""
    if not name.lower().endswith(resolved_ext):
        # Розширення визначили за сигнатурою байтів (в імені його не було) — підставляємо.
        base = name.rsplit(".", 1)[0] if "." in name else name
        name = f"{base}{resolved_ext}"

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
