# services/product_service.py
"""
Спільний сервіс читання каталогу товарів (Product / ProductVariant /
ProductOption / ProductOptionValue) з нашої БД + розрахунок фінальної ціни.

Раніше ці функції жили в services/xml_parser.py, хоча самі по собі з XML
не працювали — вони лише ЧИТАЮТЬ уже готові дані з БД (яку наповнює
парсер/синхронізатор). Тепер каталог наповнюється і зі старого XML
(services/xml_parser.py, якщо ще використовується), і з MyDrop REST API
(services/mydrop_sync.py) — тож ці read/pricing функції винесено сюди, в
модуль, що НЕ залежить від джерела даних.

Актуальні консьюмери:
- services/cart_service.py  -> get_variant_by_offer_id, get_variant_with_options
- web_app.py                -> search_products, get_product_by_sku
- services/mydrop_sync.py   -> calculate_final_price
"""
import logging
from datetime import datetime, timedelta, timezone
from decimal import ROUND_UP, Decimal, InvalidOperation
from typing import TYPE_CHECKING, List, Optional, Sequence, Union

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from database.db import AsyncSessionLocal
from database.models import (
    PriceRule,
    PriceRuleType,
    Product,
    ProductOption,
    ProductOptionValue,
    ProductVariant,
)

if TYPE_CHECKING:
    # Лише для type-checker'а: уникаємо реального імпорту api_models на
    # рівні модуля (той самий підхід, що й у старому xml_parser.py) —
    # ProductAPI імпортується локально всередині search_products().
    from api_models import ProductAPI

logger = logging.getLogger(__name__)

# --- Кеш активних правил націнки (PriceRule) ---
# [ФІКС SQLite locked] Раніше `_load_price_rules()` на КОЖЕН товар
# відкривала НОВУ сесію (`AsyncSessionLocal()`) і робила SELECT у
# `price_rules` — під час відкритої транзакції запису в `mydrop_sync`.
# SQLite не вміє тримати другий конект на читання, коли перший тримає
# write-lock → `database is locked` на ~тисячі товарів.
# Тепер: 1 SELECT на 5 хвилин, бажано в ТІЙ САМІЙ сесії (`db=`).
_cached_price_rules: List[PriceRule] = []
_rules_last_fetched: Optional[datetime] = None
_RULES_CACHE_TTL = timedelta(minutes=5)


async def _load_price_rules(db: Optional[AsyncSession] = None) -> List[PriceRule]:
    """
    Повертає активні PriceRule (сортовані за priority).

    Якщо кеш молодший за `_RULES_CACHE_TTL` (5 хв) — БД не чіпаємо.
    Інакше один SELECT: у передану сесію `db` (без другого конекта —
    обов'язково під час масового імпорту) або, якщо `db` немає, у
    коротку окрему сесію (звичайні одиночні виклики з кошика/пошуку).
    Порожній список теж кешується (немає правил ≠ "кеш порожній").
    """
    global _cached_price_rules, _rules_last_fetched

    now = datetime.now(timezone.utc)
    if _rules_last_fetched is not None and (now - _rules_last_fetched < _RULES_CACHE_TTL):
        return _cached_price_rules

    async def _fetch(session: AsyncSession) -> None:
        global _cached_price_rules, _rules_last_fetched
        stmt = (
            select(PriceRule)
            .where(PriceRule.is_active == True)  # noqa: E712 (SQLAlchemy-стиль)
            .order_by(PriceRule.priority.asc())
        )
        result = await session.execute(stmt)
        _cached_price_rules = list(result.scalars().all())
        _rules_last_fetched = datetime.now(timezone.utc)

    try:
        if db is not None:
            await _fetch(db)
        else:
            async with AsyncSessionLocal() as session:
                await _fetch(session)
    except Exception as e:
        logger.error("Не вдалося завантажити PriceRule: %s", e, exc_info=True)
        if _rules_last_fetched is None:
            _cached_price_rules = []

    return _cached_price_rules


def _aggressive_rounding(price: Decimal) -> int:
    """Округлення ціни вгору: до 100 грн — крок 5, вище — крок 10."""
    try:
        price_int = int(price.to_integral_value(rounding=ROUND_UP))
        if price_int < 100:
            remainder = price_int % 5
            return price_int + (5 - remainder) if remainder != 0 else price_int
        remainder = price_int % 10
        if remainder == 0:
            return price_int
        return price_int + (10 - remainder)
    except Exception:
        return 0


async def calculate_final_price(
    base_price_str: Optional[str],
    category_tag: Optional[str] = None,
    supplier_id: Optional[int] = None,
    db: Optional[AsyncSession] = None,
) -> int:
    """
    Розраховує фінальну (клієнтську) ціну з дроп-ціни постачальника за
    правилами PriceRule (перше правило, що підходить за діапазоном ціни /
    категорією / постачальником), інакше fallback +33%.

    `base_price_str` — рядок (сумісність зі старим викликом з XML-парсера
    і з новим викликом з mydrop_sync.py, де ціна теж передається як str).
    `db` — сесія поточного імпорту (передавай під час sync, щоб SELECT
    правил не відкривав другий конект до SQLite).
    """
    if base_price_str is None:
        return 0
    try:
        cleaned = base_price_str.strip().replace(" ", "").replace(",", ".")
        if not cleaned:
            return 0
        base_price_decimal = Decimal(cleaned)
        if base_price_decimal <= 0:
            return 0

        rules = await _load_price_rules(db)
        final_price: Optional[Decimal] = None
        base_price_kopecks = int(base_price_decimal * 100)

        for rule in rules:
            if rule.min_price is not None and base_price_kopecks < rule.min_price:
                continue
            if rule.max_price is not None and base_price_kopecks > rule.max_price:
                continue
            if rule.category_tag is not None and rule.category_tag != category_tag:
                continue
            if rule.supplier_id is not None and rule.supplier_id != supplier_id:
                continue

            if rule.rule_type == PriceRuleType.percentage:
                final_price = base_price_decimal * (Decimal("1.0") + (Decimal(rule.value) / Decimal("100.0")))
            elif rule.rule_type == PriceRuleType.fixed_amount:
                final_price = base_price_decimal + Decimal(rule.value)
            break

        if final_price is None:
            final_price = base_price_decimal * Decimal("1.33")

        return _aggressive_rounding(final_price)
    except (InvalidOperation, ValueError, TypeError) as e:
        logger.warning("calculate_final_price: невалідна ціна '%s': %s", base_price_str, e)
        return 0
    except Exception as e:
        logger.error("calculate_final_price: неочікувана помилка: %s", e, exc_info=True)
        return 0


async def get_product_by_sku(sku: str) -> Optional[Product]:
    """
    Знаходить товар за артикулом постачальника (Product.supplier_sku),
    разом з варіантами (+ їхніми опціями) та опціями товару — eager-load,
    інакше доступ до `.variants` / `.options` після закриття сесії впаде
    у MissingGreenlet (AsyncSession).

    ПРИМІТКА: у старому services/xml_parser.py ця функція викликалась
    (`handlers/product_handlers.py`, `web_app.py`), але фізично НЕ була
    визначена — тож викликам цієї функції там завжди був би AttributeError.
    Тут реалізовано вперше, з тим самим ім'ям і сигнатурою.
    """
    sku_clean = (sku or "").strip()
    if not sku_clean:
        return None

    async with AsyncSessionLocal() as db:
        try:
            stmt = (
                select(Product)
                .where(Product.supplier_sku == sku_clean)
                .options(
                    selectinload(Product.variants).selectinload(ProductVariant.option_values),
                    selectinload(Product.options).selectinload(ProductOption.values),
                )
            )
            result = await db.execute(stmt)
            return result.scalars().unique().one_or_none()
        except Exception as e:
            logger.error("get_product_by_sku('%s'): помилка БД: %s", sku_clean, e, exc_info=True)
            return None


def _normalize_filter_values(value: Optional[Union[str, Sequence[str]]]) -> List[str]:
    """Один рядок, CSV або список → унікальні значення для WHERE IN."""
    if value is None:
        return []
    chunks = [value] if isinstance(value, str) else list(value)
    items: List[str] = []
    seen = set()
    for chunk in chunks:
        if chunk is None:
            continue
        for part in str(chunk).split(","):
            cleaned = part.strip()
            if not cleaned:
                continue
            key = cleaned.casefold()
            if key in seen:
                continue
            seen.add(key)
            items.append(cleaned)
    return items


async def search_products(
    query: str,
    limit: int = 50,
    category: Optional[Union[str, Sequence[str]]] = None,
    sub_category: Optional[Union[str, Sequence[str]]] = None,
    season: Optional[Union[str, Sequence[str]]] = None,
    target_niche: Optional[Union[str, Sequence[str]]] = None,
    gender: Optional[Union[str, Sequence[str]]] = None,
) -> List["ProductAPI"]:
    """
    Пошук товарів для GET /api/v1/search.
    Критично: валідуємо в Pydantic (ProductAPI) ПОКИ сесія БД ще жива і
    зв'язки вже eager-loaded, інакше FastAPI спробує lazy-load після
    закриття сесії.
    """
    from api_models import ProductAPI  # локальний імпорт: без цикл. залежності на рівні модуля

    q = (query or "").strip()
    if not q:
        return []

    async with AsyncSessionLocal() as db:
        stmt = (
            select(Product)
            .options(
                selectinload(Product.supplier),
                selectinload(Product.variants).selectinload(ProductVariant.option_values),
                selectinload(Product.options).selectinload(ProductOption.values),
            )
            .where(
                or_(
                    Product.name.ilike(f"%{q}%"),
                    Product.description.ilike(f"%{q}%"),
                    Product.category.ilike(f"%{q}%"),
                    Product.sub_category.ilike(f"%{q}%"),
                    Product.season.ilike(f"%{q}%"),
                    Product.target_niche.ilike(f"%{q}%"),
                    Product.gender.ilike(f"%{q}%"),
                )
            )
            .limit(limit)
        )
        categories = _normalize_filter_values(category)
        sub_categories = _normalize_filter_values(sub_category)
        seasons = _normalize_filter_values(season)
        niches = _normalize_filter_values(target_niche)
        genders = _normalize_filter_values(gender)
        if categories:
            stmt = stmt.where(Product.category.in_(categories))
        if sub_categories:
            stmt = stmt.where(Product.sub_category.in_(sub_categories))
        if seasons:
            stmt = stmt.where(Product.season.in_(seasons))
        if niches:
            stmt = stmt.where(Product.target_niche.in_(niches))
        if genders:
            stmt = stmt.where(Product.gender.in_(genders))

        res = await db.execute(stmt)
        products = res.scalars().unique().all()

        # `option_value_ids` на ProductVariant — не колонка, а relationship,
        # тож model_validate() не заповнить його автоматично.
        result_api: List[ProductAPI] = []
        for p in products:
            for v in p.variants:
                v.option_value_ids = [ov.id for ov in (v.option_values or [])]
            item = ProductAPI.model_validate(p)
            item.supplier_name = p.supplier.name if getattr(p, "supplier", None) else None
            if not getattr(p, "is_ai_processed", False):
                item.category = None
                item.sub_category = None
                item.season = None
                item.target_niche = None
                item.gender = None
                item.attributes = None
            result_api.append(item)

        return result_api


async def get_variant_by_offer_id(offer_id: str) -> Optional[ProductVariant]:
    """
    Знаходить ProductVariant за supplier_offer_id (унікальний ID варіанту в
    нашій БД — однаково працює і для товарів зі старого XML, і з MyDrop
    JSON). Eager-load Product + Supplier — потрібно кошику
    (services/cart_service.py читає variant.product.supplier).

    [ФІКС] У старій версії (xml_parser.py) тут вантажився лише
    `.product`, БЕЗ `.product.supplier` — а cart_service.py відразу читає
    `variant.product.supplier` ПІСЛЯ закриття сесії. Це потенційний
    MissingGreenlet, який тут виправлено додатковим joinedload.
    """
    if not offer_id:
        return None

    async with AsyncSessionLocal() as db:
        try:
            stmt = (
                select(ProductVariant)
                .where(ProductVariant.supplier_offer_id == offer_id)
                .options(joinedload(ProductVariant.product).joinedload(Product.supplier))
            )
            result = await db.execute(stmt)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error("get_variant_by_offer_id('%s'): помилка БД: %s", offer_id, e, exc_info=True)
            return None


async def get_variant_with_options(variant_id: int) -> Optional[ProductVariant]:
    """Знаходить ProductVariant за id разом з опціями (Розмір/Колір/...)."""
    if not variant_id:
        return None

    async with AsyncSessionLocal() as db:
        stmt = (
            select(ProductVariant)
            .where(ProductVariant.id == variant_id)
            .options(selectinload(ProductVariant.option_values).selectinload(ProductOptionValue.option))
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
