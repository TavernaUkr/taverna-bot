# handlers/supplier_handlers.py
import logging
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Body, status
from aiogram import Bot
from sqlalchemy.future import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_
from pydantic import BaseModel, EmailStr, HttpUrl, Field
from typing import Optional

from database.db import get_db, AsyncSession
from database.models import User, Supplier, Channel, SupplierType, SupplierStatus, UserRole, PayoutMethod # <-- НОВИЙ ІМПОРТ
from config_reader import config
from bot_instance import get_bot_instance
from services.auth_service import get_current_supplier_or_admin
from services import gemini_service
from api_models import SupplierRegisterRequest, SupplierResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/suppliers", tags=["Suppliers (Registration)"])

# ... (код get_or_create_topic залишається без змін) ...
async def get_or_create_topic(
    bot: Bot, 
    db: AsyncSession, 
    topic_name: str, 
    category_tag: str
) -> Optional[str]:
    # ... (код без змін) ...
    channel_stmt = select(Channel).where(Channel.category_tag == category_tag)
    channel_db = (await db.execute(channel_stmt)).scalar_one_or_none()
    if channel_db:
        return channel_db.telegram_id
    try:
        new_topic = await bot.create_forum_topic(
            chat_id=config.main_channel, name=topic_name
        )
        new_channel = Channel(
            telegram_id=str(new_topic.message_thread_id),
            name=topic_name,
            category_tag=category_tag
        )
        db.add(new_channel)
        await db.flush()
        logger.info(f"Створено нову 'Тему' (Гілку) в TavernaGroup: {topic_name}")
        return new_channel.telegram_id
    except Exception as e:
        logger.error(f"НЕ ВДАЛОСЯ СТВОРИТИ 'ТЕМУ': {e}.")
        return None

# --- API Endpoints ---

@router.post("/register-full", response_model=SupplierResponse)
async def register_supplier(
    request_data: SupplierRegisterRequest,
    db: AsyncSession = Depends(get_db),
    bot: Bot = Depends(get_bot_instance),
    current_user: User = Depends(get_current_supplier_or_admin)
):
    """
    (Оновлено для Фази 3.12 / План 24)
    Приймає заявку на реєстрацію постачальника з ФОП та IBAN.
    """
    logger.info(f"Нова заявка на реєстрацію постачальника: {request_data.supplier_name} від User: {current_user.id}")
    user_id = current_user.id 

    # 1. Валідація (План 14 / 15G)
    if not request_data.agreed_to_tos:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User must agree to the Terms of Service")

    # 2. Валідація полів
    source_url = None
    if request_data.supplier_type == SupplierType.mydrop:
        if not request_data.mydrop_xml_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="MyDrop supplier must provide an XML URL")
        source_url = str(request_data.mydrop_xml_url)
    if request_data.supplier_type == SupplierType.independent:
        if not request_data.shop_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Independent supplier must provide a Shop URL")
        source_url = str(request_data.shop_url)
    
    # 3. --- [ПЛАН 21] ПЕРЕВІРКА НА УНІКАЛЬНІСТЬ URL ---
    if source_url:
        existing_supplier = await db.execute(
            select(Supplier).where(
                or_(Supplier.xml_url == source_url, Supplier.shop_url == source_url)
            )
        )
        if existing_supplier.scalar_one_or_none():
            logger.warning(f"Відхилено: Спроба зареєструвати дублікат URL: {source_url}")
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, 
                detail="Магазин з таким URL (XML або Shop URL) вже зареєстрований в системі."
            )

    # 4. Перевірка, чи цей юзер вже не має магазину
    existing_supplier = await db.execute(select(Supplier).where(Supplier.user_id == user_id))
    if existing_supplier.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Цей акаунт вже має зареєстрований магазин.")

    try:
        # 5. Створюємо нового Постачальника
        new_supplier = Supplier(
            user_id=user_id,
            key=request_data.supplier_name.lower().replace(' ', '_') + f"_{user_id}", # Унікальний ключ
            name=request_data.supplier_name,
            type=request_data.supplier_type,
            xml_url=str(request_data.mydrop_xml_url) if request_data.mydrop_xml_url else None,
            shop_url=str(request_data.shop_url) if request_data.shop_url else None,
            supplier_address=request_data.supplier_address,
            contact_phone=request_data.contact_phone,
            contact_email=request_data.contact_email,
            status=SupplierStatus.pending_ai_analysis, # (План 19)
            
            # (План 21)
            legal_name=request_data.legal_name,
            ipn=request_data.ipn,
            edrpou=request_data.edrpou,

            # --- [НОВЕ - ПЛАН 24] ---
            payout_method=request_data.payout_method,
            payout_iban=request_data.payout_iban,
            payout_card_token=request_data.payout_card_token
            # ---
        )
        
        db.add(new_supplier)
        await db.commit()
        await db.refresh(new_supplier)
        
        # 6. [ПЛАН 17.1] Гарантуємо, що "Live" гілка існує
        asyncio.create_task(get_or_create_topic(bot, db, "Live Feed", "live_feed"))
        
        # 7. [ПЛАН 19] Запускаємо AI-аналіз у фоні
        # (Цей таск ми реалізуємо у Фазі 3.9) - ВІН ВЖЕ РЕАЛІЗОВАНИЙ У SCHEDULER
        
        # 8. [ПЛАН 14] Надсилаємо сповіщення Адміну (тобі)
        try:
            await bot.send_message(
                chat_id=config.test_channel,
                text=f"🔥 **Нова Заявка Постачальника!**\n\n"
                     f"**Назва:** {new_supplier.name} (User ID: {user_id})\n"
                     f"**Тип:** {new_supplier.type.value}\n"
                     f"**Джерело:** {new_supplier.xml_url or new_supplier.shop_url}\n"
                     f"**ФОП/ТОВ:** {new_supplier.legal_name}\n"
                     f"**ІПН:** {new_supplier.ipn}\n"
                     f"**IBAN:** {new_supplier.payout_iban}\n\n"
                     f"👉 AI-Агент почав аналіз товарів. Очікуйте на звіт."
            )
        except Exception as e:
            logger.error(f"Не вдалося надіслати сповіщення адміну: {e}")
        
        logger.info(f"Створено нову заявку постачальника: {new_supplier.name} (ID: {new_supplier.id})")
        return new_supplier

    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Помилка унікальності (key/email/IBAN).")
    except Exception as e:
        await db.rollback()
        logger.error(f"Помилка в /suppliers/register: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")