# services/telegram_listener.py
"""
Реальний час: нові пости та правки в схвалених Telegram-каналах постачальників.
Підписується на існуючий Telethon-клієнт. Помилки Gemini не валять бота.
"""
import logging
import time
from typing import Dict, Optional

from telethon import TelegramClient, events

from database.db import AsyncSessionLocal
from database.models import Supplier, SupplierStatus
from services.telegram_parser import (
    AlbumStitchContext,
    extract_and_upload_message_media,
    extract_photo_urls_from_text,
    is_album_extra_message,
    parse_telegram_posts_to_products,
)
from services.telegram_sync import (
    _find_live_product,
    _source_url_for_message,
    attach_telegram_album_media,
    live_message_sku,
    upsert_parsed_telegram_items,
)

logger = logging.getLogger(__name__)

_CACHE_TTL_SEC = 60.0
_channels_cache: Dict[str, object] = {"at": 0.0, "map": {}}
_listeners_registered = False
_supplier_stitch: Dict[int, AlbumStitchContext] = {}


def _normalize_channel_key(raw: Optional[str]) -> Optional[str]:
    value = (raw or "").strip()
    if not value:
        return None
    cleaned = value.replace("https://", "").replace("http://", "").replace("www.", "")
    lower = cleaned.lower()
    for prefix in ("t.me/", "telegram.me/", "telegram.dog/"):
        if lower.startswith(prefix):
            cleaned = cleaned[len(prefix):]
            lower = cleaned.lower()
            break
    if lower.startswith("s/"):
        cleaned = cleaned[2:]
    cleaned = cleaned.split("?")[0].split("#")[0].strip("/").lstrip("@")
    if not cleaned:
        return None
    if cleaned.lower().startswith("c/") and len(cleaned.split("/")) >= 2:
        cid = cleaned.split("/")[1]
        if cid.isdigit():
            return f"-100{cid}"
    return cleaned.split("/")[0].lower()


def _supplier_channel_keys(supplier: Supplier) -> list[str]:
    keys = []
    for raw in (
        getattr(supplier, "telegram_channel_link", None),
        getattr(supplier, "channel_link", None),
        getattr(supplier, "telegram_channel", None),
    ):
        key = _normalize_channel_key(raw)
        if key and key not in keys:
            keys.append(key)
    return keys


async def get_approved_tg_channels() -> Dict[str, int]:
    """
    Схвалені Telegram-магазини (у БД status=active).
    Повертає {username_або_id: supplier_id}. Кеш 60 с, щоб нові заявки підхоплювались.
    """
    now = time.monotonic()
    cached_map = _channels_cache.get("map") or {}
    cached_at = float(_channels_cache.get("at") or 0)
    if cached_map and (now - cached_at) < _CACHE_TTL_SEC:
        return cached_map  # type: ignore[return-value]

    mapping: Dict[str, int] = {}
    if AsyncSessionLocal is None:
        return mapping
    try:
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    select(Supplier).where(Supplier.status == SupplierStatus.active)
                )
            ).scalars().all()
        for supplier in rows:
            source = (getattr(supplier, "source_type", None) or "xml").strip().lower()
            if source != "telegram":
                continue
            for key in _supplier_channel_keys(supplier):
                mapping[key] = supplier.id
                mapping[f"@{key}"] = supplier.id
    except Exception as e:
        logger.error("get_approved_tg_channels: %s", e, exc_info=True)
        return cached_map  # type: ignore[return-value]

    _channels_cache["at"] = now
    _channels_cache["map"] = mapping
    return mapping


def _event_channel_keys(event) -> list[str]:
    keys = []
    chat = getattr(event, "chat", None)
    username = getattr(chat, "username", None) or getattr(event, "chat_username", None)
    norm = _normalize_channel_key(username)
    if norm:
        keys.append(norm)
        keys.append(f"@{norm}")
    chat_id = getattr(event, "chat_id", None) or getattr(chat, "id", None)
    if chat_id is not None:
        keys.append(str(chat_id))
        keys.append(str(chat_id).replace("-100", "", 1) if str(chat_id).startswith("-100") else str(chat_id))
    return keys


def _stitch_ctx(supplier_id: int) -> AlbumStitchContext:
    ctx = _supplier_stitch.get(supplier_id)
    if ctx is None:
        ctx = AlbumStitchContext()
        _supplier_stitch[supplier_id] = ctx
    return ctx


def _resolve_supplier_id(event, approved: Dict[str, int]) -> Optional[int]:
    for key in _event_channel_keys(event):
        if key in approved:
            return approved[key]
        lowered = str(key).lower().lstrip("@")
        if lowered in approved:
            return approved[lowered]
    return None


async def _event_post_text(event, *, supplier_name: str, supplier_id: int, upload_media: bool = True) -> str:
    message = getattr(event, "message", None)
    text = ""
    if message is not None:
        text = (getattr(message, "message", None) or getattr(message, "text", None) or "").strip()
    if not text:
        text = (getattr(event, "text", None) or "").strip()
    flags = []
    public_urls: list[str] = []
    if message is not None:
        if getattr(message, "photo", None):
            flags.append("є фото")
        elif getattr(message, "video", None):
            flags.append("є відео")
        elif getattr(message, "media", None):
            flags.append("є медіа")
        try:
            client = getattr(event, "client", None)
            if upload_media:
                public_urls = await extract_and_upload_message_media(
                    client,
                    message,
                    supplier_name=supplier_name,
                    supplier_id=supplier_id,
                )
        except Exception as e:
            logger.warning(
                "telegram_listener: медіа не завантажено (пост #%s): %s — парсимо текст.",
                getattr(message, "id", "?"), e,
            )
    header = f"Пост #{getattr(message, 'id', '?')}"
    if flags:
        header += f" [{', '.join(flags)}]"
    parts = [header]
    if text:
        parts.append(text)
    for url in public_urls:
        parts.append(f"Фото товару: {url}")
    if text or flags or public_urls:
        return "\n".join(parts)
    return ""


async def _attach_album_extra(
    event,
    *,
    supplier_id: int,
    supplier_name: str,
    ctx: AlbumStitchContext,
) -> bool:
    message = getattr(event, "message", None)
    if message is None or not is_album_extra_message(message) or not ctx.belongs_to_previous(message):
        return False
    parent_id = ctx.last_product_message_id
    if AsyncSessionLocal is not None:
        async with AsyncSessionLocal() as db:
            sku = live_message_sku(supplier_id, int(parent_id), 1)
            source_url = _source_url_for_message(None, None, int(parent_id))
            product = await _find_live_product(
                db, supplier_id, sku, int(parent_id), source_url
            )
            if product is None:
                ctx.remember_extra(message)
                logger.info(
                    "telegram_listener: альбомне фото поста #%s без товару #%s — не вантажимо.",
                    getattr(message, "id", "?"), parent_id,
                )
                return True
    urls: list[str] = []
    try:
        client = getattr(event, "client", None)
        urls = await extract_and_upload_message_media(
            client,
            message,
            supplier_name=supplier_name,
            supplier_id=supplier_id,
            folder_message_id=parent_id,
        )
    except Exception as e:
        logger.warning(
            "telegram_listener: альбомне фото поста #%s не завантажено: %s",
            getattr(message, "id", "?"), e,
        )
    ctx.remember_extra(message)
    if urls and AsyncSessionLocal is not None:
        async with AsyncSessionLocal() as db:
            await attach_telegram_album_media(
                db,
                supplier_id=supplier_id,
                attachments=[(parent_id, urls)],
            )
    logger.info(
        "telegram_listener: фото поста #%s додано до товару #%s (supplier #%s).",
        getattr(message, "id", "?"), parent_id, supplier_id,
    )
    return True


async def _handle_channel_post(event, *, is_edit: bool) -> None:
    try:
        if not getattr(event, "is_channel", False) and not getattr(event, "is_group", False):
            return
        approved = await get_approved_tg_channels()
        if not approved:
            return
        supplier_id = _resolve_supplier_id(event, approved)
        if not supplier_id:
            return

        supplier_name = f"supplier_{supplier_id}"
        if AsyncSessionLocal is not None:
            async with AsyncSessionLocal() as db:
                supplier = await db.get(Supplier, supplier_id)
                if supplier and getattr(supplier, "name", None):
                    supplier_name = supplier.name

        ctx = _stitch_ctx(supplier_id)
        if not is_edit and await _attach_album_extra(
            event,
            supplier_id=supplier_id,
            supplier_name=supplier_name,
            ctx=ctx,
        ):
            return

        posts_text = await _event_post_text(
            event,
            supplier_name=supplier_name,
            supplier_id=supplier_id,
            upload_media=False,
        )
        if not posts_text.strip():
            return

        message = getattr(event, "message", None)
        if message is not None and is_album_extra_message(message):
            logger.info(
                "telegram_listener: короткий медіа-пост #%s без прив'язки до товару — ігнор.",
                getattr(message, "id", "?"),
            )
            return

        try:
            parsed = await parse_telegram_posts_to_products(posts_text)
        except Exception as e:
            logger.error(
                "telegram_listener: Gemini 429/503 або збій парсингу (supplier #%s): %s",
                supplier_id, e, exc_info=True,
            )
            return

        if not parsed:
            logger.info(
                "telegram_listener: пост не схожий на товар (supplier #%s, edit=%s) — ігнор.",
                supplier_id, is_edit,
            )
            return

        public_urls: list[str] = []
        try:
            client = getattr(event, "client", None)
            public_urls = await extract_and_upload_message_media(
                client,
                message,
                supplier_name=supplier_name,
                supplier_id=supplier_id,
            )
        except Exception as e:
            logger.warning(
                "telegram_listener: медіа не завантажено після is_product (пост #%s): %s",
                getattr(message, "id", "?"), e,
            )
        photo_urls = list(public_urls) or extract_photo_urls_from_text(posts_text)
        if photo_urls:
            for item in parsed:
                item["image_urls"] = list(dict.fromkeys(
                    list(item.get("image_urls") or []) + list(photo_urls)
                ))

        message_id = int(getattr(message, "id", 0) or getattr(event, "id", 0) or 0)
        if not message_id:
            return
        chat = getattr(event, "chat", None)
        username = getattr(chat, "username", None)
        chat_id = getattr(event, "chat_id", None) or getattr(chat, "id", None)
        source_url = _source_url_for_message(username, chat_id, message_id)

        if AsyncSessionLocal is None:
            return
        async with AsyncSessionLocal() as db:
            saved = await upsert_parsed_telegram_items(
                db,
                supplier_id=supplier_id,
                parsed_items=parsed,
                message_id=message_id,
                source_url=source_url,
                is_edit=is_edit,
            )
        if saved and message is not None:
            ctx.remember_product(message)
        logger.info(
            "telegram_listener: supplier #%s msg %s edit=%s saved=%s",
            supplier_id, message_id, is_edit, saved,
        )
    except Exception as e:
        logger.error("telegram_listener: обробник не повинен класти бота: %s", e, exc_info=True)


def register_telegram_channel_listeners(client: TelegramClient) -> None:
    """Один раз вішає NewMessage + MessageEdited на існуючий TelegramClient."""
    global _listeners_registered
    if _listeners_registered or getattr(client, "_taverna_tg_listeners", False):
        logger.info("telegram_listener: обробники вже зареєстровані.")
        return

    @client.on(events.NewMessage)
    async def on_approved_channel_new_message(event):
        await _handle_channel_post(event, is_edit=False)

    @client.on(events.MessageEdited)
    async def on_approved_channel_message_edited(event):
        await _handle_channel_post(event, is_edit=True)

    client._taverna_tg_listeners = True
    _listeners_registered = True
    logger.info("telegram_listener: слухач NewMessage + MessageEdited увімкнено.")


async def start_telegram_listener(client: TelegramClient) -> None:
    register_telegram_channel_listeners(client)
