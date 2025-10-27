# services/notification_service.py
import logging
from aiogram import Bot
from aiogram.types import BufferedInputFile, InputFile # Додаємо InputFile
from typing import Dict, Any
from pathlib import Path # Додаємо Path
import io # Додаємо io

from config_reader import config
from services.order_service import SUPPLIER_NAMES

logger = logging.getLogger(__name__)

# Словник ID менеджерів
MANAGER_TELEGRAM_IDS: Dict[str, int] = {
    "landliz": -1002241517409, # TODO: Замінити на реальний ID
    "unknown": config.admin_id,
}

async def send_new_order_notifications(bot: Bot, order_data: Dict[str, Any], txt_content: str, filename: str):
    """Надсилає сповіщення про нове замовлення."""
    order_id = order_data.get('order_id', 'N/A')
    supplier_ids = set(item.get('supplier_id', 'unknown') for item in order_data.get('cart', {}).get('items', []))
    supplier_names = [SUPPLIER_NAMES.get(sid, sid.capitalize()) for sid in supplier_ids]
    supplier_list_str = ", ".join(supplier_names)
    all_ttns = order_data.get('ttn', {}) # Словник {supplier_id: ttn}

    # Створюємо об'єкт файлу один раз
    txt_file_bytes = txt_content.encode('utf-8')

    # 1. Сповіщення адміну (в тестовий канал)
    admin_caption = f"🔥 Нове замовлення `{order_id}`\nПостачальники: `{supplier_list_str}`"
    try:
        admin_txt_file = BufferedInputFile(txt_file_bytes, filename=filename)
        await bot.send_document(chat_id=config.test_channel, document=admin_txt_file, caption=admin_caption, parse_mode="Markdown")
        logger.info(f"Сповіщення адміну про {order_id} надіслано.")
    except Exception as e: logger.error(f"Помилка сповіщення адміну: {e}")

    # 2. Сповіщення менеджерам
    for supplier_id in supplier_ids:
        manager_id = MANAGER_TELEGRAM_IDS.get(supplier_id)
        if not manager_id:
             logger.warning(f"Не знайдено ID менеджера для {supplier_id}.")
             continue
        supplier_name = SUPPLIER_NAMES.get(supplier_id, supplier_id)
        manager_caption = f"📦 Нове замовлення `{order_id}` для `{supplier_name}`"
        ttn = all_ttns.get(supplier_id)
        try:
             manager_txt_file = BufferedInputFile(txt_file_bytes, filename=filename)
             await bot.send_document(chat_id=manager_id, document=manager_txt_file, caption=manager_caption, parse_mode="Markdown")
             if ttn and order_data.get('payment_method') == 'full':
                 await bot.send_message(chat_id=manager_id, text=f"📄 Створено ТТН: `{ttn}`", parse_mode="Markdown")
             logger.info(f"Сповіщення менеджеру {supplier_name} ({manager_id}) про {order_id} надіслано.")
        except Exception as e: logger.error(f"Помилка сповіщення менеджеру {supplier_name}: {e}")

    # 3. Підтвердження клієнту
    try:
        customer_id = order_data.get('customer_id')
        if not customer_id: raise ValueError("Customer ID is missing")
        final_message = "🎉 Дякуємо! Ваше замовлення прийнято. Деталі у файлі."
        if all_ttns:
             final_message += "\n\nВаші ТТН:"
             for sup_id, ttn_val in all_ttns.items():
                 sup_name = SUPPLIER_NAMES.get(sup_id, sup_id)
                 final_message += f"\n▪️ ({sup_name}): `{ttn_val}`"

        client_txt_file = BufferedInputFile(txt_file_bytes, filename=filename)
        await bot.send_document(chat_id=customer_id, document=client_txt_file, caption=final_message, parse_mode="Markdown")
        logger.info(f"Підтвердження клієнту {customer_id} про {order_id} надіслано.")
    except Exception as e: logger.error(f"Помилка підтвердження клієнту {order_data.get('customer_id')}: {e}", exc_info=True)