# services/supplier_analyzer.py
"""AI-модерація заявок постачальників — прямі REST-запити до Gemini API (aiohttp).
Не чіпає логіку товарів.

SDK google-genai НЕ використовується: він хибно трактує ключі формату AQ...
як OAuth-токени і шле Bearer-заголовок, через що Google повертає 401 UNAUTHENTICATED.
REST API з ключем у query-параметрі ?key=... працює коректно.
"""
import asyncio
import json
import logging
from typing import Any, Dict, Optional

import aiohttp

from config_reader import config, sanitize_gemini_api_key
from services.gemini_key_manager import AllKeysExhaustedError, get_key_manager

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-3.6-flash"
GEMINI_FALLBACK_MODEL = "gemini-3.6-flash"

GEMINI_REST_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_REST_TIMEOUT = aiohttp.ClientTimeout(total=120)


def _extract_gemini_rest_text(data: Dict[str, Any]) -> str:
    """Витягує згенерований текст з JSON-відповіді REST API generateContent."""
    if not isinstance(data, dict):
        return ""
    candidates = data.get("candidates") or []
    if not candidates:
        feedback = data.get("promptFeedback") or {}
        block_reason = feedback.get("blockReason")
        if block_reason:
            raise Exception(f"Gemini заблокував запит: {block_reason}")
        return ""
    first = candidates[0] if isinstance(candidates[0], dict) else {}
    finish_reason = str(first.get("finishReason") or "")
    parts = ((first.get("content") or {}).get("parts")) or []
    texts = [p.get("text", "") for p in parts if isinstance(p, dict) and p.get("text")]
    text = "".join(texts).strip()
    if not text and finish_reason and finish_reason not in ("STOP", ""):
        raise Exception(f"Gemini завершив відповідь без тексту: finishReason={finish_reason}")
    return text


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
        self._key_manager = get_key_manager()
        self.model_name = GEMINI_MODEL
        self.fallback_model = GEMINI_FALLBACK_MODEL
        if api_key and str(api_key).strip():
            from services.gemini_key_manager import GeminiKeyManager
            self._key_manager = GeminiKeyManager(
                [str(api_key).strip(), *list(config.GEMINI_API_KEYS)]
            )
        if not self._key_manager.has_keys():
            logger.warning("GEMINI_API_KEYS не знайдено. AI-скоринг заявок буде пропущено.")

    @property
    def is_ready(self) -> bool:
        return bool(self._key_manager.has_keys())

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
        Прямий асинхронний REST-запит до Gemini API через aiohttp.
        SDK google-genai НЕ використовується (401 UNAUTHENTICATED на ключах AQ...).
        Ключ передається через query-параметр ?key=..., як рекомендує REST API.
        """
        if not self._key_manager.has_keys():
            raise Exception("Gemini client is not configured")

        generation_config: Dict[str, Any] = {
            "temperature": 0.2,
            "maxOutputTokens": 800,
        }
        if response_mime_type:
            generation_config["responseMimeType"] = response_mime_type

        payload: Dict[str, Any] = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": generation_config,
        }

        last_error: Optional[Exception] = None
        for _ in range(max(1, self._key_manager.key_count)):
            try:
                active_key = self._key_manager.get_next_active_key()
            except AllKeysExhaustedError as e:
                raise Exception("429 Rate Limit") from e

            key = sanitize_gemini_api_key(active_key)
            url = f"{GEMINI_REST_BASE}/{model_name}:generateContent?key={key}"

            try:
                async with aiohttp.ClientSession(timeout=GEMINI_REST_TIMEOUT) as session:
                    async with session.post(
                        url,
                        json=payload,
                        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                    ) as resp:
                        status = resp.status
                        raw_text = await resp.text()

                        if status == 200:
                            try:
                                data = json.loads(raw_text)
                            except Exception as e:
                                raise Exception(
                                    f"Gemini REST повернув невалідний JSON (HTTP 200): {raw_text[:300]}"
                                ) from e
                            text = _extract_gemini_rest_text(data)
                            if not text:
                                raise Exception("Gemini повернув порожню відповідь")
                            return text

                        if status == 429:
                            self._key_manager.mark_key_exhausted(active_key)
                            last_error = Exception(f"429 Rate Limit: {raw_text[:300]}")
                            continue

                        if status in (401, 403):
                            self._key_manager.mark_key_exhausted(active_key)
                            last_error = Exception(f"{status} UNAUTHENTICATED: {raw_text[:300]}")
                            continue

                        if status == 503:
                            raise Exception(f"503 High Demand: {raw_text[:300]}")

                        raise Exception(f"Gemini API Error {status}: {raw_text[:500]}")
            except aiohttp.ClientError as e:
                last_error = e
                logger.warning(
                    "Gemini REST мережева помилка на ключі ...%s: %s",
                    key[-4:],
                    e,
                )
                continue

        raise Exception("429 Rate Limit") from last_error

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
                "AI-аналіз пропущено (немає GEMINI_API_KEYS).\n"
                f"Дублікати в БД: {dup}.{extra}\n"
                "Потрібна ручна перевірка заявки адміністратором."
            )

        prompt = self._build_prompt(supplier_data, has_duplicates, history_note)
        last_error = None
        for attempt in range(1, 4):
            for model_name in (self.model_name, self.fallback_model):
                try:
                    report = await self._complete(model_name, prompt)
                    if report:
                        return report
                except Exception as e:
                    last_error = e
                    logger.warning(
                        "SupplierAnalyzer (%s, спроба %s/3): %s",
                        model_name, attempt, e,
                    )
                    err = str(e)
                    if "503" in err or "429" in err:
                        break
                    if model_name == self.model_name:
                        continue
            if last_error and ("503" in str(last_error) or "429" in str(last_error)) and attempt < 3:
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

    Пости беремо через Telethon (`get_recent_channel_posts`), далі Gemini
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

    from services.gemini_service import extract_gemini_json

    last_error: Optional[Exception] = None
    for attempt in range(1, 4):
        for model_name in (analyzer.model_name, analyzer.fallback_model):
            try:
                try:
                    raw = await analyzer._complete(
                        model_name,
                        prompt,
                        response_mime_type="application/json",
                    )
                except Exception:
                    raw = await analyzer._complete(model_name, prompt)
                parsed = extract_gemini_json(raw) if raw else None
                if isinstance(parsed, dict):
                    result = _normalize_channel_score(parsed, channel_link)
                    if history_note and history_note not in str(result.get("admin_summary") or ""):
                        result["admin_summary"] = f"{history_note} {result['admin_summary']}"
                    return result
                last_error = Exception("Gemini повернув не-JSON відповідь")
            except Exception as e:
                last_error = e
                logger.warning(
                    "analyze_telegram_channel (%s, спроба %s/3): %s",
                    model_name, attempt, e,
                )
                err = str(e)
                if "503" in err or "429" in err:
                    break
                if model_name == analyzer.model_name:
                    continue
        if last_error and ("503" in str(last_error) or "429" in str(last_error)) and attempt < 3:
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
