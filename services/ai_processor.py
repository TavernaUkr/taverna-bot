# services/ai_processor.py
"""
PIM (Product Information Management) через прямі REST-запити до Gemini API (aiohttp):
жорстка таксономія main_category / target_niche + динамічні атрибути + SEO-опис.

SDK google-genai НЕ використовується для генерації — він хибно трактує ключі
формату AQ... як OAuth-токени і шле Bearer-заголовок, через що Google повертає
401 UNAUTHENTICATED. REST API з ключем у query-параметрі ?key=... працює коректно.
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional

import aiohttp

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config_reader import config, sanitize_gemini_api_key
from database.models import AICategorizationRule, Product, ProductAIStatus, ProductStatus, ProductVariant
from services.gemini_key_manager import AllKeysExhaustedError, get_key_manager

logger = logging.getLogger(__name__)

GEMINI_REST_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_REST_TIMEOUT = aiohttp.ClientTimeout(total=120)

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


class GeminiHTTPError(Exception):
    """Будь-яка інша (не 429/503) HTTP-помилка REST API Gemini, з кодом статусу."""

    def __init__(self, status: int, message: str = ""):
        super().__init__(message or f"Gemini API Error {status}")
        self.status = status


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

GEMINI_MODEL = "gemini-2.0-flash"
GEMINI_FALLBACK_MODEL = "gemini-3.6-flash"

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


def _coerce_is_product(item: dict) -> bool:
    if not isinstance(item, dict):
        return False
    raw = item.get("is_product")
    if raw is None:
        return True
    if isinstance(raw, bool):
        return raw
    text = str(raw).strip().lower()
    if text in {"false", "0", "no", "ні", "n", "off"}:
        return False
    if text in {"true", "1", "yes", "так", "y", "on"}:
        return True
    return bool(raw)


_ATTR_META_KEYS = {
    "source",
    "source_url",
    "telegram_message_id",
    "vendor_code",
    "sizes",
    "media_urls",
    "characteristics",
    "search_tags",
    "base_model_name",
    "color",
}

_EXTRACT_SYSTEM_PROMPT = """
ЧАСТИНА 1 — ЕКСТРАКЦІЯ. ТИ ПРАЦЮЄШ У СУВОРОМУ РЕЖИМІ EXTRACTION.
ЗАБОРОНЕНО вигадувати дані. ЗАБОРОНЕНО визначати категорію, нішу чи сезон.
Використовуй ТІЛЬКИ інформацію з оригінального тексту.
Працюєш українською. Поверни виключно один JSON-об'єкт. Без markdown.

СПОЧАТКУ визнач is_product.
Проаналізуй текст. Якщо це інформаційний пост, правила доставки, новини магазину,
графік роботи, опитування чи просто текст без конкретного товару для продажу —
поверни is_product: false. Всі інші поля залиш порожніми (name="", characteristics=[], sizes=[]).

Формат:
{"is_product": true, "name":"...","base_model_name":"Напівчеревики ESDY з швидкою шнурівкою","color":"мультикам","characteristics":[{"name":"Бренд","value":"Nike"},{"name":"Матеріал","value":"шкіра"}],"sizes":["40","41"]}

Правила:
- is_product: обов'язкове boolean. false = зупинити обробку, це не товар.
- name: чиста комерційна назва до 80 символів. Без артикулів, цін, HTML.
- base_model_name: базова модель БЕЗ кольору (напр. «Напівчеревики ESDY з швидкою шнурівкою»).
  Однакова для всіх кольорів цієї моделі. Якщо кольору в назві немає — скопіюй name.
  base_model_name ПОВИННА БУТИ АБСОЛЮТНО ІДЕНТИЧНОЮ для товарів однієї моделі.
  Видаляй з назви кольори, розміри та артикули. Залишай ЛИШЕ суху назву моделі
  (напр. «Демісезонні напівчеревики ESDY з швидкою шнурівкою»). Без зайвих слів,
  без розділових знаків у кінці, без варіацій формулювання між однаковими товарами.
- color: колір з тексту (напр. «мультикам», «олива», «чорний»). Якщо кольору немає — "".
- characteristics: ТІЛЬКИ факти з тексту (Бренд, Матеріал, Пам'ять, Вага, Країна, Колір, Сезон тощо).
  Формат: [{"name":"Ключ","value":"значення з тексту"}]. Якщо факту немає — не додавай. [] дозволений.
- sizes: усі згадані розміри як масив рядків. Якщо немає — [].
- НЕ пиши description, main_category, niche, season у цій відповіді.
"""

_ANALYZE_SYSTEM_PROMPT = """
ЧАСТИНА 2 — АНАЛІЗ. Характеристики й розміри ВЖЕ витягнуті. НЕ вигадуй нових фактів.
Працюєш українською. Поверни виключно один JSON-об'єкт. Без markdown.

ПОРЯДОК РОБОТИ (суворо):
1) Спочатку напиши description — художній рерайт НАЯВНИХ переваг з тексту і characteristics.
   Жодної технічної інформації (розмірів, матеріалів, країн) у description. Без цін і лінків.
   Структура з \\n: короткий вступ, порожній рядок, список переваг з емодзі з нового рядка.
2) ПОТІМ, спираючись на characteristics + sizes + назву, ЖОРСТКО визнач:
   main_category, sub_category, target_niche, season, gender.
3) search_tags — масив 4–12 коротких рядків для пошуку (напр. ["кросівки","зима","nike","шкіра"]).
   Бери слова з характеристик, типу товару, сезону, бренду, ніші. Без речень. Без дублікатів.

Формат:
{"name":"...","description":"...","main_category":"...","sub_category":"...","target_niche":"...","season":null,"gender":null,"search_tags":["кросівки","зима","nike","шкіра"]}

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
- sub_category — вузький тип з назви/характеристик (наприклад: "Зимові куртки").
- season: "Зима", "Літо", "Демісезон", "Всесезон" або null.
- gender: "Чоловічий", "Жіночий", "Унісекс", "Дитячий" або null.
"""


def _strip_html(text: Optional[str]) -> str:
    if not text:
        return ""
    cleaned = str(text).replace("\\n", "\n")
    cleaned = re.sub(r"<br\s*/?>", "\n", cleaned, flags=re.I)
    cleaned = _HTML_RE.sub(" ", cleaned)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in cleaned.split("\n")]
    out: list[str] = []
    blank = 0
    for line in lines:
        if not line:
            blank += 1
            if blank <= 1:
                out.append("")
            continue
        blank = 0
        out.append(line)
    return "\n".join(out).strip()


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


def _clean_text(raw: Any) -> str:
    """Прибирає зайві пробіли/переноси, які Gemini інколи лишає в текстових полях."""
    return re.sub(r"\s+", " ", str(raw if raw is not None else "")).strip()


def _clip(value: Any, max_len: int) -> str:
    value = _clean_text(value)
    if len(value) <= max_len:
        return value
    return value[: max_len - 1].rstrip() + "…"


def _color_from_pairs(pairs: list[dict]) -> str:
    for pair in pairs or []:
        name = str(pair.get("name") or "").strip().casefold()
        if name in {"колір", "цвет", "color", "забарвлення"}:
            return str(pair.get("value") or "").strip()[:80]
    return ""


def _fallback_base_model(name: str, color: str) -> str:
    title = (name or "").strip()
    shade = (color or "").strip()
    if title and shade:
        folded = title.casefold()
        needle = shade.casefold()
        if folded.endswith(needle):
            title = title[: len(title) - len(shade)].rstrip(" -,/()")
    return title[:200]


def _is_empty(raw: Any) -> bool:
    if raw is None:
        return True
    return _clean_text(raw).lower() in _EMPTY_VALUES


def _normalize_enum(
    raw: Any,
    allowed: tuple,
    aliases: Dict[str, str],
    default: Optional[str] = None,
) -> Optional[str]:
    if _is_empty(raw):
        return default
    value = _clean_text(raw)
    if _NUMERIC_RE.match(value):
        return default
    if value in allowed:
        return value
    return aliases.get(value.lower(), default)


def _normalize_attributes(raw: Any) -> Dict[str, str]:
    pairs = _characteristic_pairs(raw)
    return {pair["name"]: pair["value"] for pair in pairs}


def _characteristic_pairs(raw: Any) -> list[dict]:
    items = []
    if isinstance(raw, dict):
        items = list(raw.items())
    elif isinstance(raw, list):
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            key = entry.get("name") or entry.get("key") or entry.get("title")
            val = entry.get("value") if "value" in entry else entry.get("val")
            if key:
                items.append((key, val))
    cleaned: list[dict] = []
    seen = set()
    for key, value in items:
        name = _clip(str(key), 80)
        if not name or name.lower() in _ATTR_META_KEYS or _is_empty(value):
            continue
        if isinstance(value, (dict, list)):
            continue
        text = str(value).strip()[:200]
        fold = name.casefold()
        if not text or fold in seen:
            continue
        seen.add(fold)
        cleaned.append({"name": name, "value": text})
        if len(cleaned) >= 20:
            break
    return cleaned


def _ground_characteristic_pairs(pairs: list[dict], source_text: str) -> list[dict]:
    blob = (source_text or "").casefold()
    if not blob:
        return list(pairs or [])
    grounded: list[dict] = []
    for pair in pairs or []:
        value = str(pair.get("value") or "").strip()
        if not value:
            continue
        needle = value.casefold()
        tokens = [tok for tok in re.split(r"\W+", needle, flags=re.UNICODE) if len(tok) >= 3]
        if needle in blob or (tokens and all(tok in blob for tok in tokens)):
            grounded.append(pair)
    return grounded


def _existing_characteristic_pairs(raw: Any) -> list[dict]:
    if isinstance(raw, dict) and isinstance(raw.get("characteristics"), list):
        return _characteristic_pairs(raw.get("characteristics"))
    return _characteristic_pairs(raw)


def _merge_extracted_attributes(
    existing: Any,
    pairs: list[dict],
    search_tags: Optional[list] = None,
    base_model_name: Optional[str] = None,
    color: Optional[str] = None,
) -> dict:
    old = existing if isinstance(existing, dict) else {}
    merged: Dict[str, Any] = {}
    for key, value in old.items():
        if str(key).lower() in _ATTR_META_KEYS and key not in ("characteristics", "search_tags"):
            merged[key] = value
    merged["characteristics"] = pairs
    for pair in pairs:
        name = str(pair.get("name") or "").strip()
        text = str(pair.get("value") or "").strip()
        if name and text and name.lower() not in _ATTR_META_KEYS:
            merged[name] = text
    tags = _normalize_search_tags(
        search_tags if search_tags is not None else old.get("search_tags")
    )
    if tags:
        merged["search_tags"] = tags
    model = _clip(base_model_name, 200) or _clip(old.get("base_model_name"), 200)
    if model:
        merged["base_model_name"] = model
    shade = _clip(color, 80) or _clip(old.get("color"), 80)
    if shade:
        merged["color"] = shade
    return merged


def _normalize_search_tags(raw: Any) -> list[str]:
    chunks: list = []
    if isinstance(raw, list):
        chunks = raw
    elif isinstance(raw, str):
        chunks = re.split(r"[,;/|]+", raw)
    seen = set()
    tags: list[str] = []
    for chunk in chunks:
        value = str(chunk or "").strip().lower()[:40]
        if not value or value in _EMPTY_VALUES:
            continue
        if value in seen:
            continue
        seen.add(value)
        tags.append(value)
        if len(tags) >= 16:
            break
    return tags


def _normalize_sizes(raw: Any) -> list[str]:
    chunks = []
    if isinstance(raw, list):
        chunks = raw
    elif isinstance(raw, str):
        chunks = re.split(r"[,;/|]+", raw)
    seen = set()
    sizes: list[str] = []
    for chunk in chunks:
        value = str(chunk or "").strip()[:40]
        if not value:
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        sizes.append(value)
        if len(sizes) >= 40:
            break
    return sizes


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
    name = _clip(data.get("name"), 512)
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
    sub_category = _clip(data.get("sub_category"), 150)
    season = _normalize_enum(data.get("season"), SEASONS, _SEASON_ALIASES)
    gender = _normalize_enum(data.get("gender"), GENDERS, _GENDER_ALIASES)
    attributes = _ground_characteristic_pairs(
        _characteristic_pairs(
            data.get("characteristics")
            if data.get("characteristics") is not None
            else data.get("attributes")
        ),
        source_text,
    )
    description = _strip_html(data.get("description"))
    search_tags = _normalize_search_tags(data.get("search_tags"))

    fields = {
        "name": name,
        "main_category": main_category,
        "target_niche": target_niche,
        "sub_category": sub_category,
        "season": season,
        "gender": gender,
        "attributes": {pair["name"]: pair["value"] for pair in attributes},
        "characteristics": attributes,
        "description": description,
        "search_tags": search_tags,
        "sizes": _normalize_sizes(data.get("sizes")),
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

        if not self._key_manager.has_keys():
            logger.warning("GEMINI_API_KEYS не знайдено. AI-обробку товарів буде пропущено.")
            return

        logger.info(
            "ProductAIProcessor: Gemini REST готовий (%s), ключів: %s.",
            self.model_name,
            self._key_manager.key_count,
        )

    @property
    def is_ready(self) -> bool:
        return bool(self._key_manager and self._key_manager.has_keys())

    def _source_blob(self, product: Product) -> str:
        raw_description = _strip_html(product.description)[:4000]
        existing_pairs = _existing_characteristic_pairs(getattr(product, "attributes", None))
        existing_json = json.dumps(existing_pairs, ensure_ascii=False) if existing_pairs else "[]"
        return (
            f"Назва: {(product.name or '').strip()}\n"
            f"Артикул: {(product.supplier_sku or '').strip()}\n"
            f"Сира категорія (від постачальника): {(product.category or '').strip() or 'немає'}\n"
            f"Сира підкатегорія: {(getattr(product, 'sub_category', None) or '').strip() or 'немає'}\n"
            f"Сирий сезон: {(getattr(product, 'season', None) or '').strip() or 'немає'}\n"
            f"Уже витягнуті характеристики:\n{existing_json}\n"
            f"Опис:\n{raw_description or 'немає'}\n"
        )

    def _build_extract_prompt(self, product: Product) -> str:
        return (
            "ЧАСТИНА 1. Спочатку постав is_product true/false. "
            "Якщо false — name/characteristics/sizes порожні. "
            "Якщо true — витягни name, base_model_name, color, characteristics і sizes.\n"
            "base_model_name — модель без кольору, розміру й артикулу. Ця назва МАЄ БУТИ "
            "АБСОЛЮТНО ІДЕНТИЧНОЮ для всіх товарів однієї моделі (щоб кольори склеїлись у варіації). "
            "color — колір з тексту.\n"
            "Не став категорію і не пиши опис.\n\n"
            f"{self._source_blob(product)}"
        )

    def _build_analyze_prompt(
        self,
        product: Product,
        pairs: list[dict],
        sizes: list[str],
    ) -> str:
        facts = json.dumps(pairs, ensure_ascii=False)
        size_json = json.dumps(sizes, ensure_ascii=False)
        return (
            "ЧАСТИНА 2. Характеристики вже витягнуті. Не додавай нових фактів.\n"
            "Спочатку description, потім категорії, потім search_tags.\n\n"
            f"{self._source_blob(product)}\n"
            f"characteristics (готово):\n{facts}\n"
            f"sizes (готово):\n{size_json}\n\n"
            f"main_category обирай ТІЛЬКИ з: {', '.join(PRIMARY_CATEGORIES)}\n"
            f"target_niche обирай ТІЛЬКИ з: {', '.join(TARGET_NICHES)}\n"
            f"season: {', '.join(SEASONS)} або null.\n"
            "gender: Чоловічий / Жіночий / Унісекс / Дитячий або null.\n"
        )

    def _raise_capacity_if_needed(self, exc: Exception) -> None:
        """429/503 → GeminiCapacityError, щоб черга повернула товар у pending."""
        status = getattr(exc, "status", None) or _gemini_http_status(exc)
        if status in (429, 503):
            raise GeminiCapacityError(int(status), "API Quota/Rate Limit Exceeded") from exc
        msg = str(exc)
        if "429" in msg or "RESOURCE_EXHAUSTED" in msg.upper() or "QUOTA" in msg.upper():
            raise GeminiCapacityError(429, "API Quota/Rate Limit Exceeded") from exc
        if "503" in msg or "UNAVAILABLE" in msg.upper():
            raise GeminiCapacityError(503, "API Quota/Rate Limit Exceeded") from exc

    def _is_client_error(self, exc: Exception) -> bool:
        status = getattr(exc, "status", None)
        return isinstance(status, int) and 400 <= status < 500

    async def _complete(
        self,
        model_name: str,
        user_prompt: str,
        rules_text: str = "",
        system_instruction: Optional[str] = None,
    ) -> str:
        """
        Прямий асинхронний REST-запит до Gemini API через aiohttp.
        SDK google-genai НЕ використовується: він хибно шле Bearer-заголовок
        для ключів формату AQ..., через що Google повертає 401 UNAUTHENTICATED.
        Ключ передається через query-параметр ?key=..., як і рекомендує REST API.
        """
        if not self._key_manager:
            raise Exception("Gemini client is not configured")

        instruction = (system_instruction or _ANALYZE_SYSTEM_PROMPT).strip()
        if rules_text:
            instruction = f"{rules_text.strip()}\n\n{instruction}"

        payload: Dict[str, Any] = {
            "contents": [{"parts": [{"text": user_prompt}]}],
            "systemInstruction": {"parts": [{"text": instruction}]},
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
            },
        }

        last_error: Optional[Exception] = None
        attempts = max(1, self._key_manager.key_count)
        for _ in range(attempts):
            try:
                active_key = self._key_manager.get_next_active_key()
            except AllKeysExhaustedError as e:
                raise GeminiCapacityError(429, str(e)) from e

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
                                raise Exception(
                                    f"Gemini повернув порожню відповідь (модель {model_name})"
                                )
                            return text

                        if status == 429:
                            self._key_manager.mark_key_exhausted(active_key)
                            last_error = GeminiCapacityError(429, raw_text[:300])
                            logger.warning(
                                "Gemini 429 (REST) на ключі ...%s — переходжу на наступний.",
                                key[-4:],
                            )
                            continue

                        if status in (401, 403):
                            self._key_manager.mark_key_exhausted(active_key)
                            last_error = GeminiCapacityError(status, raw_text[:300])
                            logger.error(
                                "Gemini %s (auth) на ключі ...%s — блокую ключ, пробую наступний. %s",
                                status,
                                key[-4:],
                                raw_text[:300],
                            )
                            continue

                        if status in (500, 503):
                            logger.error(
                                "Gemini %s (перевантаження серверів Google) — повертаю товар у чергу. %s",
                                status,
                                raw_text[:300],
                            )
                            raise GeminiCapacityError(status, f"Gemini {status}: {raw_text[:300]}")

                        raise GeminiHTTPError(status, f"Gemini API Error {status}: {raw_text[:500]}")
            except GeminiCapacityError:
                raise
            except GeminiHTTPError:
                raise
            except aiohttp.ClientError as e:
                last_error = e
                logger.warning(
                    "Gemini REST мережева помилка на ключі ...%s: %s",
                    key[-4:],
                    e,
                )
                continue

        raise GeminiCapacityError(
            429,
            "API Quota/Rate Limit Exceeded",
        ) from last_error

    async def process_product(self, product: Product, db_session: AsyncSession) -> Optional[bool]:
        """
        Відправляє товар у Gemini двома кроками (екстракція → аналіз)
        і оновлює PIM-поля + search_tags у attributes JSON.
        Commit робить викликач.

        Повертає True лише якщо JSON розпарсився і поля записано.
        None — пост не є товаром (is_product=false): cancelled, нічого не активуємо.
        False — збій відповіді Gemini.
        """
        if not self.is_ready:
            logger.warning(
                "process_product: Gemini не ініціалізовано, товар #%s пропущено.",
                getattr(product, "id", "?"),
            )
            return False

        product_id = product.id
        rules_text = await load_ai_categorization_rules_text(db_session)
        extract_prompt = self._build_extract_prompt(product)
        source_text = self._source_blob(product)
        models_to_try = (self.model_name, self.fallback_model)

        for attempt, model_name in enumerate(models_to_try):
            try:
                extract_content = await self._complete(
                    model_name,
                    extract_prompt,
                    system_instruction=_EXTRACT_SYSTEM_PROMPT,
                )
                extract_data = _safe_json_loads(extract_content) or {}
                if extract_data and not _coerce_is_product(extract_data):
                    product.ai_status = ProductAIStatus.cancelled
                    product.status = ProductStatus.inactive
                    product.is_ai_processed = False
                    logger.info(
                        "AI: #%s не товар (is_product=false) — cancelled, аналіз пропущено.",
                        product_id,
                    )
                    return None
                extracted_pairs = _ground_characteristic_pairs(
                    _characteristic_pairs(
                        extract_data.get("characteristics")
                        if extract_data.get("characteristics") is not None
                        else extract_data.get("attributes")
                    ),
                    source_text,
                )
                if not extracted_pairs:
                    extracted_pairs = _existing_characteristic_pairs(product.attributes)
                extracted_sizes = _normalize_sizes(extract_data.get("sizes"))
                extracted_color = _clip(extract_data.get("color"), 80) or _color_from_pairs(extracted_pairs)
                extracted_model = _clip(extract_data.get("base_model_name"), 200) or _fallback_base_model(
                    extract_data.get("name") or product.name,
                    extracted_color,
                )
                if extracted_color and not _color_from_pairs(extracted_pairs):
                    extracted_pairs.append({"name": "Колір", "value": extracted_color})

                analyze_prompt = self._build_analyze_prompt(
                    product, extracted_pairs, extracted_sizes
                )
                analyze_content = await self._complete(
                    model_name,
                    analyze_prompt,
                    rules_text=rules_text,
                    system_instruction=_ANALYZE_SYSTEM_PROMPT,
                )
                data = _safe_json_loads(analyze_content)
                if not data:
                    logger.warning(
                        "Gemini (аналіз) повернув невалідний JSON для товару #%s. Raw: %s",
                        product_id,
                        analyze_content[:500],
                    )
                    return False

                if not data.get("name"):
                    data["name"] = extract_data.get("name") or product.name
                data["characteristics"] = extracted_pairs
                data["sizes"] = extracted_sizes
                fields = _extract_ai_fields(data, f"{source_text}\n{json.dumps(extracted_pairs, ensure_ascii=False)}")
                if not fields:
                    logger.warning(
                        "Gemini повернув порожні або невалідні поля для товару #%s: %s",
                        product_id,
                        data,
                    )
                    return False

                product.name = _clean_text(fields["name"])
                product.category = _clean_text(fields["main_category"])
                product.sub_category = _clean_text(fields["sub_category"])
                product.season = _clean_text(fields["season"]) or None
                product.target_niche = _clean_text(fields["target_niche"])
                product.gender = _clean_text(fields["gender"]) or None
                product.attributes = _merge_extracted_attributes(
                    product.attributes,
                    fields.get("characteristics") or extracted_pairs,
                    search_tags=fields.get("search_tags"),
                    base_model_name=extracted_model,
                    color=extracted_color,
                )
                product.ai_category = _clip(
                    f"{fields['target_niche']} / {fields['main_category']} / {fields['sub_category']}",
                    255,
                )
                product.description = _strip_html(fields["description"])
                product.is_ai_processed = True
                product.ai_status = ProductAIStatus.completed
                product.status = ProductStatus.active
                sizes_for_option = fields.get("sizes") or extracted_sizes
                if sizes_for_option:
                    from services.telegram_sync import _upsert_size_option
                    await _upsert_size_option(db_session, product_id, sizes_for_option)
                await db_session.execute(
                    update(ProductVariant)
                    .where(ProductVariant.product_id == product_id)
                    .values(is_available=True)
                )

                await db_session.flush()
                logger.info(
                    "✅ AI PIM #%s → «%s» / [%s | %s -> %s | %s | %s] tags=%s (%s)",
                    product_id,
                    fields["name"],
                    fields["target_niche"],
                    fields["main_category"],
                    fields["sub_category"],
                    fields["season"] or "—",
                    fields["gender"] or "—",
                    (fields.get("search_tags") or [])[:6],
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
