# services/llm_service.py
"""
Універсальний LLM-сервіс на OpenAI SDK для NVIDIA Build (NIM).

Замінює платний Google Gemini. NVIDIA NIM надає стандартний
OpenAI-сумісний REST API:
    POST {base_url}/chat/completions  ->  {"choices":[{"message":{"content":"..."}}]}

Одина точка конфігурації моделі:
  * .env: NVIDIA_MODEL=...   (порожньо -> DEFAULT_MODEL)
  * .env: NVIDIA_BASE_URL=...                  (порожньо -> https://integrate.api.nvidia.com/v1)
  * .env: NVIDIA_API_KEY=nvapi-...

Для тестування інших моделей NVIDIA достатньо поміняти NVIDIA_MODEL у .env
(або передати model=... у конкретний виклик) — логіку бота змінювати не треба.
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI

from config_reader import config

logger = logging.getLogger(__name__)

# --- Модель за замовчуванням (ЄДИНЕ місце конфігурації — .env) ---------------
# Жодного хардкоду назв моделей у коді: DEFAULT_MODEL береться з .env
# (config.NVIDIA_MODEL). Якщо NVIDIA_MODEL порожній у .env — рядок порожній,
# і chat_completion кинуть LLMConfigError з підказкою налаштувати .env.
DEFAULT_MODEL: str = config.NVIDIA_MODEL

# --- Базовий URL NVIDIA NIM (OpenAI-сумісний ендпоінт) ---
DEFAULT_BASE_URL: str = "https://integrate.api.nvidia.com/v1"

# Таймаут одного запиту. 300с — архітектурна помилка для фонової черги:
# один виклик міг блокувати обробку на 15 хв (300с × 3 ретраї). Для
# оптимізованих NIM-моделей 120с достатньо; якщо NIM не відповів —
# LLMCapacityError → наші ретраї MAX_RETRIES (без SDK-ретраїв).
REQUEST_TIMEOUT_SECONDS: float = 120.0

# Кількість автоматичних ретраїв (429/5xx/мережеві збої)
MAX_RETRIES: int = 3

# Пауза між ретраями (секунди, лінійна)
RETRY_BASE_DELAY: float = 1.5


class LLMConfigError(RuntimeError):
    """NVIDIA API не сконфігуровано (немає NVIDIA_API_KEY у .env)."""


class LLMCapacityError(RuntimeError):
    """
    429 / 5xx — тимчасова перевантаженість NIM.
    Споживачам (черга товарів) — повернути елемент у pending, не падати.
    """

    def __init__(self, status: int, message: str = ""):
        super().__init__(message or f"NVIDIA LLM capacity error {status}")
        self.status = status


class LLMResponseError(RuntimeError):
    """Модель відповіла, але з порожнім/невалідним тілом."""

    def __init__(self, message: str, raw: str = ""):
        super().__init__(message)
        self.raw = raw


# --- Singleton-клієнт (лениво, щоб не фризити імпорт без ключа) ---------------

_client: Optional[AsyncOpenAI] = None


def get_nvidia_api_key() -> str:
    """Чистий NVIDIA-ключ з конфігу (без лапок/BOM/префіксів)."""
    return config.NVIDIA_API_KEY


def has_llm_keys() -> bool:
    """True — якщо NVIDIA_API_KEY налаштовано (аналог _has_gemini_keys)."""
    return bool(get_nvidia_api_key())


def get_client() -> AsyncOpenAI:
    """
    Асинхронний AsyncOpenAI-клієнт для NVIDIA NIM (singleton).
    Викликається ПІСЛЯ has_llm_keys(); інакше LLMConfigError.
    """
    global _client
    if _client is None:
        api_key = get_nvidia_api_key()
        if not api_key:
            raise LLMConfigError("NVIDIA_API_KEY не знайдено у .env")
        _client = AsyncOpenAI(
            base_url=config.NVIDIA_BASE_URL or DEFAULT_BASE_URL,
            api_key=api_key,
            timeout=REQUEST_TIMEOUT_SECONDS,
            max_retries=0,  # ретраї керуємо самі (LLMCapacityError -> pending)
        )
        logger.info(
            "LLM-сервіс: NVIDIA NIM клієнт готовий (base_url=%s, model=%s).",
            config.NVIDIA_BASE_URL or DEFAULT_BASE_URL,
            config.NVIDIA_MODEL or DEFAULT_MODEL,
        )
    return _client


# --- Парсинг JSON з відповіді -------------------------------------------------

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)
_JSON_GREEDY_RE = re.compile(r"(\{.*\}|\[.*\])", re.DOTALL)


def _hard_strip_markdown(text: str) -> str:
    """
    Жорстка очистка відповіді LLM від markdown-обгортки перед json.loads.

    Прибирає префікси ```json / ``` та суфікс ``` БЕЗ regex — тому працює
    навіть коли відповідь обрізана по max_tokens і закриваючої огорожі
    немає (llama-3.2-11b часто так відповідає):
        ```json
        {"is_product": true, "charact   ← обрізано, ``` немає
    """
    if not text:
        return ""
    cleaned = str(text).strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    if cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


def extract_json(text: str) -> Optional[Any]:
    """
    Витягує JSON з відповіді LLM (markdown-огорожки, «умствования» моделі).
    Повертає dict/list або None. Ніколи не кидає виключень.
    """
    if not text:
        return None
    # 0) Жорстке знімання ```json/``` префікса й ``` суфікса (обрізані
    #    відповіді llama без закриваючої огорожі — regex їх не бере).
    raw = _hard_strip_markdown(text)

    # 1) Markdown-огорожа ```json ... ```
    fence = _JSON_FENCE_RE.search(raw)
    if fence:
        parsed = _try_json_loads(fence.group(1).strip())
        if parsed is not None:
            return parsed

    # 2) «Жадібний» перший {..} або [..] у тексті
    greedy = _JSON_GREEDY_RE.search(raw)
    if greedy:
        parsed = _try_json_loads(greedy.group(1).strip())
        if parsed is not None:
            return parsed

    # 3) Рядок — уже чистий JSON?
    parsed = _try_json_loads(raw)
    if parsed is not None:
        return parsed

    # 4) Обхід усіх '{'/'[' — найперший валідний JSON-префікс
    decoder = json.JSONDecoder()
    for index, char in enumerate(raw):
        if char not in "{[":
            continue
        try:
            obj, _end = decoder.raw_decode(raw[index:])
            return obj
        except Exception:
            continue
    return None


def _try_json_loads(blob: str) -> Optional[Any]:
    try:
        return json.loads(blob)
    except Exception:
        return None


def clean_json_string(text: str) -> str:
    """
    Гарантований чистий JSON-РЯДОК з відповіді моделі:
    прибирає markdown-огорожі та текст до/після об'єкта.
    Якщо JSON не знайдено — повертає початковий текст (trim).
    Споживачі далі викликають extract_json() / json.loads().
    """
    if not text:
        return ""
    # 0) Жорстке знімання ```json/``` (обрізані відповіді llama без
    #    закриваючої огорожі — regex _JSON_FENCE_RE їх не матчить).
    raw = _hard_strip_markdown(text)
    fence = _JSON_FENCE_RE.search(raw)
    if fence:
        return fence.group(1).strip()
    greedy = _JSON_GREEDY_RE.search(raw)
    if greedy:
        return greedy.group(1).strip()
    return raw


# --- Класифікація помилок -----------------------------------------------------

def _status_from_exception(exc: BaseException) -> Optional[int]:
    """HTTP-код з openai.APIStatusError / будь-якого виключення."""
    raw = getattr(exc, "status_code", None)
    try:
        if raw is not None:
            return int(raw)
    except (TypeError, ValueError):
        pass
    code = getattr(exc, "code", None)
    try:
        if code is not None:
            return int(code)
    except (TypeError, ValueError):
        pass
    return None


def is_capacity_error(exc: BaseException) -> bool:
    """429 / 5xx / таймаут / мережа — тимчасова проблема, треба ретрай."""
    status = _status_from_exception(exc)
    if status in (429, 500, 502, 503, 504):
        return True
    if isinstance(exc, (TimeoutError, ConnectionError)):
        return True
    try:
        import openai
        if isinstance(exc, (openai.APITimeoutError, openai.APIConnectionError)):
            return True
    except ImportError:
        pass
    text = str(exc).lower()
    return any(word in text for word in ("timeout", "timed out", "connection", "capacity"))


def _should_retry(exc: BaseException) -> bool:
    status = _status_from_exception(exc)
    if status == 429 or (status is not None and 500 <= status < 600):
        return True
    try:
        import openai
        if isinstance(exc, (openai.APITimeoutError, openai.APIConnectionError)):
            return True
    except ImportError:
        pass
    if isinstance(exc, (TimeoutError, ConnectionError)):
        return True
    return False


# --- Основний виклик ----------------------------------------------------------

async def chat_completion(
    messages: List[Dict[str, str]],
    model: Optional[str] = None,
    temperature: float = 0.2,
    max_tokens: int = 4096,
    frequency_penalty: float = 0.0,
    presence_penalty: float = 0.0,
) -> str:
    """
    Базовий виклик chat/completions з ретраями на 429/5xx/таймаут.
    Повертає текст відповіді. Бросає LLMCapacityError, якщо NIM так і не відповів.

    frequency_penalty / presence_penalty — за замовчуванням 0 (нейтрально):
    жорсткі значення для боротьби з зацикленнями передає лише
    generate_json_response (парсинг товарів), не чат підтримки.
    """
    if not has_llm_keys():
        raise LLMConfigError("NVIDIA_API_KEY не знайдено у .env")

    target_model = (model or config.NVIDIA_MODEL or DEFAULT_MODEL).strip()
    if not target_model:
        raise LLMConfigError(
            "NVIDIA_MODEL порожній у .env — модель не обрано. "
            "Пропишіть NVIDIA_MODEL=... у .env (напр. з build.nvidia.com)."
        )
    client = get_client()

    last_exc: Optional[BaseException] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = await client.chat.completions.create(
                model=target_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                frequency_penalty=frequency_penalty,
                presence_penalty=presence_penalty,
            )
            # Стандартна структура OpenAI: choices[0].message.content
            choices = response.choices or []
            message = choices[0].message if choices else None
            text = str((message and message.content) or "").strip()
            if not text:
                raise LLMResponseError(
                    f"Модель {target_model} повернула порожню відповідь",
                    raw=str(response),
                )
            return text

        except LLMResponseError:
            # Порожня відповідь — не ретраїмо (модель відповіла, але порожньо)
            raise
        except Exception as exc:
            last_exc = exc
            if not _should_retry(exc):
                raise
            logger.warning(
                "NVIDIA LLM (%s): спроба %s/%s не вдалася: %s. Ретрай через %.1fs…",
                target_model, attempt, MAX_RETRIES, exc, RETRY_BASE_DELAY * attempt,
            )

    status = _status_from_exception(last_exc) or 503
    raise LLMCapacityError(status, f"NVIDIA LLM недоступний після {MAX_RETRIES} спроб: {last_exc}")


# --- Публічний API ------------------------------------------------------------

async def generate_json_response(
    prompt: str,
    system_prompt: str,
    model: Optional[str] = DEFAULT_MODEL,
    image_url: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 4096,
) -> str:
    """
    Структурована генерація: система + (опційно) зображення + промт
    -> чистий JSON-рядок (markdown-огорожі та зайвий текст прибрано).

    image_url: http(s)-посилання на фото (OpenAI content-part format
    [{"type": "image_url", "image_url": {"url": ...}}]). Для NVIDIA Vision-моделей.

    Анти-галюцинаційний режим: temperature=0.3 дає мінімальну гнучкість,
    frequency_penalty=0.5 жорстко обрізає повторення фраз (модель мала
    зациклюватись і дублювати одне речення десятки разів у JSON),
    presence_penalty=0.1 стимулює нові слова.
    """
    user_content: List[Dict[str, Any]] = []
    if image_url:
        user_content.append({"type": "image_url", "image_url": {"url": image_url}})
    user_content.append({"type": "text", "text": prompt})

    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    raw = await chat_completion(
        messages=messages,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        # Анти-зациклення: жорсткі пенальті лише для JSON-парсингу товарів.
        frequency_penalty=0.5,
        presence_penalty=0.1,
    )
    return clean_json_string(raw)


async def generate_chat_response(
    messages: List[Dict[str, str]],
    model: Optional[str] = DEFAULT_MODEL,
    system_prompt: Optional[str] = None,
    temperature: float = 0.4,
    max_tokens: int = 800,
) -> str:
    """
    Відкрита діалогова генерація (служба підтримки).

    messages — уже стандартний OpenAI-масив:
        [{"role": "user"|"assistant", "content": "..."}]
    system_prompt (опційно) — підставляється першим повідомленням.
    """
    normalized: List[Dict[str, str]] = []
    if system_prompt:
        normalized.append({"role": "system", "content": system_prompt})
    for msg in (messages or []):
        role = str(msg.get("role") or "user").strip().lower()
        if role not in ("user", "assistant"):
            role = "user"
        content = str(msg.get("content") or "").strip()
        if not content:
            continue
        normalized.append({"role": role, "content": content})

    if not any(m["role"] == "user" for m in normalized):
        raise LLMResponseError("Порожня історія: немає жодного user-повідомлення")

    return await chat_completion(
        messages=normalized,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
    )
