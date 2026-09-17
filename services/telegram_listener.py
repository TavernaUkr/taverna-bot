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
from services.telegram_parser import parse_telegram_posts_to_products
from services.telegram_sync import _source_url_for_message, upsert_parsed_telegram_items

logger = logging.getLogger(__name__)

_CACHE_TTL_SEC = 60.0
_channels_cache: Dict[str, object] = {"at": 0.0, "map": {}}
_listeners_registered = False


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


def _resolve_supplier_id(event, approved: Dict[str, int]) -> Optional[int]:
    for key in _event_channel_keys(event):
        if key in approved:
            return approved[key]
        lowered = str(key).lower().lstrip("@")
        if lowered in approved:
            return approved[lowered]
    return None


def _event_post_text(event) -> str:
    message = getattr(event, "message", None)
    text = ""
    if message is not None:
        text = (getattr(message, "message", None) or getattr(message, "text", None) or "").strip()
    if not text:
        text = (getattr(event, "text", None) or "").strip()
    flags = []
    if message is not None:
        if getattr(message, "photo", None):
            flags.append("є фото")
        elif getattr(message, "video", None):
            flags.append("є відео")
        elif getattr(message, "media", None):
            flags.append("є медіа")
    header = f"Пост #{getattr(message, 'id', '?')}"
    if flags:
        header += f" [{', '.join(flags)}]"
    if text:
        return f"{header}\n{text}"
    return header if flags else ""


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

        posts_text = _event_post_text(event)
        if not posts_text.strip():
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

        message = getattr(event, "message", None)
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
