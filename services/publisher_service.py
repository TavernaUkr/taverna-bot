# services/publisher_service.py
import logging
import re
import random
import asyncio
from aiogram import Bot
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from urllib.parse import quote
from sqlalchemy.future import select
from sqlalchemy import update # <-- НОВИЙ ІМПОРТ
from sqlalchemy.sql import func # <-- НОВИЙ ІМПОРТ

from config_reader import config
from services import gemini_service
from database.models import Product, ProductVariant, Channel, Supplier # <-- НОВИЙ ІМПОРТ
from database.db import AsyncSessionLocal

logger = logging.getLogger(__name__)

# Ми більше не використовуємо файл posted_ids.txt. Ми використовуємо БД.
# POSTED_PRODUCT_IDS = set() ... (ВИДАЛЕНО)
# _load_posted_ids() ... (ВИДАЛЕНО)
# _save_posted_id() ... (ВИДАЛЕНО)

def _generate_order_button(sku: str) -> InlineKeyboardMarkup:
    # ... (код без змін) ...
    if not config.webapp_url:
        logger.error("WEBAPP_URL не вказано! Неможливо створити кнопку MiniApp.")
        return InlineKeyboardMarkup(inline_keyboard=[])
    deep_link = f"{str(config.webapp_url)}?startapp=sku-{sku}"
    return InlineKeyboardMarkup(
        inline_keyboard=[[
            InlineKeyboardButton(text="🛒 Замовити", url=deep_link)
        ]]
    )

async def _get_topic_id_by_category(db: AsyncSession, category_tag: str) -> Optional[int]:
    # ... (код без змін) ...
    if not category_tag:
        logger.warning("Продукт не має category_tag. Постинг у 'General'.")
        return None
    stmt = select(Channel.telegram_id).where(Channel.category_tag == category_tag)
    result = await db.execute(stmt)
    topic_id = result.scalar_one_or_none()
    if not topic_id:
        logger.warning(f"Не знайдено 'Тему' (гілку) для категорії '{category_tag}'. Постинг у 'General'.")
        return None
    return int(topic_id)

# ---
# [ГОЛОВНА ФУНКЦІЯ ФАЗИ 3.6] (Оновлена для "Черги")
# ---
async def publish_product_to_telegram(product: Product, bot: Bot):
    """
    "Розумний" паблішер (Виконавець).
    Бере готовий `Product` з БД, рерайтить та публікує
    у відповідну "Тему" (гілку) TavernaGroup.
    ОНОВЛЮЄ `last_posted_at` в БД.
    """
    logger.info(f"Починаю публікацію продукту (ID: {product.id}, SKU: {product.sku})")
    
    # 1. Отримуємо дані про товар
    vendor_code = product.sku
    name = product.name
    
    # 2. Визначаємо ціну
    active_variants = [v for v in product.variants if v.is_available and v.final_price > 0]
    if not active_variants:
        logger.warning(f"Пропуск поста (SKU: {vendor_code}): немає доступних варіантів.")
        return
    min_price = min(v.final_price for v in active_variants)
    price_text = f"<b>{min_price} грн</b>"
    
    # 3. Рерайтимо опис
    rewritten_description = await gemini_service.rewrite_text_with_ai(
        product.description or name, 
        name
    )

    # 4. Формуємо текст поста
    post_caption = (
        f"📦 <b>{name}</b>\n\n"
        f"Артикул: <code>{vendor_code}</code>\n"
        f"Ціна: {price_text}\n\n"
        f"{rewritten_description}"
    )
    
    if len(post_caption) > 1024:
        post_caption = post_caption[:1020] + "..."
        
    # 5. Генеруємо кнопку "Замовити"
    order_button = _generate_order_button(vendor_code)
    
    # 6. Визначаємо, куди постити (ID "гілки")
    topic_id = None
    async with AsyncSessionLocal() as db:
        topic_id = await _get_topic_id_by_category(db, product.category_tag)
        
    target_channel = config.main_channel # Наш `taverna_ukr_group`
    
    # 7. Публікуємо
    try:
        photo_to_send = product.pictures[0] if product.pictures else None
            
        if photo_to_send:
            await bot.send_photo(
                chat_id=target_channel,
                photo=photo_to_send,
                caption=post_caption,
                reply_markup=order_button,
                message_thread_id=topic_id # <-- МАГІЯ: Відправка у "гілку"
            )
        else:
            await bot.send_message(
                chat_id=target_channel,
                text=post_caption,
                reply_markup=order_button,
                disable_web_page_preview=True,
                message_thread_id=topic_id # <-- МАГІЯ: Відправка у "гілку"
            )
            
        # 8. [ОНОВЛЕНО - План 20.1] Оновлюємо `last_posted_at` в БД
        async with AsyncSessionLocal() as db:
            async with db.begin():
                # Оновлюємо час для самого Продукту
                await db.execute(
                    update(Product)
                    .where(Product.id == product.id)
                    .values(last_posted_at=func.now())
                )
                # Оновлюємо час для Постачальника (для "черги" постачальників)
                await db.execute(
                    update(Supplier)
                    .where(Supplier.id == product.supplier_id)
                    .values(last_posted_at=func.now())
                )
            await db.commit()
            
        logger.info(f"✅ Пост (SKU: {vendor_code}) успішно опубліковано у 'гілку' ID: {topic_id}")

    except Exception as e:
        logger.error(f"Помилка публікації поста (SKU: {vendor_code}): {e}", exc_info=True)