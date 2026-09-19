# services/telegram_parser.py
"""Парсинг публічних Telegram-каналів постачальників (Telethon + Gemini)."""
import asyncio
import logging
import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Union
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


def _telegram_media_folder_path(supplier_name: str, supplier_id: int, message_id) -> str:
    safe_name = "".join(
        c for c in (supplier_name or "") if c.isalnum() or c in (" ", "_")
    ).replace(" ", "_")
    if not safe_name:
        safe_name = "shop"
    return f"telegram_media/{safe_name}_{int(supplier_id or 0)}/post_{int(message_id or 0)}"


MIN_PRODUCT_TEXT_LEN = 12


def _message_text(message) -> str:
    return (
        getattr(message, "message", None)
        or getattr(message, "text", None)
        or ""
    ).strip()


def _message_has_media(message) -> bool:
    return bool(
        getattr(message, "media", None)
        or getattr(message, "photo", None)
        or getattr(message, "video", None)
    )


def _is_short_product_text(text: str) -> bool:
    """Порожній або закороткий підпис — не самостійний товар (альбом / forward)."""
    cleaned = (text or "").strip()
    if not cleaned:
        return True
    if len(cleaned) >= MIN_PRODUCT_TEXT_LEN:
        return False
    return not bool(re.search(r"\d", cleaned))


def is_album_extra_message(message) -> bool:
    """Медіа без нормального тексту товару — частина альбому або forward після поста."""
    return _message_has_media(message) and _is_short_product_text(_message_text(message))


@dataclass
class AlbumStitchContext:
    """Пам'ять парсера: останній товарний пост, щоб доклеїти альбомні фото."""
    last_product_message_id: int = 0
    last_extra_message_id: int = 0
    last_grouped_id: Any = None
    pending_attachments: list = field(default_factory=list)
    pending_album_ids: list = field(default_factory=list)

    def belongs_to_previous(self, message) -> bool:
        if not self.last_product_message_id:
            return False
        grouped_id = getattr(message, "grouped_id", None)
        if grouped_id and self.last_grouped_id and grouped_id == self.last_grouped_id:
            return True
        msg_id = int(getattr(message, "id", 0) or 0)
        if not msg_id:
            return False
        if msg_id == self.last_product_message_id + 1:
            return True
        return bool(self.last_extra_message_id and msg_id == self.last_extra_message_id + 1)

    def remember_product(self, message) -> None:
        msg_id = int(getattr(message, "id", 0) or 0)
        self.last_product_message_id = msg_id
        self.last_extra_message_id = msg_id
        self.last_grouped_id = getattr(message, "grouped_id", None)

    def remember_extra(self, message) -> None:
        msg_id = int(getattr(message, "id", 0) or 0)
        if msg_id:
            self.last_extra_message_id = msg_id
        grouped_id = getattr(message, "grouped_id", None)
        if grouped_id:
            self.last_grouped_id = grouped_id

    def take_attachments(self) -> list:
        items = list(self.pending_attachments)
        self.pending_attachments = []
        return items

    def take_album_ids(self) -> list:
        items = list(self.pending_album_ids)
        self.pending_album_ids = []
        return items


def _append_media_to_post(post: dict, urls: list[str]) -> None:
    if not urls:
        return
    images = post.setdefault("image_urls", [])
    formatted = post.get("formatted") or ""
    for url in urls:
        if not url or url in images:
            continue
        images.append(url)
        formatted = f"{formatted}\nФото товару: {url}".strip()
    post["formatted"] = formatted


async def _stitch_channel_messages(
    client: TelegramClient,
    messages: list,
    *,
    username,
    chat_id,
    upload_media: bool,
    supplier_name: str,
    supplier_id: int,
    stitch_ctx: Optional[AlbumStitchContext] = None,
) -> list[dict]:
    """
    Хронологічно склеює альбоми: фото без тексту йдуть у попередній товар,
    а не створюють окремий пост для Gemini.
    """
    ctx = stitch_ctx or AlbumStitchContext()
    ordered = sorted(messages, key=lambda item: int(getattr(item, "id", 0) or 0))
    posts_by_id: dict[int, dict] = {}

    for message in ordered:
        msg_id = int(getattr(message, "id", 0) or 0)
        if not msg_id:
            continue
        text = _message_text(message)
        has_media = _message_has_media(message)
        short = _is_short_product_text(text)

        if has_media and short and ctx.belongs_to_previous(message):
            parent_id = ctx.last_product_message_id
            urls: list[str] = []
            if upload_media:
                urls = await extract_and_upload_message_media(
                    client,
                    message,
                    supplier_name=supplier_name,
                    supplier_id=supplier_id,
                    folder_message_id=parent_id,
                )
            if parent_id in posts_by_id:
                if urls:
                    _append_media_to_post(posts_by_id[parent_id], urls)
                else:
                    posts_by_id[parent_id].setdefault("album_message_ids", []).append(msg_id)
            elif urls:
                ctx.pending_attachments.append((parent_id, urls))
            else:
                ctx.pending_album_ids.append((parent_id, msg_id))
            logger.info(
                "telegram_parser: медіа поста #%s приклеєно до товару #%s (альбом/наступне фото).",
                msg_id, parent_id,
            )
            ctx.remember_extra(message)
            continue

        if short:
            logger.info(
                "telegram_parser: пропущено порожній/короткий пост #%s (не створюємо товар-привид).",
                msg_id,
            )
            continue

        public_urls: list[str] = []
        if upload_media and has_media:
            public_urls = await extract_and_upload_message_media(
                client,
                message,
                supplier_name=supplier_name,
                supplier_id=supplier_id,
            )
        formatted = _format_post(message, public_urls)
        if not formatted:
            continue
        posts_by_id[msg_id] = {
            "message_id": msg_id,
            "formatted": formatted,
            "text": text,
            "username": username,
            "chat_id": chat_id,
            "image_urls": list(public_urls),
            "grouped_id": getattr(message, "grouped_id", None),
            "album_message_ids": [],
        }
        ctx.remember_product(message)

    return list(posts_by_id.values())


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


async def extract_and_upload_message_media(
    client: TelegramClient,
    message,
    *,
    supplier_name: str,
    supplier_id: int,
    folder_message_id: Optional[int] = None,
) -> list[str]:
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
        folder_path = _telegram_media_folder_path(
            supplier_name,
            supplier_id,
            folder_message_id if folder_message_id is not None else getattr(message, "id", 0),
        )
        loop = asyncio.get_running_loop()
        public_url = await loop.run_in_executor(
            None,
            upload_media_to_supabase,
            bytes(media_bytes),
            file_name,
            content_type,
            folder_path,
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


async def hydrate_posts_media(
    channel_link: str,
    posts: list[dict],
    keep_message_ids: set[int],
    *,
    supplier_name: str,
    supplier_id: int,
) -> None:
    """
    Качає фото в Storage лише для постів, які Gemini визнав товарами.
    Інформаційні пости не чіпаємо.
    """
    if not posts or not keep_message_ids:
        return
    id_to_post = {
        int(post["message_id"]): post
        for post in posts
        if post.get("message_id")
    }
    parent_of: dict[int, int] = {}
    download_ids: list[int] = []
    keep = {int(mid) for mid in keep_message_ids if int(mid)}
    for mid in keep:
        post = id_to_post.get(mid)
        if not post:
            continue
        download_ids.append(mid)
        parent_of[mid] = mid
        for extra in post.get("album_message_ids") or []:
            try:
                extra_id = int(extra)
            except (TypeError, ValueError):
                continue
            if extra_id:
                download_ids.append(extra_id)
                parent_of[extra_id] = mid
    unique_ids = list(dict.fromkeys(download_ids))
    if not unique_ids:
        return

    channel_ref = _normalize_channel_ref(channel_link)
    async with _client_lock:
        try:
            client = await _ensure_client()
            entity = await client.get_entity(channel_ref)
            fetched = await client.get_messages(entity, ids=unique_ids)
        except Exception as e:
            logger.warning("hydrate_posts_media: не вдалося довантажити фото: %s", e)
            return
        if fetched is None:
            return
        messages = fetched if isinstance(fetched, list) else [fetched]
        for message in messages:
            if message is None:
                continue
            msg_id = int(getattr(message, "id", 0) or 0)
            parent_id = parent_of.get(msg_id)
            post = id_to_post.get(parent_id) if parent_id else None
            if post is None:
                continue
            urls = await extract_and_upload_message_media(
                client,
                message,
                supplier_name=supplier_name,
                supplier_id=supplier_id,
                folder_message_id=parent_id,
            )
            _append_media_to_post(post, urls)


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
    supplier_name: str = "",
    supplier_id: int = 0,
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
            raw_messages = []
            async for message in client.iter_messages(entity, limit=take):
                raw_messages.append(message)
            stitched = await _stitch_channel_messages(
                client,
                raw_messages,
                username=getattr(entity, "username", None),
                chat_id=getattr(entity, "id", None),
                upload_media=upload_media,
                supplier_name=supplier_name,
                supplier_id=supplier_id,
            )
            for post in stitched:
                formatted = post.get("formatted")
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
    supplier_name: str = "",
    supplier_id: int = 0,
    stitch_ctx: Optional[AlbumStitchContext] = None,
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
            raw_messages = []
            async for message in client.iter_messages(entity, **iter_kwargs):
                fetched += 1
                next_offset = int(getattr(message, "id", 0) or 0)
                raw_messages.append(message)
            posts = await _stitch_channel_messages(
                client,
                raw_messages,
                username=username,
                chat_id=chat_id,
                upload_media=upload_media,
                supplier_name=supplier_name,
                supplier_id=supplier_id,
                stitch_ctx=stitch_ctx,
            )
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


def _clean_client_description(text: str) -> str:
    """Прибирає з опису посилання, дроп/РРЦ і артикули, зберігаючи переноси \\n."""
    cleaned = (text or "").replace("\\n", "\n")
    cleaned = re.sub(r"https?://\S+", "", cleaned)
    cleaned = re.sub(
        r"(?i)\b(дроп|drop|ррц|роздрібна\s*ціна|оптова?\s*ціна|опт)\b[:\s]*[\d.,]*\s*(грн|uah|₴)?",
        "",
        cleaned,
    )
    cleaned = re.sub(r"(?i)\bартикул\b\s*[:#]?\s*\S+", "", cleaned)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in cleaned.split("\n")]
    out: list[str] = []
    blank = 0
    for line in lines:
        if not line:
            blank += 1
            if blank <= 1:
                out.append("")
            continue
        blank = 0
        out.append(line)
    return "\n".join(out).strip()


_CHAR_META_KEYS = {
    "source",
    "source_url",
    "telegram_message_id",
    "vendor_code",
    "sizes",
    "media_urls",
    "characteristics",
    "search_tags",
    "base_model_name",
    "color",
}


def _normalize_characteristics(raw) -> list[dict]:
    """Масив [{"name": "...", "value": "..."}] з відповіді Gemini (або старого dict)."""
    items = []
    if isinstance(raw, dict):
        items = list(raw.items())
    elif isinstance(raw, list):
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            key = entry.get("name") or entry.get("key") or entry.get("title")
            val = entry.get("value") if "value" in entry else entry.get("val")
            if key:
                items.append((key, val))
    result: list[dict] = []
    seen = set()
    for key, val in items:
        name = str(key or "").strip()[:80]
        value = "" if val is None else str(val).strip()[:200]
        if not name or not value or name.lower() in _CHAR_META_KEYS:
            continue
        fold = name.casefold()
        if fold in seen:
            continue
        seen.add(fold)
        result.append({"name": name, "value": value})
        if len(result) >= 20:
            break
    return result


def _ground_characteristic_pairs(pairs: list[dict], source_text: str) -> list[dict]:
    """Лишає лише пари, чиє значення реально є в оригінальному тексті."""
    blob = (source_text or "").casefold()
    if not blob:
        return list(pairs or [])
    grounded: list[dict] = []
    for pair in pairs or []:
        value = str(pair.get("value") or "").strip()
        if not value:
            continue
        needle = value.casefold()
        tokens = [tok for tok in re.split(r"\W+", needle, flags=re.UNICODE) if len(tok) >= 3]
        if needle in blob or (tokens and all(tok in blob for tok in tokens)):
            grounded.append(pair)
    return grounded


def _normalize_search_tags(raw) -> list[str]:
    chunks = []
    if isinstance(raw, list):
        chunks = raw
    elif isinstance(raw, str):
        chunks = re.split(r"[,;/|]+", raw)
    seen = set()
    tags: list[str] = []
    for chunk in chunks:
        value = str(chunk or "").strip().lower()[:40]
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        tags.append(value)
        if len(tags) >= 16:
            break
    return tags


def _normalize_sizes(raw) -> list[str]:
    chunks = []
    if isinstance(raw, list):
        chunks = raw
    elif isinstance(raw, str):
        chunks = re.split(r"[,;/|]+", raw)
    seen = set()
    sizes: list[str] = []
    for chunk in chunks:
        value = str(chunk or "").strip()
        if not value:
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        sizes.append(value[:40])
        if len(sizes) >= 40:
            break
    return sizes


def _coerce_is_product(item: dict) -> bool:
    """False лише якщо Gemini явно сказав, що це не товар."""
    if not isinstance(item, dict):
        return False
    raw = item.get("is_product")
    if raw is None:
        return True
    if isinstance(raw, bool):
        return raw
    text = str(raw).strip().lower()
    if text in {"false", "0", "no", "ні", "n", "off"}:
        return False
    if text in {"true", "1", "yes", "так", "y", "on"}:
        return True
    return bool(raw)


def _normalize_parsed_product(item: dict, source_text: str = "") -> Optional[dict]:
    if not _coerce_is_product(item):
        return None
    name = str(item.get("name") or "").strip()
    if not name:
        return None
    description = _clean_client_description(str(item.get("description") or ""))
    image_urls = _normalize_image_urls(item.get("image_urls"))
    if not image_urls:
        image_urls = extract_photo_urls_from_text(str(item.get("description") or ""))
    telegram_message_id = _coerce_telegram_message_id(
        item.get("telegram_message_id") or item.get("message_id") or item.get("post_id")
    )
    characteristics = _ground_characteristic_pairs(
        _normalize_characteristics(
            item.get("characteristics")
            if item.get("characteristics") is not None
            else item.get("attributes")
        ),
        source_text,
    )
    return {
        "name": name,
        "price": item.get("price"),
        "description": description,
        "vendor_code": str(item.get("vendor_code") or "").strip(),
        "image_urls": image_urls,
        "telegram_message_id": telegram_message_id,
        "characteristics": characteristics,
        "sizes": _normalize_sizes(item.get("sizes")),
        "search_tags": _normalize_search_tags(item.get("search_tags")),
        "niche": str(item.get("niche") or item.get("target_niche") or "").strip()[:100],
        "season": str(item.get("season") or "").strip()[:50],
        "base_model_name": str(item.get("base_model_name") or "").strip()[:200],
        "color": str(item.get("color") or "").strip()[:80],
    }


_TELEGRAM_PARSE_SYSTEM_PROMPT = """
ТИ ПРАЦЮЄШ ДВОМА КРОКАМИ В ОДНОМУ JSON. ЗАБОРОНЕНО вигадувати дані.
Використовуй ТІЛЬКИ інформацію з оригінального тексту поста.
Працюєш українською. Поверни виключно JSON-масив об'єктів. Без markdown.

СПОЧАТКУ для КОЖНОГО поста визнач is_product.
Якщо це інформаційний пост, правила доставки, новини магазину, графік роботи,
опитування, реклама без товару чи просто текст БЕЗ конкретного товару для продажу —
поверни is_product: false і всі інші поля залиш порожніми (name="", characteristics=[], sizes=[]).
Такий пост НЕ є товаром.

ПОРЯДОК (суворо) для is_product: true:
ЧАСТИНА 1 (Екстракція) — спочатку заповни characteristics і sizes. Лише факти з поста.
  Бренд, Матеріал, Пам'ять, Вага, Країна, Колір тощо — якщо їх НЕМАЄ в тексті, не додавай.
ЧАСТИНА 2 (Аналіз) — ЛИШЕ після characteristics напиши description, потім ЖОРСТКО визнач
  niche і season. Категорію/нішу НЕ став, поки не витягнув характеристики.
search_tags — масив коротких рядків з характеристик і типу товару (напр. ["кросівки","зима","nike","шкіра"]).

Формат ОДНОГО об'єкта:
{
  "is_product": true,
  "name": "Комерційна назва для клієнта",
  "price": "1234",
  "characteristics": [
    {"name": "Матеріал", "value": "шкіра натуральна"},
    {"name": "Виробництво", "value": "Китай"},
    {"name": "Сезон", "value": "весна, літо"}
  ],
  "sizes": ["40", "41", "42"],
  "description": "Короткий вступ.\\n\\n✅ Перевага з поста\\n🛡️ Ще одна перевага з поста",
  "search_tags": ["кросівки", "зима", "nike", "шкіра"],
  "vendor_code": "артикул або порожній рядок",
  "base_model_name": "Напівчеревики ESDY з швидкою шнурівкою",
  "color": "мультикам",
  "niche": "Мілітарі",
  "season": "Демісезон",
  "image_urls": ["https://..."],
  "telegram_message_id": 123
}

ЖОРСТКІ ПРАВИЛА:
0) is_product — обов'язкове boolean. false = не зберігати, не парсити далі.
1) characteristics — масив об'єктів для ВСІХ знайдених технічних даних.
   Якщо в пості факту немає — НЕ додавай пару. Не вигадуй Китай, шкіру, мембрану тощо.
   Якщо технічних даних немає — [].
2) sizes — усі згадані розміри. Якщо немає — []. Не пиши розміри в description.
3) description — лише художній рерайт НАЯВНИХ переваг ПІСЛЯ characteristics.
   Жодної технічної інформації (розмірів, матеріалів, країн). Без цін і лінків.
   Кожен пункт списку з нового рядка (\\n) і емодзі.
4) search_tags — 4–12 коротких слів/фраз з characteristics, sizes, назви, ніші, сезону.
5) vendor_code — артикул з поста, якщо є. Інакше "".
5a) base_model_name — назва моделі БЕЗ кольору (однакова для олива/мультикам цієї моделі).
5b) color — колір з тексту («мультикам», «олива»). Якщо немає — "".
6) niche — одне з: Мілітарі, Повсякденний, Спорт, Риболовля та Полювання,
   Туризм, Домашній, Професійний, Свято. Обирай після characteristics.
7) season — одне з: Зима, Літо, Демісезон, Всесезон. Якщо сезону немає — "Всесезон".
8) price — лише цифри роздрібної ціни. Без «грн». Не плутай з дроп-ціною.
9) telegram_message_id візьми з рядка «Пост #123».
10) Якщо в тексті є «Фото товару: [url]» — збережи URL у image_urls.
11) Якщо товарів немає — поверни [].
"""


async def parse_telegram_posts_to_products(posts_text: str) -> list[dict]:
    """
    Gemini витягує товари з тексту постів Telegram-каналу.

    Повертає список словників: name, price, description, characteristics,
    sizes, vendor_code, niche, season, image_urls.
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
        "Ось текст кількох постів з Telegram-каналу магазину.\n"
        "Для КОЖНОГО поста спочатку постав is_product true/false. "
        "Якщо false — інші поля порожні. "
        "Якщо true — витягни characteristics і sizes, "
        "потім на їх основі description, niche, season і search_tags.\n\n"
        f"{blob}"
    )

    last_error: Optional[Exception] = None
    for attempt in range(1, 4):
        for model_name in (_GEMINI_MODEL, _GEMINI_FALLBACK_MODEL):
            try:
                try:
                    raw = await _generate_content(
                        prompt,
                        system_instruction=_TELEGRAM_PARSE_SYSTEM_PROMPT,
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
                        system_instruction=_TELEGRAM_PARSE_SYSTEM_PROMPT,
                        temperature=0.1,
                        max_output_tokens=8192,
                        model_name=model_name,
                    )
                items = []
                skipped = 0
                for item in _safe_json_array(raw):
                    if not _coerce_is_product(item):
                        skipped += 1
                        continue
                    normalized = _normalize_parsed_product(item, blob)
                    if normalized:
                        items.append(normalized)
                logger.info(
                    "parse_telegram_posts_to_products: Gemini повернув %s товарів, пропущено не-товарів: %s.",
                    len(items),
                    skipped,
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
