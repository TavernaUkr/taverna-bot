# services/supplier_analyzer.py
"""AI-модерація заявок постачальників (google.genai SDK). Не чіпає логіку товарів."""
import asyncio
import logging
from typing import Optional

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

    async def _complete(self, model_name: str, prompt: str) -> str:
        if genai is None or types is None or not self._key_manager.has_keys():
            raise Exception("Gemini client is not configured")
        last_error: Optional[Exception] = None
        for _ in range(max(1, self._key_manager.key_count)):
            try:
                active_key = self._key_manager.get_next_active_key()
            except AllKeysExhaustedError as e:
                raise Exception("429 Rate Limit") from e
            client = genai.Client(api_key=active_key)
            try:
                response = await client.aio.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.2,
                        max_output_tokens=800,
                    ),
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
