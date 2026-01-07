# handlers/admin_handlers.py
import logging
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Body, status
from aiogram import Bot
from sqlalchemy.future import select
from sqlalchemy import update, or_
from pydantic import BaseModel, EmailStr
from typing import List, Optional

from database.db import get_db, AsyncSession
from database.models import (
    User, Supplier, Channel, SupplierType, SupplierStatus, UserRole, 
    PriceRule, PriceRuleType, Product # <-- НОВІ ІМПОРТИ
)
from config_reader import config
from web_app import get_bot_instance
# --- ОНОВЛЕНІ ІМПОРТИ (План 23) ---
from services.auth_service import get_current_admin_user 
from services import gemini_service, publisher_service, omnichannel_service
from api_models import * # (Ми це зробили в минулому кроці)

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/api/v1/admin", 
    tags=["Admin (God Mode)"],
    dependencies=[Depends(get_current_admin_user)] 
)

# --- API Endpoints (Фаза 3.10) ---

@router.get("/pending-suppliers", response_model=List[SupplierAdminResponse])
async def get_pending_suppliers(db: AsyncSession = Depends(get_db)):
    """
    (План 22) Отримати список постачальників, які очікують
    на схвалення (проаналізовані AI).
    """
    stmt = select(Supplier).where(
        Supplier.status == SupplierStatus.pending_admin_approval
    ).order_by(Supplier.created_at.asc())
    
    result = await db.execute(stmt)
    suppliers = result.scalars().all()
    return suppliers

@router.post("/approve-supplier/{supplier_id}", response_model=SupplierAdminResponse)
async def approve_supplier(supplier_id: int, db: AsyncSession = Depends(get_db)):
    """
    (План 22) "Схвалити" постачальника.
    """
    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
        
    supplier.status = SupplierStatus.active # <-- АКТИВАЦІЯ
    await db.commit()
    await db.refresh(supplier)
    
    # TODO: Надіслати сповіщення постачальнику (на email), що його схвалено
    logger.info(f"Адмін схвалив Постачальника ID: {supplier_id}")
    return supplier

@router.post("/reject-supplier/{supplier_id}", response_model=SupplierAdminResponse)
async def reject_supplier(supplier_id: int, db: AsyncSession = Depends(get_db)):
    """
    (План 22) "Відхилити" постачальника.
    """
    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
        
    supplier.status = SupplierStatus.rejected # <-- ВІДХИЛЕНО
    await db.commit()
    await db.refresh(supplier)

    # TODO: Надіслати сповіщення постачальнику (на email), чому відхилено
    logger.info(f"Адмін відхилив Постачальника ID: {supplier_id}")
    return supplier

@router.post("/manual-add-supplier", response_model=SupplierResponse)
async def manual_add_supplier(
    request_data: AdminManualAddRequest,
    current_admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    """
    (План 23) Адмін вручну додає постачальника (напр. LandLiz).
    Система АВТОМАТИЧНО створює "User" акаунт для його менеджера.
    """
    logger.info(f"Адмін {current_admin.id} вручну додає: {request_data.supplier_name}")
    
    # 1. Перевірка на дублікат URL (План 21)
    source_url = request_data.xml_url or request_data.shop_url
    if source_url:
        existing = await db.execute(select(Supplier).where(or_(Supplier.xml_url == source_url, Supplier.shop_url == source_url)))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Магазин з таким URL вже існує.")
            
    # 2. Створюємо "віртуальний" User акаунт для менеджера
    manager_email = request_data.contact_email
    manager_user = (await db.execute(select(User).where(User.email == manager_email))).scalar_one_or_none()
    
    if not manager_user:
        # Створюємо юзера з тимчасовим/рандомним паролем
        temp_password = get_password_hash(f"temp_{uuid.uuid4().hex}")
        manager_user = User(
            email=manager_email.lower(),
            password_hash=temp_password,
            first_name=request_data.supplier_name, # Використовуємо назву магазину як ім'я
            role=UserRole.supplier,
            telegram_id=None # Менеджер ще не прив'язав Telegram
        )
        db.add(manager_user)
        await db.flush() # Отримуємо manager_user.id
        
    # 3. Створюємо Постачальника і одразу прив'язуємо до менеджера
    new_supplier = Supplier(
        user_id=manager_user.id,
        key=request_data.supplier_name.lower().replace(' ', '_') + f"_{manager_user.id}",
        name=request_data.supplier_name,
        type=request_data.supplier_type,
        xml_url=str(request_data.xml_url),
        shop_url=str(request_data.shop_url),
        contact_email=manager_email,
        status=SupplierStatus.pending_ai_analysis, # Відправляємо на AI-аналіз
        # ФОП/ІПН поля (legal_name, ipn, edrpou) залишаються NULL, 
        # менеджер заповнить їх сам, коли "прийме" акаунт
    )
    db.add(new_supplier)
    await db.commit()
    await db.refresh(new_supplier)
    
    # TODO: Запустити AI-Аналіз (Фаза 3.9)
    # asyncio.create_task(ai_agent_service.run_ai_onboarding_analysis(new_supplier.id, bot))
    
    logger.info(f"Адмін успішно додав {new_supplier.name}. Акаунт менеджера ({manager_email}) створено.")
    return new_supplier
    
@router.post("/transfer-supplier/{supplier_id}", response_model=SupplierResponse)
async def transfer_supplier_ownership(
    supplier_id: int,
    request_data: AdminTransferRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    (План 23) "Передати Управління".
    Знаходить Постачальника, знаходить/створює нового Менеджера
    і "пере-прив'язує" `supplier.user_id` до нього.
    """
    logger.info(f"Адмін: передача управління {supplier_id} на {request_data.new_manager_email}")
    
    # 1. Знаходимо постачальника
    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
        
    # 2. Знаходимо/Створюємо нового менеджера
    new_manager_email = request_data.new_manager_email.lower()
    new_manager = (await db.execute(select(User).where(User.email == new_manager_email))).scalar_one_or_none()
    
    if not new_manager:
        temp_password = get_password_hash(f"temp_{uuid.uuid4().hex}")
        new_manager = User(
            email=new_manager_email,
            password_hash=temp_password,
            first_name=supplier.name, # Ім'я = назва магазину
            role=UserRole.supplier
        )
        db.add(new_manager)
        await db.flush()
    
    # 3. "Пере-прив'язуємо"
    supplier.user_id = new_manager.id
    supplier.contact_email = new_manager.email # Оновлюємо контактний email
    
    await db.commit()
    await db.refresh(supplier)
    
    # TODO: Надіслати email новому менеджеру з посиланням на "скидання пароля"
    
    logger.info(f"Управління {supplier.name} передано User {new_manager.id}")
    return supplier

@router.get("/price-rules", response_model=List[PriceRuleResponse])
async def get_price_rules(db: AsyncSession = Depends(get_db)):
    """
    (План 27G) "God Mode": Отримати всі правила Націнок.
    """
    stmt = select(PriceRule).order_by(PriceRule.priority.asc())
    result = await db.execute(stmt)
    rules = result.scalars().all()
    return rules

@router.post("/price-rules", response_model=PriceRuleResponse)
async def create_price_rule(
    rule_data: PriceRuleRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    (План 27G) "God Mode": Створити нове правило Націнки.
    """
    new_rule = PriceRule(**rule_data.dict())
    db.add(new_rule)
    await db.commit()
    await db.refresh(new_rule)
    logger.info(f"Адмін додав нове правило націнки: {new_rule.name}")
    return new_rule
    
# TODO: Додати endpoints для /update-price-rule/{id} та /delete-price-rule/{id}

@router.post("/force-sync-prom/{supplier_id}", response_model=Dict[str, str])
async def force_sync_supplier_to_prom(
    supplier_id: int,
    current_admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db)
):
    """
    (План 27/Gantt 3) "God Mode": Адмін примусово синхронізує
    XML-фід постачальника (MyDrop) з Prom.ua.
    """
    logger.info(f"Адмін: Примусова синхронізація Prom.ua для Supplier ID: {supplier_id}")
    
    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    if supplier.type != SupplierType.mydrop or not supplier.xml_url:
        raise HTTPException(status_code=400, detail="This supplier is not a MyDrop provider or has no XML URL.")
        
    # Запускаємо "Виконавця" Prom.ua
    result = await omnichannel_service.omnichannel_service.sync_supplier_xml_to_prom(supplier)
    
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message"))
        
    return result

@router.post("/force-post", response_model=Dict[str, str])
async def force_publish_post(
    request_data: AdminForcePostRequest,
    bot: Bot = Depends(get_bot_instance),
    db: AsyncSession = Depends(get_db)
):
    """
    (План 23) "God Mode": Адмін примусово постить товар (безкоштовно)
    в обхід "Черги".
    """
    logger.info(f"Адмін: Примусовий постинг Product ID: {request_data.product_id}")
    
    product = await db.get(Product, request_data.product_id, options=[selectinload(Product.variants)])
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    # Запускаємо "Виконавця" напряму
    asyncio.create_task(
        publisher_service.publish_product_to_telegram(product, bot)
    )
    
    return {"status": "success", "message": f"Примусовий постинг для {product.sku} запущено."}

@router.post("/force-advertise", response_model=Dict[str, str])
async def force_advertise_post(
    request_data: AdminForceAdRequest,
    bot: Bot = Depends(get_bot_instance),
    db: AsyncSession = Depends(get_db)
):
    """
    (План 23/27) "God Mode": Адмін примусово запускає рекламу (безкоштовно)
    на *своїх* сервісах.
    """
    logger.info(f"Адмін: Примусова реклама Product ID: {request_data.product_id}")
    
    product = (await db.execute(
        select(Product).where(Product.id == request_data.product_id)
        .options(selectinload(Product.supplier))
    )).scalar_one_or_none()
    
    if not product or not product.supplier:
        raise HTTPException(status_code=404, detail="Product or its Supplier not found")
        
    # Імітуємо створення "PaidService" (але він $0.00)
    # (Ми не створюємо його в БД, а просто викликаємо ads_service)
    
    # Імітуємо об'єкт service для ads_service
    class MockService:
        def __init__(self, product_id, platforms, days):
            self.service_uid = f"ADMIN-AD-{product_id}"
            self.amount = 0 # Безкоштовно
            self.details = {"days": days, "platforms": platforms}
    
    mock_service = MockService(request_data.product_id, request_data.platforms, request_data.days)
    
    # Запускаємо "Виконавця" Реклами
    asyncio.create_task(
        # --- ОНОВЛЕНО ---
        omnichannel_service.omnichannel_service.execute_paid_ad_campaign(
            bot=bot,
            service=mock_service,
            product=product,
            supplier=product.supplier
        )
    )
    
    return {"status": "success", "message": f"Примусову рекламу для {product.sku} запущено."}