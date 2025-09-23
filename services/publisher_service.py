import logging
import re
import io
from telethon.tl.types import Message
from aiogram import Bot
from aiogram.types import InputFile, InlineKeyboardMarkup, InlineKeyboardButton

# Імпортуємо всі наші сервіси та конфіг
from config_reader import config
from services import gemini_service, xml_parser, gdrive_service

logger = logging.getLogger(__name__)

def _extract_sku(text: str) -> str | None:
    """Надійно витягує артикул з тексту поста."""
    match = re.search(r'(?i)(Артикул|Код|Арт|SKU):\s*(\S+)', text)
    if match:
        return match.group(2).strip()
    return None

def _create_order_button(sku: str) -> InlineKeyboardMarkup:
    """
    Створює "магічну" кнопку "Замовити", яка веде в бот
    і одразу показує товар за артикулом (deep link).
    """
    # Формуємо URL: https://t.me/YourBotUsername?start=SKU
    bot_url = f"https://t.me/{config.bot_username}?start={sku}"
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🛒 Замовити товар", url=bot_url)]
        ]
    )
    return keyboard

async def process_and_publish_post(bot: Bot, telethon_message: Message):
    """
    Головна функція. Приймає повідомлення від Telethon, обробляє
    його і публікує в основний канал через Aiogram.
    """
    if not telethon_message.text or not telethon_message.photo:
        logger.info("Повідомлення без тексту або фото, пропускаємо.")
        return

    original_text = telethon_message.text
    sku = _extract_sku(original_text)

    if not sku:
        logger.warning(f"Не вдалося знайти артикул в пості: {original_text[:50]}...")
        return
        
    # Перевіряємо, чи існує такий товар в нашій базі (XML)
    product_data = await xml_parser.get_product_by_sku(sku)
    if not product_data:
        logger.warning(f"Товар з артикулом {sku} не знайдено в XML-файлі. Пост не буде опубліковано.")
        return

    logger.info(f"Обробка поста з артикулом {sku}...")

    # 1. Переписуємо текст
    rewritten_text = await gemini_service.rewrite_post_text(original_text)

    # 2. Завантажуємо фото в пам'ять
    image_bytes = io.BytesIO()
    await telethon_message.download_media(file=image_bytes)
    image_bytes.seek(0)
    photo_to_send = InputFile(image_bytes)
    
    # 3. Створюємо кнопку "Замовити"
    order_keyboard = _create_order_button(sku)

    # 4. Публікуємо в основний канал
    try:
        await bot.send_photo(
            chat_id=config.main_channel,
            photo=photo_to_send,
            caption=rewritten_text,
            reply_markup=order_keyboard
        )
        logger.info(f"✅ Пост з артикулом {sku} успішно опубліковано в {config.main_channel}.")
    except Exception as e:
        logger.error(f"❌ Помилка публікації поста з артикулом {sku}: {e}")
        return

    # 5. Зберігаємо на Google Drive (якщо увімкнено)
    if config.use_gdrive:
        image_bytes.seek(0) # Повертаємо курсор на початок для повторного читання
        await gdrive_service.save_post_to_drive(rewritten_text, image_bytes.read(), sku)
