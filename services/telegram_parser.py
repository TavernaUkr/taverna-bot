# services/telegram_parser.py
"""Парсинг публічних Telegram-каналів постачальників (Telethon)."""
import asyncio
import logging
from typing import Optional, Union

from telethon import TelegramClient
from telethon.errors import (
    ChannelPrivateError,
    FloodWaitError,
    UsernameInvalidError,
    UsernameNotOccupiedError,
)

from config_reader import config

logger = logging.getLogger(__name__)

_client_lock = asyncio.Lock()


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


def _format_post(message) -> Optional[str]:
    text = (getattr(message, "message", None) or "").strip()
    flags = []
    if getattr(message, "photo", None):
        flags.append("є фото")
    elif getattr(message, "video", None):
        flags.append("є відео")
    elif getattr(message, "media", None):
        flags.append("є медіа")
    if not text and not flags:
        return None
    header = f"Пост #{getattr(message, 'id', '?')}"
    if flags:
        header += f" [{', '.join(flags)}]"
    if text:
        return f"{header}\n{text}"
    return header


async def _ensure_client() -> TelegramClient:
    if not config.tg_api_id or not config.tg_api_hash:
        raise TelegramChannelParseError(
            "Telethon не налаштовано: у .env немає TG_API_ID / TG_API_HASH."
        )

    from services.telethon_service import client as shared_client

    if not shared_client.is_connected():
        await shared_client.connect()
        if not await shared_client.is_user_authorized():
            token = _secret(config.bot_token)
            if not token:
                raise TelegramChannelParseError(
                    "Telethon-сесія не авторизована. Потрібен bot1.session або BOT_TOKEN."
                )
            await shared_client.start(bot_token=token)
            logger.info("telegram_parser: Telethon клієнт авторизовано через BOT_TOKEN.")
        else:
            logger.info("telegram_parser: Telethon клієнт підключено (існуюча сесія).")
    return shared_client


async def get_recent_channel_posts(channel_link: str, limit: int = 15) -> str:
    """
    Читає останні пости публічного Telegram-каналу через Telethon.

    `channel_link`: t.me/my_channel або @my_channel.
    Повертає єдиний текстовий блок (текст поста + позначка фото/медіа).
    """
    channel_ref = _normalize_channel_ref(channel_link)
    take = max(1, min(int(limit or 15), 50))

    async with _client_lock:
        client = await _ensure_client()
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
                f"Канал приватний або бот не доданий у {channel_link}. "
                "Додайте бота в канал як адміністратора."
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
                    "Канал приватний або бот не доданий."
                ) from e
            logger.error("get_recent_channel_posts get_entity(%s): %s", channel_link, e, exc_info=True)
            raise TelegramChannelParseError(
                f"Не вдалося відкрити канал {channel_link}: {e}"
            ) from e

        chunks = []
        try:
            async for message in client.iter_messages(entity, limit=take):
                formatted = _format_post(message)
                if formatted:
                    chunks.append(formatted)
        except ChannelPrivateError as e:
            raise TelegramChannelParseError(
                f"Канал приватний або бот не доданий у {channel_link}."
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
