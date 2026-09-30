# services/supplier_analyzer.py
"""Гібридна модерація заявок постачальників (Smart Sampling).

Telegram-канали: analyze_telegram_channel() = ШВИДКИЙ Telethon-скан
365 днів (кількість постів + Regex-ціни) + ЛЕГКИЙ LLM-аналіз вибірки
(закріплене повідомлення + ПЕРШІ 40 найновіших постів) → правила
магазину, категорії, опис асортименту, ризик дубліката.
LLM — NVIDIA NIM через services.llm_service, модель = config.NVIDIA_MODEL
(.env, без хардкоду). Збій LLM НЕ ламає скан — звіт просто буде без ШІ-полів.
Не-Telegram заявки (XML/MyDrop) проходять AI-скоринг в SupplierAnalyzer.analyze_supplier.
"""
import asyncio
import json
import logging
import re
from typing import Any, Dict, Optional

from config_reader import config
from services import llm_service
from services.llm_service import LLMCapacityError

logger = logging.getLogger(__name__)

# --- Smart Sampling: обсяг вибірки для LLM-аналізу Telegram-каналу -----------
_SAMPLE_POSTS_LIMIT = 40       # у LLM ідуть лише ПЕРШІ 40 найновіших постів
_SAMPLE_POST_MAX_CHARS = 800   # обрізка одного поста вибірки (антитокен-ліміт)
_PINNED_MAX_CHARS = 1500       # обрізка закріпленого повідомлення (правила магазину)
_LLM_ATTEMPTS = 2              # LLM-виклик: основна спроба + 1 ретрай
_LLM_RETRY_PAUSE = 5.0         # пауза (с) перед ретраєм після LLMCapacityError

_LLM_SYSTEM_PROMPT = (
    "Ти — бізнес-аналітик маркетплейсу Taverna. Тобі надають зміст "
    "Telegram-каналу постачальника-дропшипера: закріплене повідомлення "
    "та останні пости. Проаналізуй асортимент і правила магазину. "
    "Відповідай ЛИШЕ валідним JSON-об'єктом без markdown-огорожок "
    "та без будь-яких пояснень довкола JSON."
)


def _normalize_source_link(link: Optional[str]) -> str:
    raw = (link or "").strip().lower()
    if not raw:
        return ""
    for prefix in ("https://", "http://"):
        if raw.startswith(prefix):
            raw = raw[len(prefix):]
    raw = raw.split("?", 1)[0].rstrip("/")
    if raw.startswith("www."):
        raw = raw[4:]
    if raw.startswith("t.me/"):
        raw = raw[5:]
    if raw.startswith("telegram.me/"):
        raw = raw[12:]
    return raw.lstrip("@").strip()


def _history_warning_text(deleted_at) -> str:
    date_str = "—"
    if deleted_at is not None:
        try:
            date_str = deleted_at.strftime("%d.%m.%Y")
        except Exception:
            date_str = str(deleted_at)
    return (
        f"УВАГА: Цей постачальник вже співпрацював з нами і був видалений {date_str}. "
        "Вкажи це у висновку."
    )


async def find_supplier_history_by_links(*links: Optional[str]):
    """Шукає запис SupplierHistoryLog за telegram/xml лінком."""
    needles = {_normalize_source_link(item) for item in links}
    needles.discard("")
    if not needles:
        return None
    from database.db import AsyncSessionLocal
    from database.models import SupplierHistoryLog
    from sqlalchemy import select

    if AsyncSessionLocal is None:
        return None
    try:
        async with AsyncSessionLocal() as db:
            rows = (
                (
                    await db.execute(
                        select(SupplierHistoryLog).order_by(SupplierHistoryLog.deleted_at.desc())
                    )
                )
                .scalars()
                .all()
            )
    except Exception as e:
        logger.warning("Не вдалося прочитати supplier_history_log: %s", e)
        return None
    for row in rows:
        if _normalize_source_link(row.source_link) in needles:
            return row
    return None


async def history_warning_for_links(*links: Optional[str]) -> str:
    history = await find_supplier_history_by_links(*links)
    if history is None:
        return ""
    return _history_warning_text(history.deleted_at)


class SupplierAnalyzer:
    """Короткий security-звіт по заявці магазину для CEO."""

    def __init__(self, api_key: Optional[str] = None):
        # [MIGRATION] api_key (Gemini) ігноруємо — ключ NVIDIA живе в llm_service
        self.model_name = llm_service.DEFAULT_MODEL

        if not llm_service.has_llm_keys():
            logger.warning("NVIDIA_API_KEY не знайдено. AI-скоринг заявок буде пропущено.")

    @property
    def is_ready(self) -> bool:
        return llm_service.has_llm_keys()

    def _build_prompt(self, supplier_data: dict, has_duplicates: bool, history_note: str = "") -> str:
        extra = f" {history_note}" if history_note else ""
        return (
            "Ти - Security Manager маркетплейсу. Проаналізуй заявку магазину: "
            f"{supplier_data}. Дублікати в БД: {has_duplicates}.{extra} "
            "Сформуй короткий звіт для CEO: адекватність, ризики, висновок."
        )

    async def _complete(
        self,
        model_name: str,
        prompt: str,
        *,
        response_mime_type: Optional[str] = None,
    ) -> str:
        """
        Один LLM-виклик через services.llm_service (NVIDIA NIM, OpenAI SDK).
        response_mime_type залишено для сумісності сигнатури — JSON-чистку
        llm_service виконує сам (clean_json_string/extract_json).
        """
        return await llm_service.generate_json_response(
            prompt=prompt,
            system_prompt="Ти - Security Manager маркетплейсу Taverna. Відповідай стисло і по суті.",
            temperature=0.2,
            max_tokens=4096,
        )

    async def analyze_supplier(self, supplier_data: dict, has_duplicates: bool) -> str:
        """Повертає текстовий звіт. 503 — до 3 спроб з паузою 5с."""
        history_note = await history_warning_for_links(
            supplier_data.get("telegram_channel_link"),
            supplier_data.get("channel_link"),
            supplier_data.get("yml_link"),
            supplier_data.get("xml_url"),
            supplier_data.get("shop_url"),
        )
        if not self.is_ready:
            dup = "так" if has_duplicates else "ні"
            extra = f"\n{history_note}" if history_note else ""
            return (
                "AI-аналіз пропущено (немає NVIDIA_API_KEY).\n"
                f"Дублікати в БД: {dup}.{extra}\n"
                "Потрібна ручна перевірка заявки адміністратором."
            )

        prompt = self._build_prompt(supplier_data, has_duplicates, history_note)
        last_error = None
        for attempt in range(1, 4):
            try:
                report = await self._complete(self.model_name, prompt)
                if report:
                    return report
            except Exception as e:
                last_error = e
                logger.warning(
                    "SupplierAnalyzer (%s, спроба %s/3): %s",
                    self.model_name, attempt, e,
                )
                # 429/5xx — тимчасова перевантаженість NIM: пауза і ретрай
                if isinstance(e, LLMCapacityError) and attempt < 3:
                    await asyncio.sleep(5)
                    continue
                break

        logger.error("SupplierAnalyzer не зміг отримати звіт: %s", last_error)
        dup = "так" if has_duplicates else "ні"
        extra = f"\n{history_note}" if history_note else ""
        return (
            "AI-аналіз тимчасово недоступний.\n"
            f"Дублікати в БД: {dup}.{extra}\n"
            "Потрібна ручна перевірка заявки адміністратором."
        )


def _normalize_channel_score(parsed: Dict[str, Any], channel_link: str) -> Dict[str, Any]:
    summary = parsed.get("admin_summary")
    if not summary:
        summary = f"Канал {channel_link or '—'} проаналізовано. Потрібна ручна перевірка адміном."
    return {
        "is_dropship": bool(parsed.get("is_dropship")),
        "niche": str(parsed.get("niche") or "невідомо"),
        "price_range": str(parsed.get("price_range") or "невідомо"),
        "description_quality": str(parsed.get("description_quality") or "невідомо"),
        "admin_summary": str(summary),
    }


async def _load_existing_shop_names() -> list[str]:
    """До 30 назв активних магазинів платформи — контекст для duplicate_risk."""
    try:
        from database.db import AsyncSessionLocal
        from database.models import Supplier, SupplierStatus
        from sqlalchemy import select

        if AsyncSessionLocal is None:
            return []
        async with AsyncSessionLocal() as db:
            rows = (
                (
                    await db.execute(
                        select(Supplier.store_name)
                        .where(Supplier.status == SupplierStatus.active)
                        .order_by(Supplier.created_at.desc())
                        .limit(30)
                    )
                )
                .scalars()
                .all()
            )
            return [str(r).strip() for r in rows if str(r or "").strip()]
    except Exception as e:
        logger.debug("Smart Sampling: список магазинів недоступний: %s", e)
        return []


async def _llm_analyze_channel_sample(
    channel_link: str,
    pinned_text: str,
    sample_posts: list[str],
) -> Optional[Dict[str, Any]]:
    """
    LLM-аналіз Smart-вибірки каналу (NVIDIA NIM, модель = config.NVIDIA_MODEL).

    Повертає dict (store_rules / main_categories / store_description /
    duplicate_risk) або None — якщо немає ключа, вибірка порожня, збій
    чи невалідний JSON. Викликається ПІСЛЯ Telethon-скану, поза
    _client_lock (LLM до 120с не блокує Telegram-парсер).
    """
    if not llm_service.has_llm_keys():
        logger.warning(
            "Smart Sampling %s: NVIDIA_API_KEY немає — LLM-аналіз пропущено.", channel_link
        )
        return None
    if not pinned_text and not sample_posts:
        return None

    existing_shops = await _load_existing_shop_names()

    pinned_block = pinned_text or "(закріпленого повідомлення немає)"
    posts_block = "\n\n".join(
        f"[Пост {i}] {text}" for i, text in enumerate(sample_posts, start=1)
    ) or "(постів з текстом немає)"
    shops_block = ", ".join(existing_shops) if existing_shops else "(немає даних)"

    prompt = (
        f"Канал постачальника: {channel_link or '—'}\n\n"
        f"=== ЗАКРІПЛЕНЕ ПОВІДОМЛЕННЯ (правила магазину) ===\n{pinned_block}\n\n"
        f"=== ОСТАННІ {len(sample_posts)} ПОСТІВ КАНАЛУ (найновіші) ===\n{posts_block}\n\n"
        f"=== НАЗВИ ІСНУЮЧИХ МАГАЗИНІВ ПЛАТФОРМИ ===\n{shops_block}\n\n"
        "Уважно проаналізуй ВСІ надані пости (не лише закріплене повідомлення). "
        "Шукай будь-які згадки про умови доставки, оплати, графік роботи, "
        "мінімальну передплату чи правила співпраці. Сформуй з них поле store_rules. "
        "Правила можуть бути розпорошені по звичайних постах каналу — збирай їх усі.\n\n"
        "Завдання: склади детальний звіт для адміністратора маркетплейсу "
        "про цей магазин-дропшипер за змістом каналу.\n"
        "Поверни ЛИШЕ валідний JSON-об'єкт точно такого формату:\n"
        "{\n"
        '  "store_rules": "умови доставки, оплати, графік роботи, обмін/повернення — '
        '2-4 речення; якщо в каналі не вказані — напиши «не вказано в каналі»",\n'
        '  "main_categories": ["Категорія 1", "Категорія 2", "Категорія 3"],\n'
        '  "store_description": "1-3 речення про асортимент і цільову аудиторію магазину",\n'
        '  "duplicate_risk": "Низький | Середній | Високий — оцінка схожості '
        'асортименту/назви на існуючі магазини платформи (з коротким поясненням)"\n'
        "}"
    )

    last_error: Optional[Exception] = None
    for attempt in range(1, _LLM_ATTEMPTS + 1):
        try:
            raw = await llm_service.generate_json_response(
                prompt=prompt,
                system_prompt=_LLM_SYSTEM_PROMPT,
                model=config.NVIDIA_MODEL,  # єдина точка конфігурації моделі — .env
                temperature=0.2,
                max_tokens=1024,
            )
            parsed = llm_service.extract_json(raw)
            if isinstance(parsed, dict):
                return parsed
            logger.warning(
                "Smart Sampling %s: LLM повернув невалідний JSON (спроба %s/%s).",
                channel_link, attempt, _LLM_ATTEMPTS,
            )
        except Exception as e:
            last_error = e
            # Точна діагностика для адміна: ЧОМУ модель відмовилась відповідати
            # (429 ліміт / 5xx збій NIM / таймаут / порожня відповідь / сміття).
            status = getattr(e, "status", None) or getattr(e, "status_code", None)
            raw_body = str(getattr(e, "raw", "") or "")[:500]
            logger.warning(
                "Smart Sampling %s (спроба %s/%s): %s: %s | HTTP %s | raw: %r",
                channel_link, attempt, _LLM_ATTEMPTS,
                type(e).__name__, e,
                status if status is not None else "—",
                raw_body or "(порожньо)",
            )
            # 429/5xx — перевантаженість NIM: одна пауза і повтор
            if isinstance(e, LLMCapacityError) and attempt < _LLM_ATTEMPTS:
                await asyncio.sleep(_LLM_RETRY_PAUSE)
                continue
            break

    if last_error is not None:
        logger.error(
            "Smart Sampling %s: LLM-аналіз недоступний — %s: %s (HTTP %s). "
            "Звіт буде без ШІ-полів.",
            channel_link, type(last_error).__name__, last_error,
            getattr(last_error, "status", None) or getattr(last_error, "status_code", None) or "—",
        )
    return None


def _merge_llm_into_report(base: Dict[str, Any], llm_data: Optional[Dict[str, Any]]) -> None:
    """
    Зливає LLM-результат у базу скан-звіту (in-place), гарантуючи валідні типи:
      main_categories → base.main_categories + base.niche (фронт показує «Ніша»);
      store_description → base.store_description + base.description_quality;
      store_rules, duplicate_risk — як є, з приведенням до рядка.
    """
    if not llm_data:
        return

    categories = llm_data.get("main_categories")
    if isinstance(categories, (list, tuple)):
        clean = [str(c).strip() for c in categories if str(c or "").strip()]
    else:
        single = str(categories or "").strip()
        clean = [single] if single else []
    if clean:
        base["main_categories"] = clean[:10]
        base["niche"] = ", ".join(clean[:3])

    store_rules = str(llm_data.get("store_rules") or "").strip()
    if store_rules:
        base["store_rules"] = store_rules

    description = str(llm_data.get("store_description") or "").strip()
    if description:
        base["store_description"] = description
        base["description_quality"] = description

    risk = str(llm_data.get("duplicate_risk") or "").strip()
    if risk:
        base["duplicate_risk"] = risk


async def analyze_telegram_channel(channel_link: str) -> dict:
    """
    ГІБРИДНИЙ скан Telegram-каналу постачальника (Smart Sampling).

    КРОК А — Швидкий скан (Telethon, дешево):
      1. Ітеруємо повідомлення каналу з offset_date = 365 днів назад.
      2. Рахуємо пости (total_posts_last_year).
      3. Regex-ом шукаємо ціни в текстах → мін/макс ціна.
      4. Паралельно збираємо Smart Sampling-вибірку:
         текст закріпленого повідомлення (правила магазину) + тексти
         лише ПЕРШИХ 40 найновіших постів (обрізані до 800 символів).

    КРОК Б — LLM-аналіз вибірки (поза _client_lock — не блокує парсер):
      Закріплене + 40 постів → NVIDIA NIM (config.NVIDIA_MODEL) →
      store_rules / main_categories / store_description / duplicate_risk.
      Збій LLM НЕ ламає звіт — просто лишаються лише дані скану.

    Результат — єдиний JSON-звіт для адміна (у supplier.ai_score_report).

    Аналогічну перевірку «канал існує і читається» виконує
    verify_telegram_channel перед подачею заявки.
    """
    from datetime import datetime, timedelta, timezone

    from services.telegram_parser import (
        TelegramChannelParseError,
        _client_lock,
        _ensure_client,
        _normalize_channel_ref,
    )
    from telethon.errors import (
        ChannelPrivateError,
        FloodWaitError,
        UsernameInvalidError,
        UsernameNotOccupiedError,
    )
    from telethon.tl.types import InputMessagesFilterPinned

    fallback = {
        "is_dropship": True,
        "niche": "невідомо",
        "price_range": "невідомо",
        "description_quality": "не оцінено",
        "admin_summary": (
            f"Скан каналу {channel_link or '—'} недоступний. "
            "Потрібна ручна перевірка адміністратором."
        ),
        "total_posts_last_year": 0,
        "min_price": None,
        "max_price": None,
        # Smart Sampling не виконувався (канал не прочитано)
        "store_rules": "не визначено",
        "main_categories": [],
        "store_description": "",
        "duplicate_risk": "не оцінено",
    }
    history_note = await history_warning_for_links(channel_link)

    channel_ref = _normalize_channel_ref(channel_link)
    offset_date = datetime.now(timezone.utc) - timedelta(days=365)

    total_posts = 0
    prices: list[float] = []
    # Smart Sampling: закріплене повідомлення + перші N найновіших постів.
    # iter_messages йде від новіших до старіших, тож перші 40 = найновіші.
    pinned_text = ""
    sample_posts: list[str] = []
    # Ціни в текстах постів: "1500 грн", "1 500грн", "1500₴", "1500.00 UAH" тощо.
    _PRICE_RE = re.compile(
        r"(?<![\d.,])"                                   # не всередині числа
        r"(\d{1,3}(?:[ \u00A0]\d{3})+|\d+(?:[.,]\d{1,2})?)"  # 1 500 / 1500 / 1500.50
        r"\s*(?:грн|₴|ку|грн\.|UAH|uah)?\s*$"            # валюта (або кінець рядка)
        r"|"
        r"(?:грн|₴|UAH|uah)\.?\s*(\d{1,3}(?:[ \u00A0]\d{3})+|\d+(?:[.,]\d{1,2})?)",
        re.IGNORECASE | re.MULTILINE,
    )

    async with _client_lock:
        try:
            client = await _ensure_client()
            entity = await client.get_entity(channel_ref)
            # --- Закріплене повідомлення: правила/умови магазину -----------
            try:
                async for pinned in client.iter_messages(
                    entity, limit=1, filter=InputMessagesFilterPinned
                ):
                    raw_pinned = (pinned.message or "").strip()
                    if raw_pinned:
                        pinned_text = raw_pinned[:_PINNED_MAX_CHARS]
                    break
            except Exception as e:
                # Закріплення — опціональні дані: його відсутність не зупиняє скан
                logger.debug(
                    "analyze_telegram_channel: pinned %s недоступний: %s", channel_link, e
                )
            async for message in client.iter_messages(
                entity, limit=None, offset_date=offset_date
            ):
                total_posts += 1
                text = (message.message or "").strip()
                if not text:
                    continue
                if len(sample_posts) < _SAMPLE_POSTS_LIMIT:
                    sample_posts.append(text[:_SAMPLE_POST_MAX_CHARS])
                for match in _PRICE_RE.finditer(text):
                    raw = match.group(1) or match.group(2)
                    if not raw:
                        continue
                    # "1 500" → 1500; "1500.50"/"1500,50" → 1500.50
                    normalized = re.sub(r"[ \u00A0]", "", raw)
                    normalized = normalized.replace(",", ".")
                    try:
                        value = float(normalized)
                    except ValueError:
                        continue
                    # Відсікаємо сміття: ціни товарів дропшипу реально 50–50000 грн
                    if 50 <= value <= 50000:
                        prices.append(value)
        except UsernameNotOccupiedError as e:
            raise TelegramChannelParseError(f"Канал не знайдено: {channel_link}") from e
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
        except TelegramChannelParseError:
            raise
        except Exception as e:
            logger.error("analyze_telegram_channel: збій скану %s: %s", channel_link, e, exc_info=True)
            summary = (
                f"Не вдалося прочитати канал {channel_link or '—'}. "
                "Потрібна ручна перевірка адміністратором."
            )
            fallback["admin_summary"] = f"{history_note} {summary}".strip() if history_note else summary
            return fallback

    min_price = int(min(prices)) if prices else None
    max_price = int(max(prices)) if prices else None
    if prices:
        price_range = f"{min_price}–{max_price} грн"
    else:
        price_range = "невідомо"

    # --- КРОК Б: LLM-аналіз Smart-вибірки (поза _client_lock) ----------------
    llm_data = await _llm_analyze_channel_sample(channel_link, pinned_text, sample_posts)

    result = {
        "is_dropship": total_posts > 0,
        "niche": "невідомо",
        "price_range": price_range,
        "description_quality": "не оцінено (швидкий скан без ШІ)",
        "admin_summary": "",
        "total_posts_last_year": total_posts,
        "min_price": min_price,
        "max_price": max_price,
        # Smart Sampling (LLM): заповнюються нижче через _merge_llm_into_report
        "store_rules": "не вказано в каналі",
        "main_categories": [],
        "store_description": "",
        "duplicate_risk": "не оцінено",
    }
    _merge_llm_into_report(result, llm_data)

    ai_part = "з LLM-аналізом вибірки" if llm_data else "LLM недоступний — лише дані скану"
    rules = result.get("store_rules") or ""
    rules_part = (
        f" Правила магазину: {rules[:300]}." if rules and rules != "не вказано в каналі" else ""
    )
    summary = (
        f"Гібридний аналіз каналу {channel_link}: {total_posts} постів за останні 12 місяців, "
        f"ціни {price_range}. Асортимент: {result['niche']}. "
        f"Ризик дубліката: {result['duplicate_risk']}.{rules_part} ({ai_part}) "
        "Схваліть заявку — постачальник обере ліміт імпорту, і парсинг запуститься."
    )
    if history_note:
        summary = f"{history_note} {summary}"
    result["admin_summary"] = summary

    logger.info(
        "analyze_telegram_channel: %s — %s постів/365д, ціни %s, LLM-звіт: %s.",
        channel_link, total_posts, price_range, "так" if llm_data else "ні",
    )
    return result
