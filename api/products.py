from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List
import logging

from database.db import get_db, AsyncSessionLocal
from database.models import Product, ProductVariant, ProductOption
from api_models import ProductAPI, ProductVariantAPI

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/products", tags=["Products"])

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
    return ProductWithShareURL(**product_dict)


@router.get("/", response_model=List[ProductWithShareURL])
async def get_all_products(db: AsyncSession = Depends(get_db)):
    """
    Returns a list of all products with share URLs for the Mini App.
    Each product includes a share_url field that points to the product in the Telegram bot.
    """
    try:
        # Execute query to get products with variants (+ option values) and options eagerly loaded
        stmt = select(Product).options(
            selectinload(Product.variants).selectinload(ProductVariant.option_values),
            selectinload(Product.options).selectinload(ProductOption.values),
        )
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
                selectinload(Product.variants).selectinload(ProductVariant.option_values),
                selectinload(Product.options).selectinload(ProductOption.values),
            )
        )
        result = await db.execute(stmt)
        product = result.scalars().unique().one_or_none()

        if product is None:
            raise HTTPException(status_code=404, detail="Товар не знайдено")

        return _build_product_with_share(product)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_product_by_id ({product_id}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
