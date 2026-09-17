# services/telegram_parser.py
"""Парсинг публічних Telegram-каналів постачальників (Telethon + Gemini)."""
import asyncio
import json
import logging
import re
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


VERIFY_MIN_POSTS = 30
_VERIFY_PRIVATE = {"status": "error", "reason": "private_or_not_found"}


async def verify_channel_access(channel_link: str) -> dict:
    """
    Жива перевірка доступу бота до каналу (без Exception назовні).

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
            except (TelegramChannelParseError, ValueError, ChannelPrivateError) as e:
                logger.warning("verify_channel_access client: %s", e)
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


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)
_GEMINI_MODEL = "gemini-3.6-flash"
_GEMINI_FALLBACK_MODEL = "gemini-3.6-flash"


def _safe_json_array(text: str) -> list[dict]:
    """Дістає JSON-масив об'єктів з відповіді Gemini. Інакше []."""
    if not text:
        return []
    raw = text.strip()
    fenced = _JSON_FENCE_RE.search(raw)
    if fenced:
        raw = fenced.group(1).strip()

    first_bracket = raw.find("[")
    last_bracket = raw.rfind("]")
    first_brace = raw.find("{")
    if first_bracket != -1 and last_bracket > first_bracket:
        candidate = raw[first_bracket:last_bracket + 1]
    elif first_brace != -1:
        last_brace = raw.rfind("}")
        candidate = raw[first_brace:last_brace + 1] if last_brace > first_brace else raw
    else:
        candidate = raw

    try:
        parsed = json.loads(candidate)
    except Exception:
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
    return {
        "name": name,
        "price": item.get("price"),
        "description": str(item.get("description") or "").strip(),
        "vendor_code": str(item.get("vendor_code") or "").strip(),
    }


async def parse_telegram_posts_to_products(posts_text: str) -> list[dict]:
    """
    Gemini витягує товари з тексту постів Telegram-каналу.

    Повертає список словників: name, price, description, vendor_code.
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
        "'vendor_code': 'Артикул (якщо є, інакше згенеруй з назви)' }. "
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
