# services/supplier_analyzer.py
"""AI-модерація заявок постачальників (Gemini REST). Не чіпає логіку товарів."""
import logging
from typing import Any, Dict, Optional

import aiohttp

from config_reader import config

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-3.6-flash"
GEMINI_FALLBACK_MODEL = "gemini-3.6-flash"


def _resolve_gemini_api_key() -> str:
    secret = getattr(config, "gemini_api_key", None)
    if secret:
        return secret.get_secret_value().strip()
    return ""


class SupplierAnalyzer:
    """Короткий security-звіт по заявці магазину для CEO."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = (api_key or "").strip() or _resolve_gemini_api_key()
        self.model_name = GEMINI_MODEL
        self.fallback_model = GEMINI_FALLBACK_MODEL
        if not self.api_key:
            logger.warning("GEMINI_API_KEY не знайдено. AI-скоринг заявок буде пропущено.")

    @property
    def is_ready(self) -> bool:
        return bool(self.api_key)

    def _build_prompt(self, supplier_data: dict, has_duplicates: bool) -> str:
        return (
            "Ти - Security Manager маркетплейсу. Проаналізуй заявку магазину: "
            f"{supplier_data}. Дублікати в БД: {has_duplicates}. "
            "Сформуй короткий звіт для CEO: адекватність, ризики, висновок."
        )

    async def _complete(self, model_name: str, prompt: str) -> str:
        api_url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_name}:generateContent?key={self.api_key}"
        )
        payload: Dict[str, Any] = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 800},
        }
        headers = {"Content-Type": "application/json"}
        async with aiohttp.ClientSession() as session:
            async with session.post(api_url, headers=headers, json=payload) as resp:
                if resp.status == 429:
                    raise Exception("429 Rate Limit")
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Gemini API Error {resp.status}: {error_text}")
                data = await resp.json()
        try:
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except (KeyError, IndexError, TypeError):
            raise Exception(f"Gemini повернув неочікувану відповідь: {data}")

    async def analyze_supplier(self, supplier_data: dict, has_duplicates: bool) -> str:
        """Повертає текстовий звіт. Якщо ключа немає або API впав — безпечний fallback."""
        if not self.is_ready:
            dup = "так" if has_duplicates else "ні"
            return (
                "AI-аналіз пропущено (немає GEMINI_API_KEY).\n"
                f"Дублікати в БД: {dup}.\n"
                "Потрібна ручна перевірка заявки адміністратором."
            )

        prompt = self._build_prompt(supplier_data, has_duplicates)
        last_error = None
        for model_name in (self.model_name, self.fallback_model):
            try:
                report = await self._complete(model_name, prompt)
                if report:
                    return report
            except Exception as e:
                last_error = e
                logger.warning("SupplierAnalyzer (%s): %s", model_name, e)
                if model_name == self.model_name and "429" in str(e):
                    continue

        logger.error("SupplierAnalyzer не зміг отримати звіт: %s", last_error)
        dup = "так" if has_duplicates else "ні"
        return (
            "AI-аналіз тимчасово недоступний.\n"
            f"Дублікати в БД: {dup}.\n"
            "Потрібна ручна перевірка заявки адміністратором."
        )
