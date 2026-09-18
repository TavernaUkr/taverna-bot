# services/telegram_parser.py
"""Парсинг публічних Telegram-каналів постачальників (Telethon + Gemini)."""
import asyncio
import logging
import re
import sqlite3
from pathlib import Path
from typing import Optional, Union
from uuid import uuid4

from telethon import TelegramClient
from telethon.errors import (
    ChannelPrivateError,
    FloodWaitError,
    UsernameInvalidError,
    UsernameNotOccupiedError,
)

from config_reader import config
from services.supabase_storage import upload_media_to_supabase

logger = logging.getLogger(__name__)

_client_lock = asyncio.Lock()
_CONNECT_RETRIES = 5
_CONNECT_RETRY_SLEEP = 1.5
_SCRAPER_SESSION_PATH = Path(__file__).resolve().parent.parent / "scraper_session"
_SCRAPER_UNAUTHORIZED = "Юзербот не авторизований. Запустіть auth_scraper.py"
_scraper_client: Optional[TelegramClient] = None


class TelegramChannelParseError(Exception):
    """Канал не прочитано: немає доступу, не знайдено, або Telethon не готовий."""


class TelegramChannelParser:
    """Перетворює пости Telegram-каналу на стандартизований JSON товару."""

    async def parse_post_to_product_json(self, text: str, images: list[str]) -> dict:
        """
        Перетворює сирий текст поста Telegram на стандартизований JSON товару.

        Цей метод буде звертатися до Gemini для перетворення сирого тексту поста
        на стандартизований JSON з полями:
        - name
        - price
        - sizes
        - description
        - image_urls

        Args:
            text: Текст поста з Telegram-каналу.
            images: Список URL зображень з поста.

        Returns:
            dict зі стандартизованими полями товару.
            Поки що заглушка: повертає порожній словник.
        """
        return {}


def _secret(value) -> str:
    if value is None:
        return ""
    if hasattr(value, "get_secret_value"):
        return str(value.get_secret_value())
    return str(value)


def _normalize_channel_ref(channel_link: str) -> Union[str, int]:
    raw = (channel_link or "").strip()
    if not raw:
        raise TelegramChannelParseError("Порожнє посилання на Telegram-канал.")

    lower = raw.lower()
    if "/+" in raw or "joinchat" in lower:
        raise TelegramChannelParseError(
            "Це приватне invite-посилання. Потрібен публічний канал "
            "у форматі @username або t.me/username."
        )

    cleaned = raw.replace("https://", "").replace("http://", "")
    cleaned = cleaned.replace("www.", "")
    for prefix in ("t.me/", "telegram.me/", "telegram.dog/"):
        if cleaned.lower().startswith(prefix):
            cleaned = cleaned[len(prefix):]
            break
    cleaned = cleaned.split("?")[0].split("#")[0].strip("/")
    if cleaned.lower().startswith("s/"):
        cleaned = cleaned[2:]
    cleaned = cleaned.lstrip("@")

    parts = [p for p in cleaned.split("/") if p]
    if not parts:
        raise TelegramChannelParseError(
            f"Не вдалося розпізнати канал з посилання: {channel_link}"
        )

    if parts[0].lower() == "c" and len(parts) >= 2 and parts[1].isdigit():
        return int(f"-100{parts[1]}")

    username = parts[0]
    if not username:
        raise TelegramChannelParseError(
            f"Не вдалося розпізнати канал з посилання: {channel_link}"
        )
    return username


_PHOTO_LINE_RE = re.compile(r"Фото товару:\s*(\S+)", re.IGNORECASE)


def extract_photo_urls_from_text(text: str) -> list[str]:
    """Витягує публічні URL рядків 'Фото товару: ...' з тексту поста."""
    urls: list[str] = []
    for match in _PHOTO_LINE_RE.finditer(text or ""):
        url = match.group(1).strip().rstrip(".,;)]}>")
        if url.startswith("http") and url not in urls:
            urls.append(url)
    return urls


def _media_filename_and_type(message) -> tuple[str, str]:
    photo = getattr(message, "photo", None)
    if photo:
        return f"{uuid4()}.jpg", "image/jpeg"

    document = getattr(message, "document", None)
    mime = ""
    if document is not None:
        mime = str(getattr(document, "mime_type", None) or "").strip()
        for attr in getattr(document, "attributes", None) or []:
            raw_name = str(getattr(attr, "file_name", None) or "").strip()
            if raw_name and "." in raw_name:
                ext = "." + raw_name.rsplit(".", 1)[-1].lower()
                return f"{uuid4()}{ext}", mime or "application/octet-stream"

    video = getattr(message, "video", None)
    if video or (mime.startswith("video/")):
        mime = mime or str(getattr(video, "mime_type", None) or "video/mp4")
        ext = ".webm" if "webm" in mime else ".mp4"
        return f"{uuid4()}{ext}", mime

    if mime.startswith("image/"):
        subtype = mime.split("/", 1)[-1].split(";")[0].strip() or "jpeg"
        ext = ".jpg" if subtype in ("jpeg", "jpg") else f".{subtype}"
        return f"{uuid4()}{ext}", mime

    return f"{uuid4()}.bin", mime or "application/octet-stream"


def _coerce_telegram_message_id(raw) -> Optional[int]:
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw if raw > 0 else None
    text = str(raw).strip()
    if text.isdigit():
        value = int(text)
        return value if value > 0 else None
    match = re.search(r"(\d{1,12})", text)
    if not match:
        return None
    value = int(match.group(1))
    return value if value > 0 else None


def _normalize_image_urls(raw) -> list[str]:
    urls: list[str] = []
    if isinstance(raw, str):
        candidate = raw.strip()
        if candidate.startswith("http"):
            urls.append(candidate)
        else:
            urls.extend(extract_photo_urls_from_text(candidate))
        return urls
    if isinstance(raw, list):
        for item in raw:
            value = str(item or "").strip()
            if value.startswith("http") and value not in urls:
                urls.append(value)
    return urls


async def extract_and_upload_message_media(client: TelegramClient, message) -> list[str]:
    """
    Якщо в пості є медіа — качає в пам'ять і кладе в Supabase Storage.
    Помилка завантаження не валить парсинг тексту: повертає [].
    """
    if client is None or message is None or not getattr(message, "media", None):
        return []
    try:
        media_bytes = await client.download_media(message, file=bytes)
        if not media_bytes:
            logger.info(
                "telegram_parser: медіа поста #%s порожнє — парсимо лише текст.",
                getattr(message, "id", "?"),
            )
            return []
        if not isinstance(media_bytes, (bytes, bytearray)):
            logger.warning(
                "telegram_parser: download_media поста #%s повернув %s — парсимо текст.",
                getattr(message, "id", "?"), type(media_bytes).__name__,
            )
            return []
        file_name, content_type = _media_filename_and_type(message)
        loop = asyncio.get_running_loop()
        public_url = await loop.run_in_executor(
            None,
            upload_media_to_supabase,
            bytes(media_bytes),
            file_name,
            content_type,
        )
        if public_url:
            return [public_url]
        logger.warning(
            "telegram_parser: Supabase не повернув URL для поста #%s — парсимо текст.",
            getattr(message, "id", "?"),
        )
        return []
    except Exception as e:
        logger.warning(
            "telegram_parser: не вдалося завантажити медіа поста #%s: %s",
            getattr(message, "id", "?"), e,
        )
        return []


def _format_post(message, public_urls: Optional[list[str]] = None) -> Optional[str]:
    text = (getattr(message, "message", None) or "").strip()
    flags = []
    if getattr(message, "photo", None):
        flags.append("є фото")
    elif getattr(message, "video", None):
        flags.append("є відео")
    elif getattr(message, "media", None):
        flags.append("є медіа")
    urls = [u for u in (public_urls or []) if u]
    if not text and not flags and not urls:
        return None
    header = f"Пост #{getattr(message, 'id', '?')}"
    if flags:
        header += f" [{', '.join(flags)}]"
    parts = [header]
    if text:
        parts.append(text)
    for url in urls:
        parts.append(f"Фото товару: {url}")
    return "\n".join(parts)


def _is_session_locked(exc: BaseException) -> bool:
    if isinstance(exc, sqlite3.OperationalError):
        return True
    return "locked" in str(exc).lower()


def _get_scraper_client() -> TelegramClient:
    """Окремий юзербот (scraper_session), не основний бот з telethon_service."""
    global _scraper_client
    if _scraper_client is None:
        _scraper_client = TelegramClient(
            str(_SCRAPER_SESSION_PATH),
            config.tg_api_id,
            _secret(config.tg_api_hash),
        )
    return _scraper_client


async def _ensure_scraper_client() -> TelegramClient:
    """
    Підключає юзербота для GetHistory / iter_messages.
    Без .start(bot_token): ботам Telegram забороняє читати історію каналу.
    """
    if not config.tg_api_id or not config.tg_api_hash:
        raise TelegramChannelParseError(
            "Telethon не налаштовано: у .env немає TG_API_ID / TG_API_HASH."
        )

    scraper = _get_scraper_client()
    last_error: Optional[Exception] = None
    for attempt in range(1, _CONNECT_RETRIES + 1):
        try:
            if not scraper.is_connected():
                await scraper.connect()
            if not await scraper.is_user_authorized():
                raise TelegramChannelParseError(_SCRAPER_UNAUTHORIZED)
            if attempt == 1:
                logger.info("telegram_parser: юзербот scraper_session підключено.")
            return scraper
        except TelegramChannelParseError:
            raise
        except Exception as e:
            last_error = e
            if _is_session_locked(e) and attempt < _CONNECT_RETRIES:
                logger.warning(
                    "telegram_parser: scraper session locked (спроба %s/%s): %s — пауза %.1f с.",
                    attempt, _CONNECT_RETRIES, e, _CONNECT_RETRY_SLEEP,
                )
                await asyncio.sleep(_CONNECT_RETRY_SLEEP)
                continue
            if _is_session_locked(e):
                logger.error(
                    "telegram_parser: scraper session locked після %s спроб: %s",
                    _CONNECT_RETRIES, e, exc_info=True,
                )
                raise TelegramChannelParseError(
                    "Telethon-сесія зайнята (database is locked). "
                    "Спробуйте ще раз за кілька секунд."
                ) from e
            logger.error("telegram_parser: не вдалося підключити юзербота: %s", e, exc_info=True)
            raise TelegramChannelParseError(
                f"Не вдалося підключити юзербота: {e}"
            ) from e

    raise TelegramChannelParseError(
        f"Не вдалося підключити юзербота: {last_error}"
    )


async def _ensure_client() -> TelegramClient:
    """Читання історії каналів — лише через юзербота scraper_session."""
    return await _ensure_scraper_client()


async def get_recent_channel_posts(
    channel_link: str,
    limit: int = 15,
    upload_media: bool = True,
) -> str:
    """
    Читає останні пости публічного Telegram-каналу через Telethon.

    `channel_link`: t.me/my_channel або @my_channel.
    Повертає єдиний текстовий блок (текст поста + публічні URL фото з Supabase).
    `upload_media=False` — лише текст (для швидкої оцінки каналу без Storage).
    """
    channel_ref = _normalize_channel_ref(channel_link)
    take = max(1, min(int(limit or 15), 50))

    async with _client_lock:
        try:
            client = await _ensure_client()
        except TelegramChannelParseError:
            raise
        except Exception as e:
            logger.error("get_recent_channel_posts connect: %s", e, exc_info=True)
            raise TelegramChannelParseError(
                "Telethon зайнятий. Спробуйте ще раз за кілька секунд."
            ) from e
        try:
            entity = await client.get_entity(channel_ref)
        except UsernameNotOccupiedError as e:
            raise TelegramChannelParseError(
                f"Канал не знайдено: {channel_link}"
            ) from e
        except UsernameInvalidError as e:
            raise TelegramChannelParseError(
                f"Некоректне посилання на канал: {channel_link}"
            ) from e
        except ChannelPrivateError as e:
            raise TelegramChannelParseError(
                f"Канал приватний або акаунт-парсер не має доступу до {channel_link}. "
                "Для приватних каналів додайте акаунт-парсер у канал."
            ) from e
        except FloodWaitError as e:
            raise TelegramChannelParseError(
                f"Telegram просить зачекати {getattr(e, 'seconds', '?')} с. Спробуйте пізніше."
            ) from e
        except Exception as e:
            err = str(e).lower()
            if "private" in err or "not a member" in err:
                raise TelegramChannelParseError(
                    f"Немає доступу до каналу {channel_link}. "
                    "Канал приватний або акаунт-парсер не має доступу."
                ) from e
            logger.error("get_recent_channel_posts get_entity(%s): %s", channel_link, e, exc_info=True)
            raise TelegramChannelParseError(
                f"Не вдалося відкрити канал {channel_link}: {e}"
            ) from e

        chunks = []
        try:
            async for message in client.iter_messages(entity, limit=take):
                public_urls: list[str] = []
                if upload_media:
                    public_urls = await extract_and_upload_message_media(client, message)
                formatted = _format_post(message, public_urls)
                if formatted:
                    chunks.append(formatted)
        except ChannelPrivateError as e:
            raise TelegramChannelParseError(
                f"Канал приватний або акаунт-парсер не має доступу до {channel_link}."
            ) from e
        except FloodWaitError as e:
            raise TelegramChannelParseError(
                f"Telegram просить зачекати {getattr(e, 'seconds', '?')} с. Спробуйте пізніше."
            ) from e
        except Exception as e:
            logger.error("get_recent_channel_posts iter_messages(%s): %s", channel_link, e, exc_info=True)
            raise TelegramChannelParseError(
                f"Не вдалося прочитати пости каналу {channel_link}: {e}"
            ) from e

    if not chunks:
        raise TelegramChannelParseError(
            f"У каналі {channel_link} немає текстових постів для аналізу."
        )

    logger.info(
        "get_recent_channel_posts: з %s зібрано %s постів.",
        channel_link, len(chunks),
    )
    numbered = [f"{i}. {block}" for i, block in enumerate(chunks, 1)]
    return "\n\n".join(numbered)


async def fetch_channel_posts_page(
    channel_link: str,
    *,
    limit: int = 10,
    offset_id: int = 0,
    upload_media: bool = True,
) -> tuple[list[dict], int, int, bool]:
    """
    Одна сторінка каналу через Telethon iter_messages.

    Повертає: (пости, next_offset_id, скільки повідомлень прочитано, канал_закінчився).
    Кожен пост: message_id, formatted, text, username, chat_id.
    """
    channel_ref = _normalize_channel_ref(channel_link)
    take = max(1, min(int(limit or 10), 50))
    posts: list[dict] = []
    next_offset = int(offset_id or 0)
    fetched = 0

    async with _client_lock:
        try:
            client = await _ensure_client()
        except TelegramChannelParseError:
            raise
        except Exception as e:
            logger.error("fetch_channel_posts_page connect: %s", e, exc_info=True)
            raise TelegramChannelParseError(
                "Telethon зайнятий. Спробуйте ще раз за кілька секунд."
            ) from e
        try:
            entity = await client.get_entity(channel_ref)
        except UsernameNotOccupiedError as e:
            raise TelegramChannelParseError(
                f"Канал не знайдено: {channel_link}"
            ) from e
        except UsernameInvalidError as e:
            raise TelegramChannelParseError(
                f"Некоректне посилання на канал: {channel_link}"
            ) from e
        except ChannelPrivateError as e:
            raise TelegramChannelParseError(
                f"Канал приватний або акаунт-парсер не має доступу до {channel_link}. "
                "Для приватних каналів додайте акаунт-парсер у канал."
            ) from e
        except FloodWaitError as e:
            wait_s = int(getattr(e, "seconds", 5) or 5)
            logger.warning(
                "fetch_channel_posts_page FloodWait %s: чекаємо %s с.",
                channel_link, wait_s,
            )
            await asyncio.sleep(wait_s + 1)
            entity = await client.get_entity(channel_ref)
        except Exception as e:
            err = str(e).lower()
            if "private" in err or "not a member" in err:
                raise TelegramChannelParseError(
                    f"Немає доступу до каналу {channel_link}. "
                    "Канал приватний або акаунт-парсер не має доступу."
                ) from e
            logger.error("fetch_channel_posts_page get_entity(%s): %s", channel_link, e, exc_info=True)
            raise TelegramChannelParseError(
                f"Не вдалося відкрити канал {channel_link}: {e}"
            ) from e

        username = getattr(entity, "username", None)
        chat_id = getattr(entity, "id", None)
        iter_kwargs = {"limit": take}
        if next_offset:
            iter_kwargs["offset_id"] = next_offset

        flood_hit = False
        try:
            async for message in client.iter_messages(entity, **iter_kwargs):
                fetched += 1
                next_offset = int(getattr(message, "id", 0) or 0)
                public_urls: list[str] = []
                if upload_media:
                    public_urls = await extract_and_upload_message_media(client, message)
                formatted = _format_post(message, public_urls)
                if not formatted:
                    continue
                posts.append({
                    "message_id": int(getattr(message, "id", 0) or 0),
                    "formatted": formatted,
                    "text": (getattr(message, "message", None) or "").strip(),
                    "username": username,
                    "chat_id": chat_id,
                })
        except ChannelPrivateError as e:
            raise TelegramChannelParseError(
                f"Канал приватний або акаунт-парсер не має доступу до {channel_link}."
            ) from e
        except FloodWaitError as e:
            flood_hit = True
            wait_s = int(getattr(e, "seconds", 5) or 5)
            logger.warning(
                "fetch_channel_posts_page iter FloodWait %s: чекаємо %s с.",
                channel_link, wait_s,
            )
            await asyncio.sleep(wait_s + 1)
        except Exception as e:
            logger.error("fetch_channel_posts_page iter_messages(%s): %s", channel_link, e, exc_info=True)
            raise TelegramChannelParseError(
                f"Не вдалося прочитати пости каналу {channel_link}: {e}"
            ) from e

    done = (not flood_hit) and fetched < take
    logger.info(
        "fetch_channel_posts_page: %s offset=%s fetched=%s formatted=%s done=%s",
        channel_link, offset_id, fetched, len(posts), done,
    )
    return posts, next_offset, fetched, done


VERIFY_MIN_POSTS = 30
_VERIFY_PRIVATE = {"status": "error", "reason": "private_or_not_found"}


async def verify_channel_access(channel_link: str) -> dict:
    """
    Жива перевірка доступу юзербота до каналу (без Exception назовні).

    Повертає:
      {"status": "ok"}
      {"status": "error", "reason": "private_or_not_found"}
      {"status": "error", "reason": "not_enough_posts", "count": int}
    """
    try:
        channel_ref = _normalize_channel_ref(channel_link)
    except (TelegramChannelParseError, ValueError) as e:
        logger.warning("verify_channel_access: посилання %s: %s", channel_link, e)
        return dict(_VERIFY_PRIVATE)
    except Exception as e:
        logger.error("verify_channel_access normalize(%s): %s", channel_link, e, exc_info=True)
        return dict(_VERIFY_PRIVATE)

    count = 0
    try:
        async with _client_lock:
            try:
                client = await _ensure_client()
            except (TelegramChannelParseError, ValueError, ChannelPrivateError, sqlite3.OperationalError) as e:
                logger.warning("verify_channel_access client: %s", e)
                err = str(e).lower()
                if _is_session_locked(e) or "locked" in err:
                    return {"status": "error", "reason": "session_locked"}
                if "auth_scraper" in err or "юзербот не авторизований" in err:
                    return {"status": "error", "reason": "userbot_unauthorized"}
                return dict(_VERIFY_PRIVATE)
            except Exception as e:
                logger.warning("verify_channel_access client: %s", e)
                if _is_session_locked(e):
                    return {"status": "error", "reason": "session_locked"}
                if "auth_scraper" in str(e).lower():
                    return {"status": "error", "reason": "userbot_unauthorized"}
                return dict(_VERIFY_PRIVATE)

            try:
                entity = await client.get_entity(channel_ref)
            except (
                ChannelPrivateError,
                ValueError,
                UsernameNotOccupiedError,
                UsernameInvalidError,
            ):
                return dict(_VERIFY_PRIVATE)
            except FloodWaitError as e:
                logger.warning(
                    "verify_channel_access FloodWait %s: %s с",
                    channel_link, getattr(e, "seconds", "?"),
                )
                return dict(_VERIFY_PRIVATE)
            except Exception as e:
                err = str(e).lower()
                logger.warning("verify_channel_access get_entity(%s): %s", channel_link, e)
                if "private" in err or "not a member" in err or "not found" in err:
                    return dict(_VERIFY_PRIVATE)
                return dict(_VERIFY_PRIVATE)

            try:
                async for _message in client.iter_messages(entity, limit=VERIFY_MIN_POSTS):
                    count += 1
            except (ChannelPrivateError, ValueError):
                return dict(_VERIFY_PRIVATE)
            except FloodWaitError as e:
                logger.warning(
                    "verify_channel_access iter FloodWait %s: %s с",
                    channel_link, getattr(e, "seconds", "?"),
                )
                return dict(_VERIFY_PRIVATE)
            except Exception as e:
                logger.warning("verify_channel_access iter_messages(%s): %s", channel_link, e)
                return dict(_VERIFY_PRIVATE)
    except Exception as e:
        logger.error("verify_channel_access(%s): %s", channel_link, e, exc_info=True)
        return dict(_VERIFY_PRIVATE)

    if count < VERIFY_MIN_POSTS:
        logger.info(
            "verify_channel_access: %s — замало постів (%s/%s).",
            channel_link, count, VERIFY_MIN_POSTS,
        )
        return {"status": "error", "reason": "not_enough_posts", "count": count}

    logger.info("verify_channel_access: %s — ок, постів >= %s.", channel_link, VERIFY_MIN_POSTS)
    return {"status": "ok"}


_GEMINI_MODEL = "gemini-3.6-flash"
_GEMINI_FALLBACK_MODEL = "gemini-3.6-flash"


def _safe_json_array(text: str) -> list[dict]:
    """Дістає JSON-масив об'єктів з відповіді Gemini. Інакше []."""
    from services.gemini_service import extract_gemini_json

    parsed = extract_gemini_json(text)
    if parsed is None:
        return []

    if isinstance(parsed, list):
        return [item for item in parsed if isinstance(item, dict)]
    if isinstance(parsed, dict):
        for key in ("products", "items", "data", "goods"):
            inner = parsed.get(key)
            if isinstance(inner, list):
                return [item for item in inner if isinstance(item, dict)]
        if parsed.get("name"):
            return [parsed]
    return []


def _normalize_parsed_product(item: dict) -> Optional[dict]:
    name = str(item.get("name") or "").strip()
    if not name:
        return None
    description = str(item.get("description") or "").strip()
    image_urls = _normalize_image_urls(item.get("image_urls"))
    if not image_urls:
        image_urls = extract_photo_urls_from_text(description)
    telegram_message_id = _coerce_telegram_message_id(
        item.get("telegram_message_id") or item.get("message_id") or item.get("post_id")
    )
    return {
        "name": name,
        "price": item.get("price"),
        "description": description,
        "vendor_code": str(item.get("vendor_code") or "").strip(),
        "image_urls": image_urls,
        "telegram_message_id": telegram_message_id,
    }


async def parse_telegram_posts_to_products(posts_text: str) -> list[dict]:
    """
    Gemini витягує товари з тексту постів Telegram-каналу.

    Повертає список словників: name, price, description, vendor_code, image_urls.
    429/503 — ротація ключів і повтор. Помилка не піднімається нагору: [].
    """
    blob = (posts_text or "").strip()
    if not blob:
        return []

    from services.gemini_service import (
        _generate_content,
        _has_gemini_keys,
        _is_capacity_error,
    )

    if not _has_gemini_keys():
        logger.error("parse_telegram_posts_to_products: немає GEMINI_API_KEYS — імпорт пропущено.")
        return []

    prompt = (
        f"Ось текст кількох постів з Telegram-каналу магазину: {blob}. "
        "Знайди всі товари. Для кожного товару витягни дані і поверни СУВОРИЙ JSON масив об'єктів. "
        "Формат об'єкта: { 'name': 'Назва товару', 'price': 'Ціна (тільки цифри)', "
        "'description': 'Повний опис, розміри, тканина', "
        "'vendor_code': 'Артикул (якщо є, інакше згенеруй з назви)', "
        "'image_urls': ['https://...'], "
        "'telegram_message_id': 123 }. "
        "telegram_message_id обов'язково візьми з рядка 'Пост #123' того поста, де цей товар. "
        "Якщо в тексті є посилання на фотографії (Фото товару: [url]), "
        "обов'язково збережи їх у масив 'image_urls' в JSON. "
        "Якщо товарів немає, поверни []."
    )

    last_error: Optional[Exception] = None
    for attempt in range(1, 4):
        for model_name in (_GEMINI_MODEL, _GEMINI_FALLBACK_MODEL):
            try:
                try:
                    raw = await _generate_content(
                        prompt,
                        temperature=0.1,
                        max_output_tokens=8192,
                        response_mime_type="application/json",
                        model_name=model_name,
                    )
                except Exception as mime_error:
                    if _is_capacity_error(mime_error):
                        raise
                    raw = await _generate_content(
                        prompt,
                        temperature=0.1,
                        max_output_tokens=8192,
                        model_name=model_name,
                    )
                items = []
                for item in _safe_json_array(raw):
                    normalized = _normalize_parsed_product(item)
                    if normalized:
                        items.append(normalized)
                logger.info(
                    "parse_telegram_posts_to_products: Gemini повернув %s товарів.",
                    len(items),
                )
                return items
            except Exception as e:
                last_error = e
                logger.warning(
                    "parse_telegram_posts_to_products (%s, спроба %s/3): %s",
                    model_name, attempt, e,
                )
                if _is_capacity_error(e):
                    break
                if model_name == _GEMINI_MODEL:
                    continue
        if last_error and _is_capacity_error(last_error) and attempt < 3:
            await asyncio.sleep(5)
            continue
        break

    logger.error(
        "parse_telegram_posts_to_products: пости не розпарсено (Gemini 429/503 або інша помилка): %s",
        last_error,
    )
    return []
