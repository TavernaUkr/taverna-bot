# services/ai_processor.py
"""
PIM (Product Information Management) через google.genai SDK:
жорстка таксономія main_category / target_niche + динамічні атрибути + SEO-опис.
"""
import asyncio
import json
import logging
import re
from typing import Any, Dict, Optional

try:
    from google import genai
    from google.genai import types
    from google.genai import errors as genai_errors
except ImportError:
    genai = None  # type: ignore
    types = None  # type: ignore
    genai_errors = None  # type: ignore

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config_reader import config
from database.models import AICategorizationRule, Product, ProductAIStatus
from services.gemini_key_manager import AllKeysExhaustedError, get_key_manager

logger = logging.getLogger(__name__)

def _gemini_http_status(exc: Exception) -> Optional[int]:
    """Дістає HTTP-код з google.genai.errors.ClientError / APIError."""
    for attr in ("code", "status_code"):
        raw = getattr(exc, attr, None)
        try:
            if raw is None:
                continue
            value = int(raw)
            if value:
                return value
        except (TypeError, ValueError):
            continue
    msg = str(exc)
    status_name = str(getattr(exc, "status", "") or "")
    combined = f"{msg} {status_name}".upper()
    if "429" in msg or "RESOURCE_EXHAUSTED" in combined or "QUOTA" in combined:
        return 429
    if "CLIENTCONNECTORDNSERROR" in combined:
        return 429
    if "503" in msg or "UNAVAILABLE" in combined:
        return 503
    return None


def _exception_text(exc: BaseException) -> str:
    parts = [str(exc), repr(exc), type(exc).__name__]
    nested = getattr(exc, "__cause__", None) or getattr(exc, "__context__", None)
    if isinstance(nested, BaseException):
        parts.extend([str(nested), type(nested).__name__])
    return " ".join(parts)


def _is_sdk_quota_crash(exc: BaseException) -> bool:
    """
    google-genai може впасти AttributeError (ClientConnectorDNSError)
    замість errors.ClientError 429 — тоді товар не має йти в failed.
    """
    error_str = _exception_text(exc)
    return (
        "ClientConnectorDNSError" in error_str
        or "429" in error_str
        or "503" in error_str
    )


class GeminiCapacityError(Exception):
    """Gemini 429 / 503 — товар треба повернути в чергу, не падати."""

    def __init__(self, status: int, message: str = ""):
        super().__init__(message or f"Gemini capacity error {status}")
        self.status = status

GEMINI_MODEL = "gemini-2.0-flash"
GEMINI_FALLBACK_MODEL = "gemini-1.5-flash-latest"

_HTML_RE = re.compile(r"<[^>]+>")
_NUMERIC_RE = re.compile(r"^\d+$")

PRIMARY_CATEGORIES = (
    "Одяг",
    "Взуття",
    "Аксесуари",
    "Тактичне спорядження",
    "Рюкзаки та сумки",
    "Головні убори",
    "Електроніка",
    "Дім та побут",
    "Автотовари",
    "Дитячі товари",
    "Краса та здоров'я",
    "Інше",
)

TARGET_NICHES = (
    "Мілітарі",
    "Повсякденний",
    "Спорт",
    "Риболовля та Полювання",
    "Туризм",
    "Домашній",
    "Професійний",
    "Свято",
)

GENDERS = (
    "Чоловічий",
    "Жіночий",
    "Унісекс",
    "Дитячий",
    "Не застосовується",
)

SEASONS = ("Зима", "Літо", "Демісезон", "Всесезон")

_PRIMARY_ALIASES = {
    "одяг": "Одяг",
    "куртки": "Одяг",
    "халат": "Одяг",
    "халати": "Одяг",
    "взуття": "Взуття",
    "берці": "Взуття",
    "кросівки": "Взуття",
    "аксесуари": "Аксесуари",
    "тактичне спорядження": "Тактичне спорядження",
    "спорядження": "Тактичне спорядження",
    "рюкзаки та сумки": "Рюкзаки та сумки",
    "сумки та рюкзаки": "Рюкзаки та сумки",
    "головні убори": "Головні убори",
    "електроніка": "Електроніка",
    "дім та побут": "Дім та побут",
    "товари для дому": "Дім та побут",
    "автотовари": "Автотовари",
    "дитячі товари": "Дитячі товари",
    "краса та здоров'я": "Краса та здоров'я",
    "інше": "Інше",
}

_NICHE_ALIASES = {
    "мілітарі": "Мілітарі",
    "повсякденний": "Повсякденний",
    "спорт": "Спорт",
    "риболовля та полювання": "Риболовля та Полювання",
    "рибалка/полювання": "Риболовля та Полювання",
    "рибалка": "Риболовля та Полювання",
    "туризм": "Туризм",
    "домашній": "Домашній",
    "дім": "Домашній",
    "професійний": "Професійний",
    "свято": "Свято",
}

_GENDER_ALIASES = {
    "чоловічий": "Чоловічий",
    "мужской": "Чоловічий",
    "жіночий": "Жіночий",
    "женский": "Жіночий",
    "унісекс": "Унісекс",
    "унисекс": "Унісекс",
    "unisex": "Унісекс",
    "дитячий": "Дитячий",
    "детский": "Дитячий",
    "не застосовується": "Не застосовується",
    "n/a": "Не застосовується",
}

_SEASON_ALIASES = {
    "зима": "Зима",
    "зимовий": "Зима",
    "літо": "Літо",
    "літній": "Літо",
    "лето": "Літо",
    "демісезон": "Демісезон",
    "демі": "Демісезон",
    "весна": "Демісезон",
    "осінь": "Демісезон",
    "всесезон": "Всесезон",
    "всесезонний": "Всесезон",
    "на всі сезони": "Всесезон",
    "універсальний": "Всесезон",
}

_EMPTY_VALUES = {"", "null", "none", "n/a", "nil", "-"}

_SYSTEM_PROMPT = """
Ти — Senior Category Manager маркетплейсу «TAVERNA».
Твоє завдання: класифікувати товар за ЖОРСТКОЮ таксономією і написати продаючий опис.
Працюєш українською. Поверни виключно один JSON-об'єкт.
Жодного тексту до або після JSON. Без markdown. Без коментарів. Без HTML.

Формат:
{"name":"...","target_niche":"...","main_category":"...","sub_category":"...","season":null,"gender":null,"attributes":{"Ключ":"Значення"},"description":"..."}

ТИ МАЄШ ПРАВО ОБИРАТИ `main_category` ВИКЛЮЧНО З ЦЬОГО СПИСКУ (без відхилень):
['Одяг', 'Взуття', 'Аксесуари', 'Тактичне спорядження', 'Рюкзаки та сумки', 'Головні убори', 'Електроніка', 'Дім та побут', 'Автотовари', 'Дитячі товари', 'Краса та здоров'я', 'Інше'].

ТИ МАЄШ ПРАВО ОБИРАТИ `target_niche` ВИКЛЮЧНО З ЦЬОГО СПИСКУ:
['Мілітарі', 'Повсякденний', 'Спорт', 'Риболовля та Полювання', 'Туризм', 'Домашній', 'Професійний', 'Свято'].

Правила ієрархії:
- Якщо це куртка чи халат — main_category = "Одяг".
- Якщо це берці, кросівки, черевики — main_category = "Взуття".
- Якщо це баф, балаклава, шапка — main_category = "Головні убори".
- Якщо це рюкзак, сумка, бананка — main_category = "Рюкзаки та сумки".
- НЕ став вузький тип у main_category. "Куртки", "Халати", "Смартфони" — це sub_category.
- sub_category генеруй самостійно (наприклад: "Зимові куртки", "Махрові халати", "Смартфони").

Інші поля:
- name: чиста комерційна назва українською, до 80 символів. Без артикулів, цін, HTML.
- season: "Зима", "Літо", "Демісезон", "Всесезон" або null, якщо сезон не логічний.
- gender: "Чоловічий", "Жіночий", "Унісекс", "Дитячий" або null, якщо стать не застосовується.
- attributes: динамічний JSON 3–8 характеристик саме для цього типу товару.
  Факти лише з вхідних даних, не вигадуй.
- description: якісний SEO-текст українською, 400–900 символів, з релевантними емодзі.
  Структура: суть, «Переваги», «Характеристики». Без HTML і без цін.
"""


def _strip_html(text: Optional[str]) -> str:
    if not text:
        return ""
    cleaned = _HTML_RE.sub(" ", str(text))
    return re.sub(r"\s+", " ", cleaned).strip()


def _safe_json_loads(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None

    cleaned_content = text.replace("```json", "").replace("```", "").strip()
    start_idx = cleaned_content.find("{")
    end_idx = cleaned_content.rfind("}")
    if start_idx != -1 and end_idx != -1:
        cleaned_content = cleaned_content[start_idx:end_idx + 1]

    try:
        data = json.loads(cleaned_content)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _build_rules_text(rules: list) -> str:
    if not rules:
        return ""
    lines = [
        f"- Якщо текст містить '{rule.keyword}', обов'язково використовуй категорію '{rule.correct_category}'."
        for rule in rules
    ]
    return "ВАЖЛИВІ ПРАВИЛА КАТЕГОРИЗАЦІЇ:\n" + "\n".join(lines)


async def load_ai_categorization_rules_text(db: AsyncSession) -> str:
    """Текстовий блок словника правил для промта Gemini. Порожній рядок, якщо правил немає."""
    try:
        rows = (
            await db.execute(
                select(AICategorizationRule).order_by(AICategorizationRule.id.asc())
            )
        ).scalars().all()
    except Exception as e:
        logger.warning("Не вдалося прочитати AI-правила категоризації: %s", e)
        return ""
    return _build_rules_text(rows)


def _clip(value: str, max_len: int) -> str:
    value = (value or "").strip()
    if len(value) <= max_len:
        return value
    return value[: max_len - 1].rstrip() + "…"


def _is_empty(raw: Any) -> bool:
    if raw is None:
        return True
    return str(raw).strip().lower() in _EMPTY_VALUES


def _normalize_enum(
    raw: Any,
    allowed: tuple,
    aliases: Dict[str, str],
    default: Optional[str] = None,
) -> Optional[str]:
    if _is_empty(raw):
        return default
    value = str(raw).strip()
    if _NUMERIC_RE.match(value):
        return default
    if value in allowed:
        return value
    return aliases.get(value.lower(), default)


def _normalize_attributes(raw: Any) -> Dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    cleaned: Dict[str, str] = {}
    for key, value in raw.items():
        name = _clip(str(key), 80)
        if not name or _is_empty(value):
            continue
        if isinstance(value, (dict, list)):
            text = _clip(json.dumps(value, ensure_ascii=False), 200)
        else:
            text = _clip(str(value), 200)
        if text:
            cleaned[name] = text
        if len(cleaned) >= 12:
            break
    return cleaned


def _product_text(*parts: Optional[str]) -> str:
    return " ".join(p for p in parts if p).lower()


def _apply_hard_rules(fields: Dict[str, Any], source_text: str) -> Dict[str, Any]:
    """Раніше тут були жорсткі мілітарі-оверрайди. Omni-PIM їх не використовує."""
    return fields


def _normalize_open_label(
    raw: Any,
    allowed: tuple,
    aliases: Dict[str, str],
    max_len: int = 100,
) -> Optional[str]:
    """Знайомі значення нормалізує, нові ніші/категорії від моделі приймає як є."""
    known = _normalize_enum(raw, allowed, aliases)
    if known:
        return known
    if _is_empty(raw):
        return None
    value = str(raw).strip()
    if _NUMERIC_RE.match(value):
        return None
    return _clip(value, max_len)


def _extract_ai_fields(data: Dict[str, Any], source_text: str) -> Optional[Dict[str, Any]]:
    name = _clip(str(data.get("name") or ""), 512)
    main_category = _normalize_enum(
        data.get("main_category") or data.get("primary_category") or data.get("category"),
        PRIMARY_CATEGORIES,
        _PRIMARY_ALIASES,
    )
    target_niche = _normalize_enum(
        data.get("target_niche"),
        TARGET_NICHES,
        _NICHE_ALIASES,
    )
    sub_category = _clip(str(data.get("sub_category") or ""), 150)
    season = _normalize_enum(data.get("season"), SEASONS, _SEASON_ALIASES)
    gender = _normalize_enum(data.get("gender"), GENDERS, _GENDER_ALIASES)
    attributes = _normalize_attributes(data.get("attributes"))
    description = _strip_html(str(data.get("description") or ""))

    fields = {
        "name": name,
        "main_category": main_category,
        "target_niche": target_niche,
        "sub_category": sub_category,
        "season": season,
        "gender": gender,
        "attributes": attributes,
        "description": description,
    }
    fields = _apply_hard_rules(fields, source_text)

    if not fields["name"] or not fields["main_category"] or not fields["sub_category"]:
        return None
    if not fields["target_niche"] or not fields["description"]:
        return None
    return fields


class ProductAIProcessor:
    """Бере сирий Product з БД, питає Gemini, оновлює поля в сесії (без commit)."""

    def __init__(self, api_key: Optional[str] = None):
        if api_key and str(api_key).strip():
            from services.gemini_key_manager import GeminiKeyManager
            self._key_manager = GeminiKeyManager(
                [str(api_key).strip(), *list(config.GEMINI_API_KEYS)]
            )
        else:
            self._key_manager = get_key_manager()
        self.model_name = "gemini-3.6-flash"
        self.fallback_model = "gemini-3.6-flash"

        if genai is None:
            logger.warning("google-genai не встановлено. AI-обробку товарів буде пропущено.")
            return
        if not self._key_manager.has_keys():
            logger.warning("GEMINI_API_KEYS не знайдено. AI-обробку товарів буде пропущено.")
            return

        logger.info(
            "ProductAIProcessor: Gemini готовий (%s), ключів: %s.",
            self.model_name,
            self._key_manager.key_count,
        )

    @property
    def is_ready(self) -> bool:
        return bool(genai is not None and self._key_manager and self._key_manager.has_keys())

    def _build_user_prompt(self, product: Product) -> str:
        raw_name = (product.name or "").strip()
        raw_category = (product.category or "").strip()
        raw_sub = (getattr(product, "sub_category", None) or "").strip()
        raw_season = (getattr(product, "season", None) or "").strip()
        raw_description = _strip_html(product.description)[:4000]
        sku = (product.supplier_sku or "").strip()

        return (
            f"Назва: {raw_name}\n"
            f"Артикул: {sku}\n"
            f"Сира категорія (від постачальника): {raw_category or 'немає'}\n"
            f"Сира підкатегорія: {raw_sub or 'немає'}\n"
            f"Сирий сезон: {raw_season or 'немає'}\n"
            f"Опис:\n{raw_description or 'немає'}\n\n"
            f"main_category обирай ТІЛЬКИ з: {', '.join(PRIMARY_CATEGORIES)}\n"
            f"target_niche обирай ТІЛЬКИ з: {', '.join(TARGET_NICHES)}\n"
            "sub_category — вузький тип (Зимові куртки, Махрові халати, Смартфони).\n"
            f"season: {', '.join(SEASONS)} або null, якщо сезон не застосовується.\n"
            "gender: Чоловічий / Жіночий / Унісекс / Дитячий або null, "
            "якщо стать не застосовується.\n"
        )

    def _raise_capacity_if_needed(self, exc: Exception) -> None:
        """429/503 → GeminiCapacityError, щоб черга повернула товар у pending."""
        status = _gemini_http_status(exc)
        client_error = getattr(genai_errors, "ClientError", None) if genai_errors else None
        server_error = getattr(genai_errors, "ServerError", None) if genai_errors else None
        api_error = getattr(genai_errors, "APIError", None) if genai_errors else None
        is_sdk_error = bool(
            (client_error and isinstance(exc, client_error))
            or (server_error and isinstance(exc, server_error))
            or (api_error and isinstance(exc, api_error))
        )
        if status in (429, 503) or (is_sdk_error and status in (429, 503)):
            raise GeminiCapacityError(
                int(status or 429),
                "API Quota/Rate Limit Exceeded",
            ) from exc
        if is_sdk_error and status is None:
            msg = str(exc)
            if "429" in msg or "RESOURCE_EXHAUSTED" in msg.upper() or "QUOTA" in msg.upper():
                raise GeminiCapacityError(429, "API Quota/Rate Limit Exceeded") from exc
            if "503" in msg or "UNAVAILABLE" in msg.upper():
                raise GeminiCapacityError(503, "API Quota/Rate Limit Exceeded") from exc

    def _is_client_error(self, exc: Exception) -> bool:
        if not genai_errors:
            return False
        client_error = getattr(genai_errors, "ClientError", None)
        server_error = getattr(genai_errors, "ServerError", None)
        return bool(
            (client_error and isinstance(exc, client_error))
            or (server_error and isinstance(exc, server_error))
        )

    async def _complete(
        self,
        model_name: str,
        user_prompt: str,
        rules_text: str = "",
    ) -> str:
        if genai is None or types is None or not self._key_manager:
            raise Exception("Gemini client is not configured")

        system_instruction = _SYSTEM_PROMPT
        if rules_text:
            system_instruction = f"{rules_text.strip()}\n\n{_SYSTEM_PROMPT.strip()}"

        last_error: Optional[Exception] = None
        attempts = max(1, self._key_manager.key_count)
        for _ in range(attempts):
            try:
                active_key = self._key_manager.get_next_active_key()
            except AllKeysExhaustedError as e:
                raise GeminiCapacityError(429, str(e)) from e

            client = genai.Client(api_key=active_key)
            try:
                response = await client.aio.models.generate_content(
                    model=model_name,
                    contents=user_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                    ),
                )
            except Exception as e:
                error_str = str(e)
                if (
                    "ClientConnectorDNSError" in error_str
                    or "429" in error_str
                    or "503" in error_str
                    or _is_sdk_quota_crash(e)
                ):
                    self._key_manager.mark_key_exhausted(active_key)
                    logger.warning(
                        "Gemini SDK/quota на ключі ...%s — ключ заблоковано. %s",
                        active_key[-4:],
                        error_str[:240],
                    )
                    raise GeminiCapacityError(
                        429,
                        "API Quota Exceeded (Google SDK Bug)",
                    ) from e
                status = _gemini_http_status(e)
                if status == 429:
                    self._key_manager.mark_key_exhausted(active_key)
                    last_error = e
                    logger.warning(
                        "Gemini 429 на ключі ...%s — переходжу на наступний.",
                        active_key[-4:],
                    )
                    continue
                self._raise_capacity_if_needed(e)
                api_error = getattr(genai_errors, "APIError", None) if genai_errors else None
                if api_error and isinstance(e, api_error):
                    raise Exception(f"Gemini API Error {e.code}: {e.message or e}") from e
                raise

            text = (response.text or "").strip()
            if not text:
                raise Exception(f"Gemini повернув порожню відповідь (модель {model_name})")
            return text

        raise GeminiCapacityError(
            429,
            "API Quota/Rate Limit Exceeded",
        ) from last_error

    async def process_product(self, product: Product, db_session: AsyncSession) -> bool:
        """
        Відправляє товар у Gemini і оновлює PIM-поля:
        name / category / sub_category / season / target_niche / gender /
        attributes / ai_category / description / is_ai_processed.
        Commit робить викликач.

        Повертає True лише якщо JSON розпарсився і поля записано.
        """
        if not self.is_ready:
            logger.warning(
                "process_product: Gemini не ініціалізовано, товар #%s пропущено.",
                getattr(product, "id", "?"),
            )
            return False

        product_id = product.id
        source_text = _product_text(product.name, product.description, product.sub_category)
        rules_text = await load_ai_categorization_rules_text(db_session)
        prompt = self._build_user_prompt(product)
        if rules_text:
            prompt = f"{rules_text}\n\n{prompt}"
        models_to_try = (self.model_name, self.fallback_model)

        for attempt, model_name in enumerate(models_to_try):
            try:
                content = await self._complete(model_name, prompt, rules_text=rules_text)

                cleaned_content = content.replace("```json", "").replace("```", "").strip()
                start_idx = cleaned_content.find("{")
                end_idx = cleaned_content.rfind("}")
                if start_idx != -1 and end_idx != -1:
                    cleaned_content = cleaned_content[start_idx:end_idx + 1]
                data = _safe_json_loads(cleaned_content)
                if not data:
                    logger.warning(
                        "Gemini повернув невалідний JSON для товару #%s. Raw: %s",
                        product_id,
                        content[:500],
                    )
                    return False

                fields = _extract_ai_fields(data, source_text)
                if not fields:
                    logger.warning(
                        "Gemini повернув порожні або невалідні поля для товару #%s: %s",
                        product_id,
                        data,
                    )
                    return False

                product.name = fields["name"]
                product.category = fields["main_category"]
                product.sub_category = fields["sub_category"]
                product.season = fields["season"]
                product.target_niche = fields["target_niche"]
                product.gender = fields["gender"]
                product.attributes = fields["attributes"] or None
                product.ai_category = _clip(
                    f"{fields['target_niche']} / {fields['main_category']} / {fields['sub_category']}",
                    255,
                )
                product.description = fields["description"]
                product.is_ai_processed = True
                product.ai_status = ProductAIStatus.completed

                await db_session.flush()
                logger.info(
                    "✅ AI PIM #%s → «%s» / [%s | %s -> %s | %s | %s] (%s)",
                    product_id,
                    fields["name"],
                    fields["target_niche"],
                    fields["main_category"],
                    fields["sub_category"],
                    fields["season"] or "—",
                    fields["gender"] or "—",
                    model_name,
                )
                return True

            except GeminiCapacityError:
                raise
            except Exception as e:
                error_str = str(e)
                if (
                    "ClientConnectorDNSError" in error_str
                    or "429" in error_str
                    or "503" in error_str
                    or _is_sdk_quota_crash(e)
                ):
                    raise GeminiCapacityError(
                        429,
                        "API Quota Exceeded (Google SDK Bug)",
                    ) from e
                if self._is_client_error(e):
                    status = _gemini_http_status(e)
                    if status in (429, 503):
                        raise GeminiCapacityError(
                            status,
                            "API Quota/Rate Limit Exceeded",
                        ) from e
                self._raise_capacity_if_needed(e)
                logger.error(
                    "❌ Gemini помилка для товару #%s (%s): %s",
                    product_id,
                    model_name,
                    e,
                    exc_info=True,
                )
                if attempt == 0:
                    logger.warning("ProductAIProcessor: фолбек на модель %s.", self.fallback_model)
                    continue
                return False

        return False
