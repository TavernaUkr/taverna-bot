# services/telegram_listener.py
"""
Реальний час: нові пости в схвалених Telegram-каналах постачальників.
Підписується на існуючий Telethon-клієнт.

ДЕБАУНС-АРХІТЕКТУРА (замість обробки "на льоту"): постачальники надсилають
фото і текст у хаотичному порядку (то текст, то фото, часто окремими
повідомленнями, у будь-якій послідовності). Спроба розпарсити і одразу
зберегти в БД КОЖНЕ повідомлення (у events.NewMessage) призводила до
Race Condition — кілька майже одночасних подій паралельно писали/
перезаписували масив pictures ОДНОГО й того ж товару, і в Supabase лишалось
1-2 фото замість усіх.

Тепер events.NewMessage/MessageEdited НІЧОГО не парсить, не звертається до
Gemini і не пише в БД — обробник лише "перезапускає" таймер тиші (debounce)
для постачальника: скасовує попередню відкладену задачу і ставить нову.
Коли повідомлень від постачальника не було _DEBOUNCE_SECONDS секунд, ОДИН
раз, ПОСЛІДОВНО запускається повний пакетний прохід:
  1. sync_recent_channel_history() (services/telegram_parser.py) — читає
     останні пости каналу ОДНИМ запитом і групує їх у товарні блоки
     (текст + усе "голе" медіа навколо нього).
  2. parse_telegram_posts_to_products() — один виклик Gemini на весь пакет.
  3. _save_batch_products() (services/telegram_sync.py) — той самий код,
     що й ручний імпорт каналу, зберігає/оновлює товари в БД.
"""
import asyncio
import logging
import time
from typing import Dict, Optional

from telethon import TelegramClient, events

from database.db import AsyncSessionLocal
from database.models import Supplier, SupplierStatus
from services.telegram_parser import (
    parse_telegram_posts_to_products,
    sync_recent_channel_history,
)
from services.telegram_sync import (
    _channel_link,
    _save_batch_products,
    apply_telegram_reply_updates,
)

logger = logging.getLogger(__name__)

_CACHE_TTL_SEC = 60.0
_channels_cache: Dict[str, object] = {"at": 0.0, "map": {}}
_listeners_registered = False

# КРОК 1 (дебаунс): для кожного supplier_id — ОДНА активна відкладена задача.
# Нове повідомлення від того самого постачальника скасовує попередню задачу
# (task.cancel()) і ставить нову — тому реальна синхронізація відбувається
# рівно один раз, через _DEBOUNCE_SECONDS ПІСЛЯ ОСТАННЬОГО повідомлення
# (тиша), а не на кожне повідомлення окремо.
_debounce_tasks: Dict[int, "asyncio.Task"] = {}
_DEBOUNCE_SECONDS = 45


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


async def _delayed_sync(supplier_id: int) -> None:
    """
    КРОК 1: спрацьовує через _DEBOUNCE_SECONDS ПІСЛЯ останнього повідомлення
    цього постачальника. Якщо за цей час прийшло нове повідомлення —
    _schedule_debounced_sync скасовує ЦЮ задачу (asyncio.CancelledError) і
    ставить нову з таким самим таймером — тому реальна робота нижче
    виконується рівно один раз на "серію" повідомлень.
    """
    try:
        await asyncio.sleep(_DEBOUNCE_SECONDS)
    except asyncio.CancelledError:
        # Штатне скасування дебаунсу (прийшло нове повідомлення) — не помилка.
        raise

    try:
        if AsyncSessionLocal is None:
            return
        async with AsyncSessionLocal() as db:
            supplier = await db.get(Supplier, supplier_id)
        if supplier is None or supplier.status != SupplierStatus.active:
            return
        supplier_name = getattr(supplier, "name", "") or f"supplier_{supplier_id}"
        channel_link = _channel_link(supplier)
        if not channel_link:
            logger.warning(
                "telegram_listener: у supplier #%s немає telegram_channel_link — пропускаю.",
                supplier_id,
            )
            return

        # КРОК 2: один запит історії каналу + групування в товарні блоки +
        # синхронне завантаження медіа (усе це вже в sync_recent_channel_history).
        try:
            posts = await sync_recent_channel_history(
                channel_link,
                limit=40,
                supplier_name=supplier_name,
                supplier_id=supplier_id,
            )
        except Exception as e:
            logger.error(
                "telegram_listener: debounce-синхронізація #%s (читання каналу) впала: %s",
                supplier_id, e, exc_info=True,
            )
            return

        if not posts:
            logger.info(
                "telegram_listener: debounce-синхронізація #%s — товарних блоків не знайдено.",
                supplier_id,
            )
            return

        # Reply на старий пост: дописуємо медіа в існуючий товар і НЕ шлемо в Gemini.
        async with AsyncSessionLocal() as db:
            posts = await apply_telegram_reply_updates(
                db, supplier_id=supplier_id, posts=posts,
            )
        if not posts:
            logger.info(
                "telegram_listener: debounce-синхронізація #%s — лише reply до існуючих товарів.",
                supplier_id,
            )
            return

        # Один пакетний виклик Gemini на весь блок постів (як у run_telegram_import).
        blob = "\n\n".join(f"{i}. {post['formatted']}" for i, post in enumerate(posts, 1))
        try:
            parsed_products = await parse_telegram_posts_to_products(blob)
        except Exception as e:
            logger.error(
                "telegram_listener: debounce-синхронізація #%s — Gemini 429/503 або збій парсингу: %s",
                supplier_id, e, exc_info=True,
            )
            return

        if not parsed_products:
            logger.info(
                "telegram_listener: debounce-синхронізація #%s — Gemini не знайшов товарів у пакеті.",
                supplier_id,
            )
            return

        async with AsyncSessionLocal() as db:
            saved = await _save_batch_products(
                db,
                supplier_id=supplier_id,
                batch=posts,
                parsed_items=parsed_products,
            )
        logger.info(
            "telegram_listener: debounce-синхронізація supplier #%s завершена: постів=%s, збережено=%s.",
            supplier_id, len(posts), saved,
        )
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.error(
            "telegram_listener: debounce-синхронізація supplier #%s впала: %s",
            supplier_id, e, exc_info=True,
        )
    finally:
        # Прибираємо себе з реєстру, ЛИШЕ якщо це досі "наша" задача (не
        # замінена новішою — інакше можна випадково стерти щойно поставлену).
        current = _debounce_tasks.get(supplier_id)
        if current is asyncio.current_task():
            _debounce_tasks.pop(supplier_id, None)


def _schedule_debounced_sync(supplier_id: int) -> None:
    existing = _debounce_tasks.get(supplier_id)
    if existing is not None and not existing.done():
        existing.cancel()
    _debounce_tasks[supplier_id] = asyncio.create_task(_delayed_sync(supplier_id))


async def _handle_channel_post(event) -> None:
    """
    ЄДИНЕ, що робить обробник NewMessage/MessageEdited (КРОК 1): визначає
    постачальника і перезапускає його дебаунс-таймер. Жодного парсингу,
    Gemini чи запису в БД тут немає — уся робота відбувається пізніше, в
    _delayed_sync, одним пакетним проходом по історії каналу.
    """
    try:
        if not getattr(event, "is_channel", False) and not getattr(event, "is_group", False):
            return
        approved = await get_approved_tg_channels()
        if not approved:
            return
        supplier_id = _resolve_supplier_id(event, approved)
        if not supplier_id:
            return
        _schedule_debounced_sync(supplier_id)
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
        await _handle_channel_post(event)

    @client.on(events.MessageEdited)
    async def on_approved_channel_message_edited(event):
        await _handle_channel_post(event)

    client._taverna_tg_listeners = True
    _listeners_registered = True
    logger.info(
        "telegram_listener: слухач NewMessage + MessageEdited увімкнено (debounce=%sс).",
        _DEBOUNCE_SECONDS,
    )


async def start_telegram_listener(client: TelegramClient) -> None:
    register_telegram_channel_listeners(client)
