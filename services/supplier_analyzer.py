# services/supplier_analyzer.py
"""AI-модерація заявок постачальників (Gemini REST). Не чіпає логіку товарів."""
import asyncio
import logging
from typing import Any, Dict, Optional

import aiohttp

from config_reader import config

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-3.6-flash"
GEMINI_FALLBACK_MODEL = "gemini-3.6-flash"

BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)


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
        headers = {
            "Content-Type": "application/json",
            "User-Agent": BROWSER_USER_AGENT,
        }
        async with aiohttp.ClientSession(headers={"User-Agent": BROWSER_USER_AGENT}) as session:
            async with session.post(api_url, headers=headers, json=payload) as resp:
                if resp.status == 429:
                    raise Exception("429 Rate Limit")
                if resp.status == 503:
                    raise Exception("503 High Demand")
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Gemini API Error {resp.status}: {error_text}")
                data = await resp.json()
        try:
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except (KeyError, IndexError, TypeError):
            raise Exception(f"Gemini повернув неочікувану відповідь: {data}")

    async def analyze_supplier(self, supplier_data: dict, has_duplicates: bool) -> str:
        """Повертає текстовий звіт. 503 — до 3 спроб з паузою 5с."""
        if not self.is_ready:
            dup = "так" if has_duplicates else "ні"
            return (
                "AI-аналіз пропущено (немає GEMINI_API_KEY).\n"
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
