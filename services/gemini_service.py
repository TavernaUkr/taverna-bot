# services/gemini_service.py
import asyncio
import re
import logging
import google.generativeai as genai
import json
from config_reader import config
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)

def _safe_json_loads(text: str) -> Optional[Dict[str, Any]]:
    """
    Акуратно дістає JSON з відповіді Gemini:
    - прибирає ```json ... ```
    - пробує знайти перший {...} блок
    """
    if not text:
        return None

    raw = text.strip()

    # 1) Якщо модель повернула fenced block ```json ... ```
    m = _JSON_FENCE_RE.search(raw)
    if m:
        raw = m.group(1).strip()

    # 2) Якщо далі все одно є зайвий текст — пробуємо вирізати перший {...}
    # (простий, але практичний підхід)
    first_brace = raw.find("{")
    last_brace = raw.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        candidate = raw[first_brace:last_brace + 1].strip()
    else:
        candidate = raw

    try:
        return json.loads(candidate)
    except Exception:
        return None

# Налаштовуємо Gemini API
try:
    if config.gemini_api_key:
        genai.configure(api_key=config.gemini_api_key.get_secret_value())
        logger.info("Google Gemini API сконфігуровано.")
    else:
        logger.warning("GEMINI_API_KEY не знайдено. AI-сервіси буде пропущено.")
except Exception as e:
    logger.error(f"Помилка конфігурації Gemini: {e}")

async def rewrite_text_with_ai(text_to_rewrite: str, product_name: str) -> str:
    """
    Асинхронно переписує опис товару (для автопостингу).
    """
    if not config.gemini_api_key:
        logger.warning("Рерайтинг пропущено (немає API key).")
        return text_to_rewrite

    try:
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash-latest",
            system_instruction=(
                "Ти – професійний копірайтер для Телеграм-магазину 'TAVERNA'. "
                "Твоє завдання – переписати опис товару. Стиль: впевнений, професійний, з акцентом на якість. "
                "Структуруй текст, використовуй марковані списки (▪️ або ✅). "
                "Використовуй доречні емодзі (🛡️, 💪, 🔥). "
                "НЕ додавай ціну, артикул, посилання або заклики до дії. Тільки опис."
            )
        )
        
        prompt = f"Назва товару: '{product_name}'. Оригінальний опис для рерайту:\n---\n{text_to_rewrite}"
        
        response = await model.generate_content_async(
            prompt,
            generation_config=genai.types.GenerationConfig(temperature=0.7, max_output_tokens=4096)
        )
        
        rewritten_text = response.text.strip()
        logger.info(f"✅ Gemini успішно переписав текст для '{product_name}'")
        return rewritten_text
        
    except Exception as e:
        logger.error(f"❌ Помилка під час запиту до Gemini API (rewrite): {e}", exc_info=True)
        return text_to_rewrite

# ---
# [НОВА ФУНКЦІЯ - ФАЗА 3.4] (Твій "Глобальний План 13 + 17")
# ---
async def extract_product_attributes_with_ai(
    raw_text: str, 
    category_hint: str
) -> Optional[Dict[str, Any]]:
    """
    "AI-Класифікатор". Витягує структуровані дані (атрибути та опції)
    з хаотичного тексту поста постачальника (URL/Telegram).
    """
    if not config.gemini_api_key:
        logger.warning("Видобування атрибутів пропущено (немає API key).")
        return None

    # Це "мозок" нашого гнучкого парсера.
    # Ми даємо Gemini роль і просимо повернути *лише* JSON.
    system_prompt = f"""
Ти - AI-асистент для E-commerce платформи TavernaGroup.
Твоє завдання - аналізувати текст опису товару від постачальника і витягувати з нього *лише* структуровані дані у форматі JSON.
Категорія цього товару: "{category_hint}".

Правила JSON:
1.  `name`: Очищена назва товару (без ціни, розмірів, кольорів).
2.  `attributes`: Об'єкт з фільтрами (Бренд, Матеріал, Рік, Країна, Діагональ...).
3.  `options`: Масив опцій, які впливають на ціну/SKU (Колір, Розмір, Вага, Пам'ять...).
4.  `base_price`: Дроп-ціна, знайдена в тексті (тільки число).

Якщо ти не можеш знайти дані, повертай null.
Повертай *ТІЛЬКИ* JSON, без жодного іншого тексту.

Приклад 1 (Одяг):
Вхід: "Тактична сорочка (убакс) мультикам. Розміри S, M, L. Матеріал: Ріп-стоп. Ціна 900 грн."
Вихід:
{{
  "name": "Тактична сорочка (убакс)",
  "attributes": {{ "Матеріал": "Ріп-стоп" }},
  "options": [
    {{ "name": "Колір", "values": ["мультикам"] }},
    {{ "name": "Розмір", "values": ["S", "M", "L"] }}
  ],
  "base_price": 900
}}

Приклад 2 (Електроніка):
Вхід: "Новий iPhone 15 Pro, 256GB, колір Natural Titanium. В наявності! Ціна 45000 UAH."
Вихід:
{{
  "name": "iPhone 15 Pro",
  "attributes": {{ "Бренд": "Apple", "Модель": "iPhone 15 Pro" }},
  "options": [
    {{ "name": "Пам'ять", "values": ["256GB"] }},
    {{ "name": "Колір", "values": ["Natural Titanium"] }}
  ],
  "base_price": 45000
}}

Приклад 3 (Кава):
Вхід: "Кава 'Арабіка Бразилія'. Вага: 250г або 1кг. Помел: під турку, під еспресо. 250г = 300 грн, 1кг = 1000 грн."
Вихід:
{{
  "name": "Кава 'Арабіка Бразилія'",
  "attributes": {{ "Країна": "Бразилія", "Тип": "Арабіка" }},
  "options": [
    {{ "name": "Вага", "values": ["250г", "1кг"] }},
    {{ "name": "Помел", "values": ["під турку", "під еспресо"] }}
  ],
  "base_price": 300
}}
"""
    
    try:
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash-latest",
            system_instruction=system_prompt,
            generation_config=genai.types.GenerationConfig(
                response_mime_type="application/json", # Просимо Gemini *гарантувати* JSON
                temperature=0.0 # Нам потрібна точність, а не креативність
            )
        )
        
        response = await model.generate_content_async(raw_text)
        
        # Витягуємо чистий JSON
        json_data = _safe_json_loads(response.text)
        if not isinstance(json_data, dict):
            logger.warning(f"Gemini повернув невалідний JSON (extract). Raw: {response.text[:500]}")
            return None

        logger.info(f"✅ Gemini успішно витягнув атрибути: {json_data}")
        return json_data
        
    except Exception as e:
        logger.error(f"❌ Помилка під час запиту до Gemini API (extract): {e}", exc_info=True)
        return None

async def classify_main_category_with_ai(texts: List[str]) -> Optional[str]:
    """
    Визначає головну категорію магазину/потоку товарів.
    Повертає коротку категорію (наприклад: "Одяг", "Електроніка", "Взуття", "Тактичне спорядження", "Дім і сад").
    """
    if not config.gemini_api_key:
        logger.warning("Категоризацію пропущено (немає API key).")
        return None

    # Мінімізуємо токени/шум
    joined = " ".join([t.strip() for t in texts if t and t.strip()])
    joined = joined[:15000]

    system_prompt = """
Ти - AI-категоризатор для E-commerce платформи TavernaGroup.
Твоє завдання - визначити ГОЛОВНУ категорію магазину за прикладами описів товарів.
Поверни ТІЛЬКИ JSON у форматі:
{ "category": "..." }

Правила:
- category: коротка назва українською (1-4 слова), без зайвих пояснень.
- Якщо не впевнений — поверни "General".
"""

    try:
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash-latest",
            system_instruction=system_prompt,
            generation_config=genai.types.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.0
            )
        )

        response = await model.generate_content_async(joined)
        data = _safe_json_loads(response.text)
        if not isinstance(data, dict):
            return "General"

        category = (data.get("category") or "General").strip()
        if not category:
            return "General"

        logger.info(f"✅ Gemini категоризував потік як: {category}")
        return category

    except Exception as e:
        logger.error(f"❌ Помилка під час запиту до Gemini API (classify): {e}", exc_info=True)
        return None

async def batch_extract_product_attributes_with_ai(
    items: List[Dict[str, Any]],
    *,
    default_category_hint: str = "unknown",
    max_concurrency: int = 3,
    retries: int = 2,
    truncate_chars: int = 15000
) -> List[Optional[Dict[str, Any]]]:
    """
    Батч-обробка описів:
    items: [{ "raw_text": "...", "category_hint": "..." }, ...]
    Повертає список результатів (dict або None) у тому ж порядку.
    """

    if not items:
        return []

    sem = asyncio.Semaphore(max(1, int(max_concurrency)))
    results: List[Optional[Dict[str, Any]]] = [None] * len(items)

    async def _one(i: int):
        raw_text = (items[i].get("raw_text") or "").strip()
        category_hint = (items[i].get("category_hint") or default_category_hint).strip()

        if not raw_text:
            results[i] = None
            return

        raw_text_cut = raw_text[:truncate_chars]

        # Ретраї з невеликим backoff
        for attempt in range(retries + 1):
            try:
                async with sem:
                    data = await extract_product_attributes_with_ai(raw_text_cut, category_hint)
                results[i] = data
                return
            except Exception as e:
                if attempt >= retries:
                    logger.error(f"Batch extract: item#{i} failed окончательно: {e}", exc_info=True)
                    results[i] = None
                    return
                await asyncio.sleep(0.6 * (attempt + 1))

    await asyncio.gather(*[_one(i) for i in range(len(items))])
    return results
