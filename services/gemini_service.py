# services/gemini_service.py
import asyncio
import re
import logging
import json
from config_reader import config
from services.gemini_key_manager import AllKeysExhaustedError, get_key_manager, build_genai_client
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

try:
    from google import genai
    from google.genai import types
    from google.genai import errors as genai_errors
except ImportError:
    genai = None  # type: ignore
    types = None  # type: ignore
    genai_errors = None  # type: ignore
    logger.warning("google-genai не встановлено в цьому Python. AI-сервіси буде пропущено.")

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)
_GEMINI_JSON_RE = re.compile(r"(\{.*\}|\[.*\])", re.DOTALL)
DEFAULT_GEMINI_MODEL = "gemini-1.5-flash-latest"


def extract_gemini_json(text: str):
    """
    Вирізає JSON з відповіді Gemini (thought_signature, markdown, зайвий текст).
    Повертає dict/list або None. json.loads ніколи не кидає назовні.
    """
    if not text:
        return None
    raw = str(text).strip()
    match = _GEMINI_JSON_RE.search(raw)
    if match:
        candidate = match.group(1).strip()
    else:
        candidate = raw
        lowered = candidate.lstrip()
        for prefix in ("```json", "```JSON", "```"):
            if lowered.startswith(prefix):
                candidate = lowered[len(prefix):].strip()
                break
        if candidate.endswith("```"):
            candidate = candidate[:-3].strip()

    parsed = _try_json_loads(candidate)
    if parsed is not None:
        return parsed

    decoder = json.JSONDecoder()
    for src in (candidate, raw):
        for index, char in enumerate(src):
            if char not in "{[":
                continue
            try:
                obj, _end = decoder.raw_decode(src[index:])
                return obj
            except Exception:
                continue
    return None


def _try_json_loads(blob: str):
    try:
        return json.loads(blob)
    except Exception:
        return None


def _safe_json_loads(text: str) -> Optional[Dict[str, Any]]:
    """
    Акуратно дістає JSON-об'єкт з відповіді Gemini.
    """
    parsed = extract_gemini_json(text)
    if isinstance(parsed, dict):
        return parsed
    return None


def _is_quota_error(exc: Exception) -> bool:
    """429 RESOURCE_EXHAUSTED — квота ключа, треба ротація."""
    code = getattr(exc, "code", None)
    client_error = getattr(genai_errors, "ClientError", None) if genai_errors else None
    api_error = getattr(genai_errors, "APIError", None) if genai_errors else None
    if code == 429:
        return True
    if client_error and isinstance(exc, client_error) and code == 429:
        return True
    if api_error and isinstance(exc, api_error) and code == 429:
        return True
    msg = str(exc).upper()
    status_name = str(getattr(exc, "status", "") or "").upper()
    combined = f"{msg} {status_name}"
    return "429" in str(exc) or "RESOURCE_EXHAUSTED" in combined or "QUOTA" in combined


def _is_capacity_error(exc: Exception) -> bool:
    """429 / 503 — ліміт або тимчасова недоступність Gemini."""
    if _is_quota_error(exc):
        return True
    code = getattr(exc, "code", None)
    if code == 503:
        return True
    msg = str(exc)
    return "503" in msg or "UNAVAILABLE" in msg.upper()


def _has_gemini_keys() -> bool:
    return bool(getattr(config, "GEMINI_API_KEYS", None))


async def _aclose_genai_client(client) -> None:
    """Закриває внутрішню HTTP-сесію google-genai (aiohttp/httpx), щоб не було Unclosed client session."""
    if client is None:
        return
    try:
        aio = getattr(client, "aio", None)
        aclose = getattr(aio, "aclose", None) if aio is not None else None
        if callable(aclose):
            result = aclose()
            if asyncio.iscoroutine(result):
                await result
            return
        close = getattr(client, "close", None)
        if callable(close):
            close()
    except Exception:
        pass


def get_gemini_client():
    """google.genai.Client на поточному активному ключі. None, якщо ключів немає."""
    if genai is None:
        return None
    manager = get_key_manager()
    if not manager.has_keys():
        return None
    try:
        api_key = manager.get_next_active_key()
    except AllKeysExhaustedError:
        logger.warning("Усі Gemini API ключі тимчасово вичерпані.")
        return None
    return build_genai_client(api_key)


async def _generate_content(
    prompt: str,
    *,
    system_instruction: Optional[str] = None,
    temperature: float = 0.7,
    max_output_tokens: Optional[int] = None,
    response_mime_type: Optional[str] = None,
    model_name: str = DEFAULT_GEMINI_MODEL,
) -> str:
    if genai is None or types is None:
        raise RuntimeError("Gemini client is not configured")
    manager = get_key_manager()
    if not manager.has_keys():
        raise RuntimeError("Gemini client is not configured")

    cfg_kwargs: Dict[str, Any] = {"temperature": temperature}
    if system_instruction:
        cfg_kwargs["system_instruction"] = system_instruction
    if max_output_tokens is not None:
        cfg_kwargs["max_output_tokens"] = max_output_tokens
    if response_mime_type:
        cfg_kwargs["response_mime_type"] = response_mime_type

    last_error: Optional[Exception] = None
    for _ in range(max(1, manager.key_count)):
        try:
            api_key = manager.get_next_active_key()
        except AllKeysExhaustedError as e:
            raise RuntimeError(str(e)) from e
        client = build_genai_client(api_key)
        try:
            response = await client.aio.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(**cfg_kwargs),
            )
            return (response.text or "").strip()
        except Exception as e:
            if _is_quota_error(e):
                manager.mark_key_exhausted(api_key)
                last_error = e
                logger.warning(
                    "Gemini 429 на ключі ...%s — переходжу на наступний.",
                    api_key[-4:],
                )
                continue
            raise
        finally:
            await _aclose_genai_client(client)
    raise last_error or AllKeysExhaustedError("Усі Gemini API ключі вичерпані.")


# Налаштовуємо Gemini API (без витрати ключа з черги)
try:
    if genai is not None and get_key_manager().has_keys():
        logger.info(
            "Google Gemini API сконфігуровано (%s ключ(ів)).",
            get_key_manager().key_count,
        )
    else:
        logger.warning("GEMINI_API_KEYS не знайдено. AI-сервіси буде пропущено.")
except Exception as e:
    logger.error(f"Помилка конфігурації Gemini: {e}")


async def rewrite_text_with_ai(text_to_rewrite: str, product_name: str) -> str:
    """
    Асинхронно переписує опис товару (для автопостингу).
    """
    if not _has_gemini_keys():
        logger.warning("Рерайтинг пропущено (немає API key).")
        return text_to_rewrite

    try:
        prompt = f"Назва товару: '{product_name}'. Оригінальний опис для рерайту:\n---\n{text_to_rewrite}"
        rewritten_text = await _generate_content(
            prompt,
            system_instruction=(
                "ТИ ПРОФЕСІЙНИЙ КОПІРАЙТЕР преміум-маркетплейсу. "
                "Твоє завдання — повністю переписати текст. Зроби його унікальним, емоційним та продаючим. "
                "ЖОДНИХ слідів оригінального постачальника. Жодного опту, дропу, посилань чи розмірів у цьому полі. "
                "СТРУКТУРА: "
                "Короткий вступ. "
                "Потім список переваг. Кожен пункт списку ПОВИНЕН починатися з нового рядка (\\n) "
                "і тематичного емодзі (✅, 🛡️, 💧, 🧵 тощо). "
                "Поверни суворо відформатований рядок із \\n. "
                "НЕ додавай ціну, артикул, посилання або заклики до дії."
            ),
            temperature=0.7,
            max_output_tokens=4096,
        )
        
        logger.info(f"✅ Gemini успішно переписав текст для '{product_name}'")
        return rewritten_text
        
    except Exception as e:
        if _is_capacity_error(e):
            logger.error(f"❌ Gemini 429/503 під час rewrite: {e}")
        else:
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
    if not _has_gemini_keys():
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
        text = await _generate_content(
            raw_text,
            system_instruction=system_prompt,
            temperature=0.0,
            response_mime_type="application/json",
        )
        
        # Витягуємо чистий JSON
        json_data = _safe_json_loads(text)
        if not isinstance(json_data, dict):
            logger.warning(f"Gemini повернув невалідний JSON (extract). Raw: {text[:500]}")
            return None

        logger.info(f"✅ Gemini успішно витягнув атрибути: {json_data}")
        return json_data
        
    except Exception as e:
        if _is_capacity_error(e):
            logger.error(f"❌ Gemini 429/503 під час extract: {e}")
        else:
            logger.error(f"❌ Помилка під час запиту до Gemini API (extract): {e}", exc_info=True)
        return None

async def classify_main_category_with_ai(texts: List[str]) -> Optional[str]:
    """
    Визначає головну категорію магазину/потоку товарів.
    Повертає коротку категорію (наприклад: "Одяг", "Електроніка", "Взуття", "Тактичне спорядження", "Дім і сад").
    """
    if not _has_gemini_keys():
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
        text = await _generate_content(
            joined,
            system_instruction=system_prompt,
            temperature=0.0,
            response_mime_type="application/json",
        )
        data = _safe_json_loads(text)
        if not isinstance(data, dict):
            return "General"

        category = (data.get("category") or "General").strip()
        if not category:
            return "General"

        logger.info(f"✅ Gemini категоризував потік як: {category}")
        return category

    except Exception as e:
        if _is_capacity_error(e):
            logger.error(f"❌ Gemini 429/503 під час classify: {e}")
        else:
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
