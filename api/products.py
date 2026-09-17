from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload
from typing import List, Optional
import logging

from database.db import get_db, AsyncSessionLocal
from database.models import Product, ProductStatus, ProductAIStatus, ProductVariant, ProductOption
from api_models import (
    ProductAPI,
    ProductVariantAPI,
    CategoryAPI,
    CategorySubAPI,
    CategoryNicheAPI,
    ProductFiltersAPI,
    FilterAttributeAPI,
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
    if main_categories:
        stmt = stmt.where(Product.category.in_(main_categories))
    if niches:
        stmt = stmt.where(Product.target_niche.in_(niches))
    if seasons:
        stmt = stmt.where(Product.season.in_(seasons))
    if genders:
        stmt = stmt.where(Product.gender.in_(genders))
    if sub_categories:
        stmt = stmt.where(Product.sub_category.in_(sub_categories))
    return stmt


class ProductWithShareURL(ProductAPI):
    share_url: str


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
    # Сирі цифрові ID MyDrop не віддаємо в MiniApp — лише AI-тексти.
    if not getattr(product, "is_ai_processed", False):
        product_api.category = None
        product_api.sub_category = None
        product_api.season = None
        product_api.target_niche = None
        product_api.gender = None
        product_api.attributes = None

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
    Унікальні PIM-значення для панелі фільтрів MiniApp
    і динамічні лічильники підкатегорій під вибрані фільтри.
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

        attrs_stmt = select(Product.attributes).where(
            Product.is_ai_processed.is_(True),
            Product.status.notin_((ProductStatus.deleted, ProductStatus.archived)),
            Product.attributes.isnot(None),
        )
        attr_rows = (await db.execute(attrs_stmt)).scalars().all()
        attr_map: dict[str, set[str]] = {}
        for raw in attr_rows:
            if not isinstance(raw, dict):
                continue
            for key, value in raw.items():
                name = str(key).strip()
                text = "" if value is None else str(value).strip()
                if not name or not text:
                    continue
                attr_map.setdefault(name, set()).add(text)

        attributes = [
            FilterAttributeAPI(name=name, values=sorted(values))
            for name, values in sorted(attr_map.items())
        ]
        return ProductFiltersAPI(
            target_niche=niches,
            season=seasons,
            gender=genders,
            attributes=attributes,
            sub_categories=sub_categories,
            total=total,
        )
    except Exception as e:
        logger.error(f"Error in get_product_filters: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/", response_model=List[ProductWithShareURL])
async def get_all_products(
    category: Optional[List[str]] = Query(None, description="AI головна категорія, напр. Одяг"),
    main_category: Optional[List[str]] = Query(None, description="Аліас category"),
    sub_category: Optional[List[str]] = Query(None, description="AI підкатегорія"),
    season: Optional[List[str]] = Query(None, description="Сезон: Зима / Літо / Демісезон / Всесезон"),
    target_niche: Optional[List[str]] = Query(None, description="Ніша: Мілітарі / Дім / Електроніка"),
    niche: Optional[List[str]] = Query(None, description="Аліас target_niche"),
    gender: Optional[List[str]] = Query(None, description="Стать: Чоловічий / Жіночий / Унісекс"),
    limit: int = Query(50, ge=1, le=100, description="Скільки товарів віддати (захист від зависання)"),
    offset: int = Query(0, ge=0, description="Зсув для наступної сторінки"),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns a list of all products with share URLs for the Mini App.
    Each product includes a share_url field that points to the product in the Telegram bot.
    Фільтри category / sub_category / season / niche працюють по текстових AI-полях.
    Кожен параметр можна передати як один рядок, CSV або кілька повторів.

    Пагінація обов'язкова: без limit сервер зависав на 1000+ товарів.
    Каталог одразу після XML: ai_status=pending АБО status=active.
    """
    try:
        # Execute query to get products with variants (+ option values) and options eagerly loaded
        stmt = select(Product).options(
            selectinload(Product.supplier),
            selectinload(Product.variants).selectinload(ProductVariant.option_values),
            selectinload(Product.options).selectinload(ProductOption.values),
        )
        stmt = _apply_pim_filters(
            stmt,
            main_categories=_merge_query_lists(main_category, category),
            niches=_merge_query_lists(niche, target_niche),
            seasons=_normalize_query_list(season),
            genders=_normalize_query_list(gender),
            sub_categories=_normalize_query_list(sub_category),
        )
        stmt = stmt.where(
            or_(
                Product.ai_status == ProductAIStatus.pending,
                Product.status == ProductStatus.active,
            )
        )
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

        return products_with_share

    except Exception as e:
        logger.error(f"Error in get_all_products: {e}", exc_info=True)
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
