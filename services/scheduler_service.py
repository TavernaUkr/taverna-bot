# services/scheduler_service.py
import logging
import asyncio
import random
from aiogram import Bot
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy.future import select
from sqlalchemy import func, update
from sqlalchemy.orm import selectinload

from config_reader import config
from services import publisher_service
from services import ai_agent_service # <-- НОВИЙ "МОЗОК"
from database.db import AsyncSessionLocal
from database.models import Supplier, Product, ProductVariant, SupplierStatus

logger = logging.getLogger(__name__)
_scheduler = AsyncIOScheduler(timezone="Europe/Kiev")

# --- ЗАДАЧА 1: "Черга Постингу" (Фаза 3.6 / План 20.1) ---
async def post_from_queue_job(bot: Bot):
    """
    "Розумний" планувальник (Черга).
    1. Знаходить постачальника, якого найдавніше не постили.
    2. Знаходить товар цього постачальника, який найдавніше не постили.
    3. Відправляє на публікацію.
    """
    logger.info("Планувальник 'Черга': шукаю товар для 'безкоштовного' автопостингу.")
    
    async with AsyncSessionLocal() as db:
        try:
            # 1. Знаходимо 1 АКТИВНОГО постачальника, 
            #    якого найдавніше не постили (План 20.1 "Черга")
            active_supplier_stmt = select(Supplier).where(
                Supplier.status == SupplierStatus.active
            ).order_by(
                Supplier.last_posted_at.asc().nullsfirst()
            ).limit(1)
            
            supplier = (await db.execute(active_supplier_stmt)).scalar_one_or_none()
            
            if not supplier:
                logger.warning("Планувальник 'Черга': не знайдено активних постачальників.")
                return

            # 2. Знаходимо 1 товар цього постачальника (по "черзі")
            product_stmt = select(Product).where(
                (Product.supplier_id == supplier.id) &
                (Product.variants.any(ProductVariant.is_available == True))
            ).options(
                selectinload(Product.variants)
            ).order_by(
                Product.last_posted_at.asc().nullsfirst()
            ).limit(1)
            
            product_to_post = (await db.execute(product_stmt)).scalar_one_or_none()
            
            if not product_to_post:
                logger.info(f"Планувальник 'Черга': не знайдено НОВИХ товарів для {supplier.name}.")
                # (Логіка повторного кола, якщо всі вже постили)
                product_stmt = select(Product).where(
                    (Product.supplier_id == supplier.id) &
                    (Product.variants.any(ProductVariant.is_available == True))
                ).options(
                    selectinload(Product.variants)
                ).order_by(Product.last_posted_at.asc()).limit(1)
                product_to_post = (await db.execute(product_stmt)).scalar_one_or_none()

            if not product_to_post:
                logger.warning(f"Планувальник 'Черга': У постачальника {supplier.name} взагалі немає товарів.")
                return
                
            # 3. Відправляємо на публікацію
            logger.info(f"Планувальник 'Черга': обрано товар (ID: {product_to_post.id}, SKU: {product_to_post.sku})")
            
            await publisher_service.publish_product_to_telegram(product_to_post, bot)

        except Exception as e:
            logger.error(f"Помилка в роботі 'розумного' планувальника (Черга): {e}", exc_info=True)
            await db.rollback()

# ---
# НОВА ЗАДАЧА 2: "AI-Агент" (Фаза 3.9 / План 21/22)
# ---
async def check_new_suppliers_job(bot: Bot):
    """
    Шукає нових постачальників (pending_ai_analysis)
    і відправляє їх на обробку в "Мозок" (AI-Агент).
    """
    logger.info("AI-Агент: Шукаю нових постачальників для аналізу...")
    
    async with AsyncSessionLocal() as db:
        supplier_to_analyze = None # Визначаємо
        try:
            # 1. Знаходимо ОДНОГО постачальника, який чекає на аналіз
            stmt = select(Supplier).where(
                Supplier.status == SupplierStatus.pending_ai_analysis
            ).limit(1)
            
            supplier_to_analyze = (await db.execute(stmt)).scalar_one_or_none()
            
            if not supplier_to_analyze:
                logger.info("AI-Агент: Немає нових постачальників для аналізу.")
                return
                
            logger.info(f"AI-Агент: Знайдено нового постачальника (ID: {supplier_to_analyze.id}). Починаю аналіз...")
            
            # 2. "Блокуємо" його, щоб інший процес не взяв його
            # (Ми додамо `ai_in_progress` в models.py)
            supplier_to_analyze.status = SupplierStatus.ai_in_progress 
            await db.commit()
            
            # 3. Запускаємо "важку" задачу
            await ai_agent_service.run_ai_onboarding_analysis(supplier_to_analyze.id, bot)
            
        except Exception as e:
            logger.error(f"Помилка в роботі 'AI-Агента' (Job): {e}", exc_info=True)
            # Розблоковуємо на випадок помилки
            if supplier_to_analyze:
                await db.rollback()
                await db.execute(
                    update(Supplier).where(Supplier.id == supplier_to_analyze.id)
                    .values(status=SupplierStatus.pending_ai_analysis, admin_notes=f"Помилка Агента: {e}")
                )
                await db.commit()

async def start_scheduler(bot: Bot):
    """Запускає обидва планувальники."""
    
    # --- ЗАДАЧА 1 (План 20.1) ---
    minutes_interval = 17
    jitter_seconds = 13 * 60 
    
    _scheduler.add_job(
        post_from_queue_job,
        'interval',
        minutes=minutes_interval,
        jitter=jitter_seconds,
        args=(bot,),
        id="smart_queue_post_job",
        misfire_grace_time=300 
    )
    
    # --- НОВА ЗАДАЧА 2 (План 21/22) ---
    _scheduler.add_job(
        check_new_suppliers_job,
        'interval',
        minutes=5, # Кожні 5 хвилин перевіряємо, чи є нові
        args=(bot,),
        id="ai_onboarding_agent_job",
        misfire_grace_time=60
    )
    
    try:
        if not _scheduler.running:
            _scheduler.start()
            logger.info("✅ 'Розумний' планувальник (Черга + AI-Агент) запущено.")
    except Exception as e:
        logger.error(f"Помилка запуску 'розумного' планувальника: {e}")