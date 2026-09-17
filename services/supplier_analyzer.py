# services/supplier_analyzer.py
"""AI-модерація заявок постачальників (google.genai SDK). Не чіпає логіку товарів."""
import asyncio
import logging
from typing import Any, Dict, Optional

try:
    from google import genai
    from google.genai import types
    from google.genai import errors as genai_errors
except ImportError:
    genai = None  # type: ignore
    types = None  # type: ignore
    genai_errors = None  # type: ignore

from config_reader import config
from services.gemini_key_manager import AllKeysExhaustedError, get_key_manager

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-3.6-flash"
GEMINI_FALLBACK_MODEL = "gemini-3.6-flash"


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
        if genai is None or not self._key_manager.has_keys():
            logger.warning("GEMINI_API_KEYS не знайдено або google-genai не встановлено. AI-скоринг заявок буде пропущено.")

    @property
    def is_ready(self) -> bool:
        return bool(genai is not None and self._key_manager.has_keys())

    def _build_prompt(self, supplier_data: dict, has_duplicates: bool) -> str:
        return (
            "Ти - Security Manager маркетплейсу. Проаналізуй заявку магазину: "
            f"{supplier_data}. Дублікати в БД: {has_duplicates}. "
            "Сформуй короткий звіт для CEO: адекватність, ризики, висновок."
        )

    async def _complete(
        self,
        model_name: str,
        prompt: str,
        *,
        response_mime_type: Optional[str] = None,
    ) -> str:
        if genai is None or types is None or not self._key_manager.has_keys():
            raise Exception("Gemini client is not configured")
        last_error: Optional[Exception] = None
        for _ in range(max(1, self._key_manager.key_count)):
            try:
                active_key = self._key_manager.get_next_active_key()
            except AllKeysExhaustedError as e:
                raise Exception("429 Rate Limit") from e
            client = genai.Client(api_key=active_key)
            cfg_kwargs: Dict[str, Any] = {
                "temperature": 0.2,
                "max_output_tokens": 800,
            }
            if response_mime_type:
                cfg_kwargs["response_mime_type"] = response_mime_type
            try:
                response = await client.aio.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(**cfg_kwargs),
                )
            except Exception as e:
                api_error = getattr(genai_errors, "APIError", None) if genai_errors else None
                code = getattr(e, "code", None)
                if (api_error and isinstance(e, api_error) and code == 429) or "429" in str(e):
                    self._key_manager.mark_key_exhausted(active_key)
                    last_error = e
                    continue
                if api_error and isinstance(e, api_error):
                    if e.code == 503:
                        raise Exception("503 High Demand") from e
                    raise Exception(f"Gemini API Error {e.code}: {e.message or e}") from e
                raise
            text = (response.text or "").strip()
            if not text:
                raise Exception("Gemini повернув порожню відповідь")
            return text
        raise Exception("429 Rate Limit") from last_error

    async def analyze_supplier(self, supplier_data: dict, has_duplicates: bool) -> str:
        """Повертає текстовий звіт. 503 — до 3 спроб з паузою 5с."""
        if not self.is_ready:
            dup = "так" if has_duplicates else "ні"
            return (
                "AI-аналіз пропущено (немає GEMINI_API_KEYS).\n"
                f"Дублікати в БД: {dup}.\n"
                "Потрібна ручна перевірка заявки адміністратором."
            )

        prompt = self._build_prompt(supplier_data, has_duplicates)
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
        return (
            "AI-аналіз тимчасово недоступний.\n"
            f"Дублікати в БД: {dup}.\n"
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

    try:
        posts_blob = await get_recent_channel_posts(channel_link, limit=15)
    except TelegramChannelParseError as e:
        logger.warning("analyze_telegram_channel: парсинг %s: %s", channel_link, e)
        fallback["admin_summary"] = str(e)
        return fallback
    except Exception as e:
        logger.error("analyze_telegram_channel: збій парсингу %s: %s", channel_link, e, exc_info=True)
        fallback["admin_summary"] = (
            f"Не вдалося прочитати канал {channel_link or '—'}. "
            "Потрібна ручна перевірка адміністратором."
        )
        return fallback

    analyzer = SupplierAnalyzer()
    if not analyzer.is_ready:
        return fallback

    prompt = (
        f"Ось останні пости з Telegram-каналу постачальника: {posts_blob}. "
        "Проаналізуй їх і поверни JSON строго такого формату: "
        "{ 'is_dropship': boolean, 'niche': string, 'price_range': string, "
        "'description_quality': string, 'admin_summary': string "
        "(короткий висновок для адміна, чи варто співпрацювати) }"
    )

    from services.gemini_service import _safe_json_loads

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
                parsed = _safe_json_loads(raw) if raw else None
                if parsed:
                    return _normalize_channel_score(parsed, channel_link)
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
    fallback["admin_summary"] = (
        f"AI-аналіз каналу {channel_link or '—'} тимчасово недоступний. "
        "Потрібна ручна перевірка адміністратором."
    )
    return fallback
