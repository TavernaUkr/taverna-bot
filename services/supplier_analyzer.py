# services/supplier_analyzer.py
"""AI-модерація заявок постачальників через NVIDIA Build (NIM).
Не чіпає логіку товарів.

Рефакторинг: платний Gemini замінено на безкоштовний NVIDIA NIM
(services.llm_service, OpenAI SDK). Зміна моделі — NVIDIA_MODEL у .env
або DEFAULT_MODEL у services/llm_service.py.
"""
import asyncio
import json
import logging
from typing import Any, Dict, Optional

from config_reader import config
from services import llm_service
from services.llm_service import LLMCapacityError

logger = logging.getLogger(__name__)


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


async def analyze_telegram_channel(channel_link: str) -> dict:
    """
    AI-оцінка Telegram-каналу постачальника.

    Пости беремо через Telethon (`get_recent_channel_posts`), далі NVIDIA LLM
    повертає JSON-звіт для адміна.
    """
    from services.telegram_parser import (
        TelegramChannelParseError,
        get_recent_channel_posts,
    )

    fallback = {
        "is_dropship": True,
        "niche": "взуття / одяг",
        "price_range": "невідомо",
        "description_quality": "не оцінено",
        "admin_summary": (
            f"AI-аналіз каналу {channel_link or '—'} недоступний. "
            "Потрібна ручна перевірка адміністратором."
        ),
    }
    history_note = await history_warning_for_links(channel_link)

    try:
        posts_blob = await get_recent_channel_posts(
            channel_link, limit=15, upload_media=False
        )
    except TelegramChannelParseError as e:
        logger.warning("analyze_telegram_channel: парсинг %s: %s", channel_link, e)
        summary = str(e)
        fallback["admin_summary"] = f"{history_note} {summary}".strip() if history_note else summary
        return fallback
    except Exception as e:
        logger.error("analyze_telegram_channel: збій парсингу %s: %s", channel_link, e, exc_info=True)
        summary = (
            f"Не вдалося прочитати канал {channel_link or '—'}. "
            "Потрібна ручна перевірка адміністратором."
        )
        fallback["admin_summary"] = f"{history_note} {summary}".strip() if history_note else summary
        return fallback

    analyzer = SupplierAnalyzer()
    if not analyzer.is_ready:
        if history_note:
            fallback["admin_summary"] = f"{history_note} {fallback['admin_summary']}"
        return fallback

    prompt = (
        f"Ось останні пости з Telegram-каналу постачальника: {posts_blob}. "
        "Проаналізуй їх і поверни JSON строго такого формату: "
        "{ 'is_dropship': boolean, 'niche': string, 'price_range': string, "
        "'description_quality': string, 'admin_summary': string "
        "(короткий висновок для адміна, чи варто співпрацювати) }"
    )
    if history_note:
        prompt = f"{history_note} {prompt}"

    last_error: Optional[Exception] = None
    for attempt in range(1, 4):
        try:
            # response_mime_type='application/json' — сумісність сигнатури,
            # чистку JSON llm_service виконує сам.
            raw = await analyzer._complete(
                analyzer.model_name,
                prompt,
                response_mime_type="application/json",
            )
            parsed = llm_service.extract_json(raw) if raw else None
            if isinstance(parsed, dict):
                result = _normalize_channel_score(parsed, channel_link)
                if history_note and history_note not in str(result.get("admin_summary") or ""):
                    result["admin_summary"] = f"{history_note} {result['admin_summary']}"
                return result
            last_error = Exception("NVIDIA LLM повернув не-JSON відповідь")
        except Exception as e:
            last_error = e
            logger.warning(
                "analyze_telegram_channel (%s, спроба %s/3): %s",
                analyzer.model_name, attempt, e,
            )
            # 429/5xx — тимчасова перевантаженість NIM: пауза і ретрай
            if isinstance(e, LLMCapacityError) and attempt < 3:
                await asyncio.sleep(5)
                continue
            break

    logger.error("analyze_telegram_channel не зміг отримати звіт: %s", last_error)
    fallback_text = (
        f"AI-аналіз каналу {channel_link or '—'} тимчасово недоступний. "
        "Потрібна ручна перевірка адміністратором."
    )
    fallback["admin_summary"] = f"{history_note} {fallback_text}".strip() if history_note else fallback_text
    return fallback
