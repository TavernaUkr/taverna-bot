from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, text, bindparam
from sqlalchemy.orm import selectinload
from typing import Any, Dict, List, Optional, Tuple
import logging
from pydantic import BaseModel

from database.db import get_db, AsyncSessionLocal, engine as db_engine
from database.models import Product, ProductStatus, ProductAIStatus, ProductVariant, ProductOption
from api_models import (
    ProductAPI,
    ProductVariantAPI,
    CategoryAPI,
    CategorySubAPI,
    CategoryNicheAPI,
    ProductFiltersAPI,
    FilterAttributeAPI,
    DynamicFilterAPI,
    ProductColorVariantAPI,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/products", tags=["Products"])


def _normalize_query_list(raw: Optional[List[str]]) -> List[str]:
    """
    Приймає Query як один рядок, CSV або кілька повторів:
      ?season=Зима
      ?season=Зима,Літо
      ?season=Зима&season=Літо
    Повертає унікальний список без порожніх значень.
    """
    if not raw:
        return []
    items: List[str] = []
    seen = set()
    for chunk in raw:
        if chunk is None:
            continue
        for part in str(chunk).split(","):
            value = part.strip()
            if not value:
                continue
            key = value.casefold()
            if key in seen:
                continue
            seen.add(key)
            items.append(value)
    return items


def _merge_query_lists(*groups: Optional[List[str]]) -> List[str]:
    merged: List[str] = []
    for group in groups:
        if group:
            merged.extend(group)
    return _normalize_query_list(merged)


def _escape_ilike(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _ilike_any(column, values: Optional[List[str]]):
    """OR по ilike: ігнорує регістр і зайві пробіли навколо значення."""
    patterns = []
    for raw in values or []:
        text = (raw or "").strip()
        if text:
            patterns.append(_escape_ilike(text))
    if not patterns:
        return None
    return or_(*(column.ilike(f"%{p}%", escape="\\") for p in patterns))


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


def _session_is_postgres(db: AsyncSession) -> bool:
    bind = getattr(db, "bind", None)
    if bind is None:
        sync_session = getattr(db, "sync_session", None)
        bind = getattr(sync_session, "bind", None) if sync_session is not None else None
    dialect_name = getattr(getattr(bind, "dialect", None), "name", "") or ""
    if not dialect_name and db_engine is not None:
        dialect_name = db_engine.dialect.name
    return str(dialect_name).startswith("postgres")


def _parse_char_filters(query_params) -> Dict[str, List[str]]:
    """
    З query читає динамічні характеристики: ?char_Виробник=Китай&char_Пам'ять=256GB
    Кілька значень — через повтор параметра або CSV.
    """
    grouped: Dict[str, List[str]] = {}
    getter = getattr(query_params, "getlist", None)
    keys = list(query_params.keys()) if query_params is not None else []
    for key in keys:
        if not str(key).startswith("char_"):
            continue
        name = str(key)[5:].strip()
        if not name or len(name) > 80 or any(ch in name for ch in '"\\\x00\n\r'):
            continue
        raw_values = getter(key) if callable(getter) else [query_params.get(key)]
        grouped[name] = _normalize_query_list(list(raw_values or []))
    return {name: values for name, values in grouped.items() if values}


def _characteristic_sql_match(name: str, value: str, *, is_postgres: bool, suffix: str):
    """
    Товар підходить, якщо значення є:
    - у пласкому ключі attributes->>'Виробник' / json_extract($.Виробник)
    - або в масиві attributes->'characteristics' як {name, value}
    """
    name_key = f"cn_{suffix}"
    value_key = f"cv_{suffix}"
    pattern = f"%{_escape_ilike(value.strip())}%"
    if is_postgres:
        sql = text(
            f"""
            (
              lower(CAST(products.attributes AS jsonb) ->> :{name_key})
                  LIKE lower(:{value_key}) ESCAPE '\\'
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  CASE
                    WHEN jsonb_typeof(
                      COALESCE(CAST(products.attributes AS jsonb)->'characteristics', '[]'::jsonb)
                    ) = 'array'
                    THEN COALESCE(CAST(products.attributes AS jsonb)->'characteristics', '[]'::jsonb)
                    ELSE '[]'::jsonb
                  END
                ) AS elem
                WHERE elem->>'name' = :{name_key}
                  AND lower(COALESCE(elem->>'value', ''))
                      LIKE lower(:{value_key}) ESCAPE '\\'
              )
            )
            """
        )
    else:
        sql = text(
            f"""
            (
              lower(CAST(
                json_extract(products.attributes, '$."' || replace(:{name_key}, '"', '') || '"')
                AS TEXT
              )) LIKE lower(:{value_key}) ESCAPE '\\'
              OR EXISTS (
                SELECT 1
                FROM json_each(
                  CASE
                    WHEN json_type(json_extract(products.attributes, '$.characteristics')) = 'array'
                    THEN json_extract(products.attributes, '$.characteristics')
                    ELSE '[]'
                  END
                ) AS je
                WHERE json_extract(je.value, '$.name') = :{name_key}
                  AND lower(CAST(json_extract(je.value, '$.value') AS TEXT))
                      LIKE lower(:{value_key}) ESCAPE '\\'
              )
            )
            """
        )
    return sql.bindparams(
        bindparam(name_key, name),
        bindparam(value_key, pattern),
    )


def _apply_characteristic_filters(
    stmt,
    char_filters: Optional[Dict[str, List[str]]],
    *,
    is_postgres: bool,
):
    """AND між різними характеристиками, OR між кількома значеннями однієї."""
    if not char_filters:
        return stmt
    for name_idx, (name, values) in enumerate(char_filters.items()):
        parts = []
        for value_idx, raw in enumerate(values):
            text_value = (raw or "").strip()
            if not text_value:
                continue
            parts.append(
                _characteristic_sql_match(
                    name,
                    text_value,
                    is_postgres=is_postgres,
                    suffix=f"{name_idx}_{value_idx}",
                )
            )
        if parts:
            stmt = stmt.where(or_(*parts) if len(parts) > 1 else parts[0])
    return stmt


def _iter_characteristic_pairs(raw) -> List[Tuple[str, str]]:
    """З attributes JSON: масив characteristics + пласкі ключі (без службових)."""
    pairs: List[Tuple[str, str]] = []
    if not isinstance(raw, dict):
        return pairs
    chars = raw.get("characteristics")
    if isinstance(chars, list):
        for item in chars:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            value = item.get("value")
            if isinstance(value, (list, dict)):
                continue
            text_value = "" if value is None else str(value).strip()
            if name and text_value:
                pairs.append((name, text_value))
    for key, value in raw.items():
        name = str(key).strip()
        if name.lower() in _ATTR_META_KEYS:
            continue
        if isinstance(value, (list, dict)):
            continue
        text_value = "" if value is None else str(value).strip()
        if name and text_value:
            pairs.append((name, text_value))
    return pairs


def _apply_pim_filters(
    stmt,
    *,
    main_categories: Optional[List[str]] = None,
    niches: Optional[List[str]] = None,
    seasons: Optional[List[str]] = None,
    genders: Optional[List[str]] = None,
    sub_categories: Optional[List[str]] = None,
    ai_only: bool = False,
):
    """Накладає PIM-фільтри (OR всередині списку, AND між різними полями)."""
    stmt = stmt.where(
        Product.status.notin_((ProductStatus.deleted, ProductStatus.archived))
    )
    if ai_only:
        stmt = stmt.where(Product.is_ai_processed.is_(True))
    category_cond = _ilike_any(Product.category, main_categories)
    if category_cond is not None:
        stmt = stmt.where(category_cond)
    niche_cond = _ilike_any(Product.target_niche, niches)
    if niche_cond is not None:
        stmt = stmt.where(niche_cond)
    season_cond = _ilike_any(Product.season, seasons)
    if season_cond is not None:
        stmt = stmt.where(season_cond)
    gender_cond = _ilike_any(Product.gender, genders)
    if gender_cond is not None:
        stmt = stmt.where(gender_cond)
    sub_cond = _ilike_any(Product.sub_category, sub_categories)
    if sub_cond is not None:
        stmt = stmt.where(sub_cond)
    return stmt


def _catalog_visibility_filter(stmt):
    """
    Каталог MiniApp: активні, ще не розпарсені (pending) або вже з AI-полями.
    Без цього AI-товари зі status=inactive зникали зі стрічки, але лишались у лічильниках.
    """
    return stmt.where(
        or_(
            Product.status == ProductStatus.active,
            Product.ai_status == ProductAIStatus.pending,
            Product.is_ai_processed.is_(True),
        )
    )


def _apply_search_and_supplier_filters(
    stmt,
    *,
    search: Optional[str],
    supplier_id: Optional[int],
):
    """
    Глобальний текстовий пошук (?search=) та вітрина магазину (?supplier_id=).

    Пошук — OR через ilike (без регістру) по полях name / description /
    supplier_sku / brand / model. Артикул і бренд включені, бо UI пошуку
    обіцяє «Пошук товарів, артикул...». Спецсимволи % та _ екрануються
    через _escape_ilike, тож запит "50%" шукається буквально.
    Порожній search (або лиш пробіли) фільтр не додає.
    """
    text_value = (search or "").strip()
    if text_value:
        pattern = f"%{_escape_ilike(text_value)}%"
        stmt = stmt.where(
            or_(
                Product.name.ilike(pattern, escape="\\"),
                Product.description.ilike(pattern, escape="\\"),
                Product.supplier_sku.ilike(pattern, escape="\\"),
                Product.brand.ilike(pattern, escape="\\"),
                Product.model.ilike(pattern, escape="\\"),
            )
        )
    if supplier_id is not None:
        stmt = stmt.where(Product.supplier_id == supplier_id)
    return stmt


class ProductWithShareURL(ProductAPI):
    share_url: str


class ProductListResponse(BaseModel):
    items: List[ProductWithShareURL] = []
    total: int = 0


def _build_product_with_share(product: Product) -> ProductWithShareURL:
    """
    Валідує ORM-об'єкт Product у ProductWithShareURL.
    Варіанти та опції МАЮТЬ бути вже eager-loaded (selectinload) до виклику
    цієї функції, інакше впадемо в MissingGreenlet (AsyncSession).

    `option_value_ids` на ProductVariant — це не колонка, а relationship
    (option_values), тож `model_validate` не заповнює його автоматично.
    Тому збираємо варіанти вручну (той самий підхід, що і в
    handlers/client_handlers.py).
    """
    product_api = ProductAPI.model_validate(product)
    attrs = product.attributes if isinstance(product.attributes, dict) else {}
    tags = attrs.get("search_tags")
    if isinstance(tags, list):
        product_api.search_tags = [str(tag).strip() for tag in tags if str(tag).strip()]
    # Сирі цифрові ID MyDrop не віддаємо в MiniApp — лише AI-тексти.
    if not getattr(product, "is_ai_processed", False):
        product_api.category = None
        product_api.sub_category = None
        product_api.season = None
        product_api.target_niche = None
        product_api.gender = None
        product_api.attributes = None
        product_api.search_tags = None

    variants_api: List[ProductVariantAPI] = []
    for variant in product.variants:
        variant_api = ProductVariantAPI.model_validate(variant)
        variant_api.option_value_ids = [ov.id for ov in (variant.option_values or [])]
        variants_api.append(variant_api)
    product_api.variants = variants_api

    share_url = f"https://t.me/TavernaBot/app?startapp=product_{product.id}"

    # [ФІКС] `sku` має alias='supplier_sku' у ProductAPI (api_models.py).
    # Без `by_alias=True` model_dump() віддає ключ "sku", а конструктор
    # ProductWithShareURL(**dict) валідує вхід САМЕ по аліасу і вимагає
    # ключ "supplier_sku" -> звідси "Field required: supplier_sku".
    # by_alias=True гарантує, що всі required-поля прийдуть під тими
    # іменами, які очікує Pydantic-модель.
    product_dict = product_api.model_dump(by_alias=True)
    product_dict["share_url"] = share_url
    supplier = getattr(product, "supplier", None)
    product_dict["supplier_name"] = getattr(supplier, "name", None) if supplier else None
    return ProductWithShareURL(**product_dict)


@router.get("/categories", response_model=List[CategoryAPI])
async def get_ai_categories(db: AsyncSession = Depends(get_db)):
    """
    Меню категорій для MiniApp: унікальні AI-назви
    (Одяг, Взуття...), з нішами і підкатегоріями.
    Сирі MyDrop ID сюди не потрапляють.
    """
    try:
        stmt = (
            select(
                Product.category,
                Product.target_niche,
                Product.sub_category,
                func.count(Product.id),
            )
            .where(
                Product.is_ai_processed.is_(True),
                Product.status.notin_((ProductStatus.deleted, ProductStatus.archived)),
                Product.category.isnot(None),
                Product.category != "",
            )
            .group_by(Product.category, Product.target_niche, Product.sub_category)
            .order_by(Product.category.asc(), Product.target_niche.asc(), Product.sub_category.asc())
        )
        result = await db.execute(stmt)
        rows = result.all()

        grouped: dict[str, dict] = {}
        for category_name, niche_name, sub_name, count in rows:
            name = (category_name or "").strip()
            if not name:
                continue
            bucket = grouped.setdefault(name, {"count": 0, "subs": {}, "niches": {}})
            n = int(count or 0)
            bucket["count"] += n
            sub = (sub_name or "").strip()
            if sub:
                bucket["subs"][sub] = bucket["subs"].get(sub, 0) + n
            niche = (niche_name or "").strip()
            if niche:
                niche_bucket = bucket["niches"].setdefault(niche, {"count": 0, "subs": {}})
                niche_bucket["count"] += n
                if sub:
                    niche_bucket["subs"][sub] = niche_bucket["subs"].get(sub, 0) + n

        categories = [
            CategoryAPI(
                name=name,
                count=data["count"],
                subcategories=[
                    CategorySubAPI(name=sub_name, count=sub_count)
                    for sub_name, sub_count in sorted(data["subs"].items())
                ],
                niches=[
                    CategoryNicheAPI(
                        name=niche_name,
                        count=niche_data["count"],
                        subcategories=[
                            CategorySubAPI(name=sub_name, count=sub_count)
                            for sub_name, sub_count in sorted(niche_data["subs"].items())
                        ],
                    )
                    for niche_name, niche_data in sorted(data["niches"].items())
                ],
            )
            for name, data in grouped.items()
        ]
        categories.sort(key=lambda item: item.name)
        return categories

    except Exception as e:
        logger.error(f"Error in get_ai_categories: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/filters", response_model=ProductFiltersAPI)
async def get_product_filters(
    niche: Optional[List[str]] = Query(
        None,
        description="Ніша. Рядок, CSV або кілька: ?niche=Мілітарі&niche=Дім",
    ),
    season: Optional[List[str]] = Query(
        None,
        description="Сезон. Рядок, CSV або кілька: ?season=Зима&season=Літо",
    ),
    main_category: Optional[List[str]] = Query(
        None,
        description="Головна AI-категорія. Рядок, CSV або кілька: ?main_category=Одяг",
    ),
    gender: Optional[List[str]] = Query(
        None,
        description="Стать. Рядок, CSV або кілька: ?gender=Чоловічий",
    ),
    target_niche: Optional[List[str]] = Query(
        None,
        description="Аліас параметра niche (зворотна сумісність)",
    ),
    category: Optional[List[str]] = Query(
        None,
        description="Аліас параметра main_category (зворотна сумісність)",
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Унікальні PIM-значення для панелі фільтрів MiniApp,
    динамічні лічильники підкатегорій і JSON-характеристики
    (dynamic_filters) у межах вибраної категорії/ніші.
    """
    try:
        niches_filter = _merge_query_lists(niche, target_niche)
        seasons_filter = _normalize_query_list(season)
        categories_filter = _merge_query_lists(main_category, category)
        genders_filter = _normalize_query_list(gender)

        async def _distinct(column) -> list[str]:
            stmt = (
                select(column)
                .where(
                    Product.is_ai_processed.is_(True),
                    Product.status.notin_((ProductStatus.deleted, ProductStatus.archived)),
                    column.isnot(None),
                    column != "",
                )
                .distinct()
                .order_by(column.asc())
            )
            values = (await db.execute(stmt)).scalars().all()
            return [str(v).strip() for v in values if v and str(v).strip()]

        niches = await _distinct(Product.target_niche)
        seasons = await _distinct(Product.season)
        genders = await _distinct(Product.gender)

        total_stmt = select(func.count(Product.id))
        total_stmt = _apply_pim_filters(
            total_stmt,
            main_categories=categories_filter,
            niches=niches_filter,
            seasons=seasons_filter,
            genders=genders_filter,
            ai_only=True,
        )
        total = int((await db.execute(total_stmt)).scalar_one() or 0)

        subs_stmt = select(Product.sub_category, func.count(Product.id)).where(
            Product.sub_category.isnot(None),
            Product.sub_category != "",
        )
        subs_stmt = _apply_pim_filters(
            subs_stmt,
            main_categories=categories_filter,
            niches=niches_filter,
            seasons=seasons_filter,
            genders=genders_filter,
            ai_only=True,
        )
        subs_stmt = subs_stmt.group_by(Product.sub_category).order_by(Product.sub_category.asc())
        sub_rows = (await db.execute(subs_stmt)).all()
        sub_categories = [
            CategorySubAPI(name=str(name).strip(), count=int(count or 0))
            for name, count in sub_rows
            if name and str(name).strip()
        ]

        categories = await _distinct(Product.category)

        attrs_stmt = select(Product.attributes).where(
            Product.attributes.isnot(None),
        )
        attrs_stmt = _apply_pim_filters(
            attrs_stmt,
            main_categories=categories_filter,
            niches=niches_filter,
            seasons=seasons_filter,
            genders=genders_filter,
            ai_only=True,
        )
        attr_rows = (await db.execute(attrs_stmt)).scalars().all()
        attr_map: dict[str, set[str]] = {}
        for raw in attr_rows:
            for name, text_value in _iter_characteristic_pairs(raw):
                attr_map.setdefault(name, set()).add(text_value)

        attributes = [
            FilterAttributeAPI(name=name, values=sorted(values))
            for name, values in sorted(attr_map.items())
        ]
        dynamic_filters = [
            DynamicFilterAPI(name=name, options=sorted(values))
            for name, values in sorted(attr_map.items())
        ]
        return ProductFiltersAPI(
            target_niche=niches,
            season=seasons,
            gender=genders,
            attributes=attributes,
            sub_categories=sub_categories,
            total=total,
            categories=categories,
            dynamic_filters=dynamic_filters,
        )
    except Exception as e:
        logger.error(f"Error in get_product_filters: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/", response_model=ProductListResponse)
async def get_all_products(
    request: Request,
    category: Optional[List[str]] = Query(None, description="AI головна категорія, напр. Одяг"),
    main_category: Optional[List[str]] = Query(None, description="Аліас category"),
    sub_category: Optional[List[str]] = Query(None, description="AI підкатегорія"),
    season: Optional[List[str]] = Query(None, description="Сезон: Зима / Літо / Демісезон / Всесезон"),
    target_niche: Optional[List[str]] = Query(None, description="Ніша: Мілітарі / Дім / Електроніка"),
    niche: Optional[List[str]] = Query(None, description="Аліас target_niche"),
    gender: Optional[List[str]] = Query(None, description="Стать: Чоловічий / Жіночий / Унісекс"),
    search: Optional[str] = Query(None, description="Глобальний текстовий пошук по назві, опису, артикулу, бренду, моделі", max_length=200),
    supplier_id: Optional[int] = Query(None, ge=1, description="Вітрина конкретного магазину: лише товари цього постачальника"),
    limit: int = Query(50, ge=1, le=100, description="Скільки товарів віддати (захист від зависання)"),
    offset: int = Query(0, ge=0, description="Зсув для наступної сторінки"),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns a list of all products with share URLs for the Mini App.
    Each product includes a share_url field that points to the product in the Telegram bot.
    Фільтри category / sub_category / season / niche працюють по текстових AI-полях.
    Динамічні характеристики: ?char_Виробник=Китай (JSON attributes / characteristics).
    Глобальний пошук: ?search=рукавички (ilike, без регістру) — name/description/supplier_sku/brand/model.
    Вітрина магазину: ?supplier_id=5 — лише товари цього постачальника.
    Кожен параметр можна передати як один рядок, CSV або кілька повторів.

    Пагінація обов'язкова: без limit сервер зависав на 1000+ товарів.
    Відповідь: {"items": [...], "total": X}.
    """
    try:
        filter_kwargs = dict(
            main_categories=_merge_query_lists(main_category, category),
            niches=_merge_query_lists(niche, target_niche),
            seasons=_normalize_query_list(season),
            genders=_normalize_query_list(gender),
            sub_categories=_normalize_query_list(sub_category),
        )
        char_filters = _parse_char_filters(request.query_params)
        is_postgres = _session_is_postgres(db)

        count_stmt = select(func.count(Product.id))
        count_stmt = _apply_pim_filters(count_stmt, **filter_kwargs)
        count_stmt = _apply_characteristic_filters(
            count_stmt, char_filters, is_postgres=is_postgres
        )
        count_stmt = _apply_search_and_supplier_filters(
            count_stmt, search=search, supplier_id=supplier_id
        )
        count_stmt = _catalog_visibility_filter(count_stmt)
        total = int((await db.execute(count_stmt)).scalar_one() or 0)

        stmt = select(Product).options(
            selectinload(Product.supplier),
            selectinload(Product.variants).selectinload(ProductVariant.option_values),
            selectinload(Product.options).selectinload(ProductOption.values),
        )
        stmt = _apply_pim_filters(stmt, **filter_kwargs)
        stmt = _apply_characteristic_filters(stmt, char_filters, is_postgres=is_postgres)
        stmt = _apply_search_and_supplier_filters(
            stmt, search=search, supplier_id=supplier_id
        )
        stmt = _catalog_visibility_filter(stmt)
        stmt = stmt.order_by(Product.id.desc()).offset(offset).limit(limit)
        result = await db.execute(stmt)
        products = result.scalars().unique().all()

        products_with_share = []
        for product in products:
            try:
                products_with_share.append(_build_product_with_share(product))
            except Exception as e:
                logger.error(f"Помилка валідації Pydantic для Product ID {product.id}: {e}")
                continue  # Пропускаємо битий товар, решту каталогу не ламаємо

        return ProductListResponse(items=products_with_share, total=total)

    except Exception as e:
        logger.error(f"Error in get_all_products: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


def _attr_text(raw: Optional[Dict[str, Any]], key: str) -> str:
    if not isinstance(raw, dict):
        return ""
    return str(raw.get(key) or "").strip()


def _first_product_image(product: Product) -> Optional[str]:
    images = _product_images_list(product)
    return images[0] if images else None


def _product_images_list(product: Product) -> List[str]:
    """Усі медіа товару (фото/гіфки/відео), без порожніх/дублікатних значень."""
    result: List[str] = []
    seen: set = set()

    def _add_all(raw) -> None:
        if not isinstance(raw, list):
            return
        for url in raw:
            text = str(url or "").strip()
            if text and text not in seen:
                seen.add(text)
                result.append(text)

    _add_all(product.pictures)
    attrs = product.attributes if isinstance(product.attributes, dict) else {}
    _add_all(attrs.get("media_urls"))
    return result


def _product_color_label(product: Product) -> str:
    attrs = product.attributes if isinstance(product.attributes, dict) else {}
    shade = str(attrs.get("color") or "").strip()
    if shade:
        return shade
    pairs = attrs.get("characteristics")
    if isinstance(pairs, list):
        for pair in pairs:
            if not isinstance(pair, dict):
                continue
            name = str(pair.get("name") or "").strip().casefold()
            if name in {"колір", "цвет", "color", "забарвлення"}:
                value = str(pair.get("value") or "").strip()
                if value:
                    return value
    for key, value in attrs.items():
        if str(key).strip().casefold() not in {"колір", "цвет", "color", "забарвлення"}:
            continue
        if value is None or isinstance(value, (list, dict)):
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


@router.get("/{product_id}/colors", response_model=List[ProductColorVariantAPI])
async def get_product_color_variants(product_id: int, db: AsyncSession = Depends(get_db)):
    """
    Інші кольори тієї ж моделі: той самий supplier_id і attributes.base_model_name.
    Кожен колір — окремий товар (окремий пост постачальника).
    """
    try:
        product = (
            await db.execute(select(Product).where(Product.id == product_id))
        ).scalars().one_or_none()
        if product is None:
            raise HTTPException(status_code=404, detail="Товар не знайдено")
        status_value = product.status.value if hasattr(product.status, "value") else str(product.status)
        if status_value in (ProductStatus.deleted.value, ProductStatus.archived.value):
            raise HTTPException(status_code=404, detail="Товар не знайдено")

        attrs = product.attributes if isinstance(product.attributes, dict) else {}
        model_name = _attr_text(attrs, "base_model_name")
        if not model_name or not product.supplier_id:
            return []

        # Смарт-склейка (fuzzy match) ПОВНІСТЮ на Python-стороні, а не в SQL.
        # SQLite (використовується локально/у деяких деплоях) не вміє
        # нормально робити ilike/lower по значеннях всередині JSON-колонки
        # (attributes) — SQL-варіант мовчки не знаходив збігів. Тому просто
        # тягнемо останні активні товари цього постачальника і фільтруємо
        # їх у Python — це працює однаково і на SQLite, і на Postgres.
        model_prefix = model_name.strip()[:15].lower()

        stmt = (
            select(Product)
            .where(
                Product.supplier_id == product.supplier_id,
                Product.status.notin_((ProductStatus.deleted, ProductStatus.archived)),
            )
            .order_by(Product.id.desc())
            .limit(200)
        )
        all_supplier_products = (await db.execute(stmt)).scalars().unique().all()

        def _base_model_prefix(item: Product) -> str:
            item_attrs = item.attributes if isinstance(item.attributes, dict) else {}
            return _attr_text(item_attrs, "base_model_name")[:15].lower().strip()

        siblings = [p for p in all_supplier_products if _base_model_prefix(p) == model_prefix]
        siblings.sort(key=lambda item: item.id)

        ordered: List[Product] = []
        seen_ids = set()
        current = next((item for item in siblings if item.id == product.id), product)
        for item in [current, *siblings]:
            if item.id in seen_ids:
                continue
            seen_ids.add(item.id)
            ordered.append(item)

        return [
            ProductColorVariantAPI(
                product_id=item.id,
                color=_product_color_label(item),
                image_url=_first_product_image(item),
                images=_product_images_list(item),
            )
            for item in ordered
        ]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_product_color_variants ({product_id}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{product_id}", response_model=ProductWithShareURL)
async def get_product_by_id(product_id: int, db: AsyncSession = Depends(get_db)):
    """
    Повертає ОДИН товар за його ID разом з варіантами та опціями.
    Потрібен для сторінки товару (ProductDetail.tsx) на фронтенді, щоб не
    тягнути весь каталог лише для показу однієї картки товару.
    """
    try:
        stmt = (
            select(Product)
            .where(Product.id == product_id)
            .options(
                selectinload(Product.supplier),
                selectinload(Product.variants).selectinload(ProductVariant.option_values),
                selectinload(Product.options).selectinload(ProductOption.values),
            )
        )
        result = await db.execute(stmt)
        product = result.scalars().unique().one_or_none()

        if product is None:
            raise HTTPException(status_code=404, detail="Товар не знайдено")
        status_value = product.status.value if hasattr(product.status, "value") else str(product.status)
        if status_value in (ProductStatus.deleted.value, ProductStatus.archived.value):
            raise HTTPException(status_code=404, detail="Товар не знайдено")

        return _build_product_with_share(product)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_product_by_id ({product_id}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
