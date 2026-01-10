# services/notification_service.py
import logging
from aiogram import Bot
from aiogram.types import BufferedInputFile, InlineKeyboardMarkup, InlineKeyboardButton
from config_reader import config
from database.models import Supplier, Order # <-- НОВИЙ ІМПОРТ
from database.db import AsyncSessionLocal # <-- НОВИЙ ІМПОРТ
from sqlalchemy import update # <-- НОВИЙ ІМПОРТ
from typing import Optional # <-- НОВИЙ ІМПОРТ

logger = logging.getLogger(__name__)

async def notify_admin_of_new_order(bot: Bot, order_summary: str, order_data_json: str, order_uid: str):
    # ... (код без змін) ...
    if not config.test_channel: return
    try:
        await bot.send_message(
            config.test_channel,
            f"✅ <b>Нове Замовлення (Parent):</b> <code>{order_uid}</code>\n\n{order_summary}"
        )
        json_file = BufferedInputFile(order_data_json.encode('utf-8'), filename=f"{order_uid}.json")
        await bot.send_document(
            config.test_channel, document=json_file, caption=f"Повні дані замовлення {order_uid} (Parent)"
        )
    except Exception as e:
        logger.error(f"Не вдалося надіслати сповіщення адміну {config.test_channel}: {e}")

# ... (код _get_supplier_order_keyboard залишається без змін) ...
def _get_supplier_order_keyboard(child_order_uid: str, mydrop_link: Optional[str] = None) -> InlineKeyboardMarkup:
    buttons = [
        [
            InlineKeyboardButton(text="✅ Підтвердити", callback_data=f"supplier:confirm:{child_order_uid}"),
            InlineKeyboardButton(text="❌ Скасувати", callback_data=f"supplier:cancel:{child_order_uid}")
        ]
    ]
    if mydrop_link:
        buttons.append([
            InlineKeyboardButton(text="🔗 Замовлення в MyDrop (API)", url=mydrop_link)
        ])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


async def notify_customer_of_new_order(
    bot: Bot, 
    user_id: int,
    order_uid: str, # <-- НОВИЙ ПАРАМЕТР
    summary_text: str, 
    order_txt_content: str, 
    order_filename: str
):
    """
    (Оновлено для Фази 4.4 / План 25)
    Надсилає КЛІЄНТУ .txt файл та ЗБЕРІГАЄ message_id.
    """
    try:
        txt_file = BufferedInputFile(
            order_txt_content.encode('utf-8'),
            filename=order_filename
        )
        
        # Надсилаємо текст + файл
        sent_msg = await bot.send_message(user_id, summary_text)
        await bot.send_document(user_id, document=txt_file)
        
        # --- [НОВЕ - ФАЗА 4.4] ---
        # Зберігаємо ID повідомлення, щоб ми могли його оновлювати
        async with AsyncSessionLocal() as db:
            async with db.begin():
                await db.execute(
                    update(Order)
                    .where(Order.order_uid == order_uid)
                    .values(customer_message_id=sent_msg.message_id) # <-- Зберігаємо ID
                )
            await db.commit()
        # ---
        
    except Exception as e:
        logger.error(f"Не вдалося надіслати сповіщення КЛІЄНТУ {user_id}: {e}")

async def notify_supplier_of_new_order(
    bot: Bot, 
    supplier: Supplier, 
    summary_text: str, 
    order_txt_content: str, 
    order_filename: str,
    child_order_uid: str
):
    # ... (код без змін, з `TavernaBot_8.rar`) ...
    try:
        if not supplier.user or not supplier.user.telegram_id:
            logger.error(f"Не можу сповістити постачальника {supplier.name}: не прив'язаний Telegram.")
            return
            
        target_chat_id = supplier.user.telegram_id
        txt_file = BufferedInputFile(order_txt_content.encode('utf-8'), filename=order_filename)
        mydrop_link = None 
        keyboard = _get_supplier_order_keyboard(child_order_uid=child_order_uid, mydrop_link=mydrop_link)
        
        await bot.send_message(target_chat_id, summary_text, reply_markup=keyboard)
        await bot.send_document(target_chat_id, document=txt_file)
        
    except Exception as e:
        logger.error(f"Не вдалося надіслати сповіщення ПОСТАЧАЛЬНИКУ {supplier.name} (TG ID: {target_chat_id}): {e}")