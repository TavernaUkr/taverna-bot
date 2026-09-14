# handlers/client_handlers.py
import logging
from fastapi import APIRouter, Depends
from sqlalchemy.future import select
# --- [ВИПРАВЛЕННЯ 3] ---
from sqlalchemy.orm import selectinload, joinedload 
# ---
from typing import List

from database.db import get_db, AsyncSession
from database.models import Product, Order, User, ProductVariant, ProductOptionValue, ProductOption
from api_models import ProductAPI, SupplierOrderResponse, ProductVariantAPI
from services.auth_service import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/client", tags=["Client SuperApp"])

# --- 1. Вкладка "НОВИНИ" ---
@router.get("/news-feed", response_model=List[ProductAPI])
async def get_news_feed(db: AsyncSession = Depends(get_db)):
    stmt = select(Product).where(Product.status == 'active')\
        .order_by(Product.created_at.desc())\
        .limit(20)\
        .options(
            # --- [ВИПРАВЛЕННЯ 3 (Eager Loading)] ---
            selectinload(Product.variants).selectinload(ProductVariant.option_values),
            selectinload(Product.options).selectinload(ProductOption.values)
            # ---
        )
    
    result = await db.execute(stmt)
    products = result.scalars().unique().all()
    
    # --- [ВИПРАВЛЕННЯ 3 (Pydantic + Variants)] ---
    # Ми маємо вручну зібрати `option_value_ids` для ProductVariantAPI,
    # бо `model_validate` не впорається з `MissingGreenlet`
    products_api = []
    for p in products:
        try:
            p_api = ProductAPI.model_validate(p) # Базова валідація
            if not getattr(p, "is_ai_processed", False):
                p_api.category = None
                p_api.sub_category = None
                p_api.season = None
                p_api.target_niche = None
                p_api.gender = None
                p_api.attributes = None
            
            # Ручне завантаження варіантів (це вирішує MissingGreenlet)
            variants_api = []
            for v in p.variants:
                v_api = ProductVariantAPI.model_validate(v)
                v_api.option_value_ids = [val.id for val in v.option_values]
                variants_api.append(v_api)
            p_api.variants = variants_api
            
            products_api.append(p_api)
        except Exception as e:
            logger.error(f"Помилка валідації Pydantic для Product ID {p.id}: {e}")
            continue # Пропускаємо битий товар
            
    return products_api

# --- 2. Вкладка "КАТАЛОГ" ---
@router.get("/catalog", response_model=List[ProductAPI])
async def get_catalog(
    category: str = None,
    sub_category: str = None,
    season: str = None,
    target_niche: str = None,
    gender: str = None,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Product).where(Product.status == 'active')
    if category:
        stmt = stmt.where(Product.category == category)
    if sub_category:
        stmt = stmt.where(Product.sub_category == sub_category)
    if season:
        stmt = stmt.where(Product.season == season)
    if target_niche:
        stmt = stmt.where(Product.target_niche == target_niche)
    if gender:
        stmt = stmt.where(Product.gender == gender)
        
    stmt = stmt.limit(50).options(
        # --- [ВИПРАВЛЕННЯ 3 (Eager Loading)] ---
        selectinload(Product.variants).selectinload(ProductVariant.option_values),
        selectinload(Product.options).selectinload(ProductOption.values)
    )
    
    result = await db.execute(stmt)
    products = result.scalars().unique().all()

    # --- [ВИПРАВЛЕННЯ 3 (Pydantic + Variants)] ---
    products_api = []
    for p in products:
        try:
            p_api = ProductAPI.model_validate(p)
            if not getattr(p, "is_ai_processed", False):
                p_api.category = None
                p_api.sub_category = None
                p_api.season = None
                p_api.target_niche = None
                p_api.gender = None
                p_api.attributes = None
            variants_api = []
            for v in p.variants:
                v_api = ProductVariantAPI.model_validate(v)
                v_api.option_value_ids = [val.id for val in v.option_values]
                variants_api.append(v_api)
            p_api.variants = variants_api
            products_api.append(p_api)
        except Exception as e:
            logger.error(f"Помилка валідації Pydantic для Product ID {p.id}: {e}")
            continue
            
    return products_api

# --- 3. Вкладка "МОЇ ЗАМОВЛЕННЯ" ---
@router.get("/my-orders", response_model=List[SupplierOrderResponse])
async def get_my_orders(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # (Цей код вже був правильний, залишаємо)
    stmt = select(Order).where(
        (Order.user_telegram_id == current_user.id) &
        (Order.parent_order_id.is_(None))
    ).order_by(Order.created_at.desc())
    
    result = await db.execute(stmt)
    return result.scalars().all()