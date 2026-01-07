# handlers/supplier_dashboard_handlers.py
import logging
import uuid 
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.future import select
from sqlalchemy import func, update # <-- НОВИЙ ІМПОРТ
from sqlalchemy.orm import selectinload
from typing import List, Dict, Any
from datetime import datetime

from database.db import get_db, AsyncSession
from database.models import (
    User, Supplier, Order, Product, OrderStatus, ProductVariant, 
    ProductOption, ProductOptionValue,
    PaidService, PaidServiceType, PaidServiceStatus 
)
from services.auth_service import get_current_supplier_or_admin
from services import payment_service
from services import ads_service # <-- НОВИЙ ІМПОРТ
# Імпортуємо Pydantic-моделі з `api_models.py`
from api_models import (
    ProductAPI, SupplierStatsResponse, SupplierOrderResponse,
    RequestPaidPostRequest,
    PlatformResponse, RequestPaidAdRequest # <-- НОВІ ІМПОРТИ
)


logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/api/v1/supplier", 
    tags=["Supplier Dashboard (Cabinet)"],
    dependencies=[Depends(get_current_supplier_or_admin)]
)

# --- API Endpoints ---

@router.get("/stats", response_model=SupplierStatsResponse)
async def get_supplier_stats(
    current_user: User = Depends(get_current_supplier_or_admin),
    db: AsyncSession = Depends(get_db)
):
    # ... (код без змін) ...
    supplier = (await db.execute(select(Supplier).where(Supplier.user_id == current_user.id))).scalar_one_or_none()
    if not supplier: raise HTTPException(status_code=404, detail="Supplier profile not found for this user.")
    pending_orders_q = await db.execute(select(func.count(Order.id)).where((Order.supplier_id == supplier.id) & (Order.status.in_([OrderStatus.new, OrderStatus.confirmed]))))
    completed_orders_q = await db.execute(select(func.count(Order.id)).where((Order.supplier_id == supplier.id) & (Order.status == OrderStatus.completed)))
    total_products_q = await db.execute(select(func.count(Product.id)).where(Product.supplier_id == supplier.id))
    return SupplierStatsResponse(
        pending_orders=pending_orders_q.scalar(),
        completed_orders=completed_orders_q.scalar(),
        total_products=total_products_q.scalar(),
        total_earned=0 
    )

@router.get("/my-orders", response_model=List[SupplierOrderResponse])
async def get_supplier_orders(
    current_user: User = Depends(get_current_supplier_or_admin),
    db: AsyncSession = Depends(get_db)
):
    # ... (код без змін) ...
    supplier = (await db.execute(select(Supplier).where(Supplier.user_id == current_user.id))).scalar_one_or_none()
    if not supplier: raise HTTPException(status_code=404, detail="Supplier profile not found.")
    stmt = select(Order).where((Order.supplier_id == supplier.id) & (Order.parent_order_id.isnot(None))).order_by(Order.created_at.desc()).limit(50)
    result = await db.execute(stmt)
    orders = result.scalars().all()
    return orders

@router.get("/my-products", response_model=List[ProductAPI])
async def get_supplier_products(
    current_user: User = Depends(get_current_supplier_or_admin),
    db: AsyncSession = Depends(get_db)
):
    # ... (код без змін) ...
    supplier = (await db.execute(select(Supplier).where(Supplier.user_id == current_user.id))).scalar_one_or_none()
    if not supplier: raise HTTPException(status_code=404, detail="Supplier profile not found.")
    stmt = select(Product).where(Product.supplier_id == supplier.id).options(
        selectinload(Product.options).selectinload(ProductOption.values),
        selectinload(Product.variants).selectinload(ProductVariant.option_values)
    ).order_by(Product.name.asc()).limit(100)
    result = await db.execute(stmt)
    products = result.scalars().unique().all()
    return products

@router.post("/request-paid-post", response_model=Dict[str, str])
async def request_paid_post(
    request_data: RequestPaidPostRequest,
    current_user: User = Depends(get_current_supplier_or_admin),
    db: AsyncSession = Depends(get_db)
):
    # ... (код без змін) ...
    if not payment_service.payment_api:
        raise HTTPException(status_code=500, detail="LiqPay service is not configured")
    product = (await db.execute(select(Product).join(Supplier).where((Product.id == request_data.product_id) & (Supplier.user_id == current_user.id)))).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found or does not belong to this supplier.")

    service_uid = f"SRV-{product.id}-{uuid.uuid4().hex[:8]}"
    amount_kopecks = request_data.amount * 100
    
    new_service = PaidService(
        service_uid=service_uid,
        supplier_id=product.supplier_id,
        user_id=current_user.id,
        type=PaidServiceType.paid_post,
        status=PaidServiceStatus.pending_payment,
        product_id=product.id,
        amount=amount_kopecks
    )
    db.add(new_service)
    await db.commit()
    
    form_data = payment_service.payment_api.create_payment_form_data(
        amount=request_data.amount,
        order_uid=service_uid,
        description=f"Платний постинг: {product.name}",
        user_id=current_user.id,
        cart_items=[] 
    )
    logger.info(f"Створено рахунок {service_uid} на {request_data.amount} грн за платний пост (Product ID: {product.id})")
    return form_data

# ---
# [НОВІ ENDPOINTS - ФАЗА 5.3] (План 20/27)
# ---

@router.get("/ad-platforms", response_model=List[PlatformResponse])
async def get_ad_platforms(
    current_user: User = Depends(get_current_supplier_or_admin)
):
    """
    (План 5.3) Повертає список рекламних платформ та базових цін
    (з нашого "скелета" ads_service).
    """
    platforms = ads_service.ads_service.get_ad_platforms()
    return platforms

@router.post("/request-paid-ad", response_model=Dict[str, str])
async def request_paid_ad(
    request_data: RequestPaidAdRequest,
    current_user: User = Depends(get_current_supplier_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    (План 20/5.3) Створює "Рахунок" (PaidService) за платну рекламу
    та повертає дані `data` і `signature` для LiqPay.
    """
    if not payment_service.payment_api:
        raise HTTPException(status_code=500, detail="LiqPay service is not configured")

    # 1. Знаходимо товар і перевіряємо, що він належить цьому постачальнику
    product = (await db.execute(
        select(Product).join(Supplier)
        .where((Product.id == request_data.product_id) & (Supplier.user_id == current_user.id))
    )).scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found or does not belong to this supplier.")

    # 2. Створюємо "Рахунок" в БД
    service_uid = f"AD-{product.id}-{uuid.uuid4().hex[:8]}"
    amount_kopecks = request_data.amount * 100 # (Ціна ВЖЕ з націнкою, з frontend)
    
    new_service = PaidService(
        service_uid=service_uid,
        supplier_id=product.supplier_id,
        user_id=current_user.id,
        type=PaidServiceType.paid_ad,
        status=PaidServiceStatus.pending_payment,
        product_id=product.id,
        amount=amount_kopecks,
        # Зберігаємо деталі реклами (які платформи, скільки днів)
        details={"days": request_data.days, "platforms": request_data.platforms}
    )
    
    db.add(new_service)
    await db.commit()
    
    # 3. Готуємо форму для LiqPay (БЕЗ Checkbox)
    form_data = payment_service.payment_api.create_payment_form_data(
        amount=request_data.amount, # LiqPay приймає гривні
        order_uid=service_uid, # <-- Передаємо ID нашого "Рахунку"
        description=f"Рекламна кампанія для: {product.name}",
        user_id=current_user.id,
        cart_items=[] 
    )
    
    logger.info(f"Створено рахунок {service_uid} на {request_data.amount} грн за рекламу (Product ID: {product.id})")
    return form_data