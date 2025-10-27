# services/publisher_service.py
import logging
import re
import io
import asyncio
import random
from datetime import datetime
from telethon.tl.types import Message
from aiogram import Bot
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.exceptions import TelegramBadRequest

# Імпортуємо всі наші сервіси та конфіг
from config_reader import config
from services import gemini_service, xml_parser, gdrive_service

logger = logging.getLogger(__name__)

# --- Робота з ID опублікованих постів ---
POSTED_IDS = set()

def load_posted_ids():
    """Завантажує ID вже опублікованих постів з файлу."""
    global POSTED_IDS
    try:
        with open(config.posted_ids_file_path, "r") as f:
            POSTED_IDS = {line.strip() for line in f if line.strip()}
        logger.info(f"Завантажено {len(POSTED_IDS)} ID раніше опублікованих постів.")
    except FileNotFoundError:
        logger.warning(f"Файл {config.posted_ids_file_path} не знайдено. Буде створено новий.")
    except Exception as e:
        logger.error(f"Помилка завантаження файлу posted_ids: {e}")

def save_posted_id(unique_post_id: str):
    """Зберігає унікальний ID поста у файл та в set, щоб уникнути дублікатів."""
    if unique_post_id not in POSTED_IDS:
        POSTED_IDS.add(unique_post_id)
        try:
            with open(config.posted_ids_file_path, "a") as f:
                f.write(f"{unique_post_id}\n")
        except Exception as e:
            logger.error(f"Помилка збереження ID поста {unique_post_id} у файл: {e}")

# Завантажуємо ID при старті
load_posted_ids()


# --- Допоміжні функції ---

def _extract_sku(text: str) -> str | None:
    """Надійно витягує артикул з тексту поста, шукаючи ключові слова."""
    # Регулярний вираз шукає слова "Артикул", "Код", "Арт", "SKU" (незалежно від регістру)
    # та бере наступне за ними слово (послідовність символів без пробілів)
    match = re.search(r'(?i)(Артикул|Код|Арт|SKU):\s*([^\s,]+)', text)
    if match:
        # Очищуємо артикул від можливих зайвих символів в кінці
        return match.group(2).strip().rstrip('.')
    return None

def _create_order_button(sku: str) -> InlineKeyboardMarkup:
    """Створює "магічну" кнопку "Замовити" з deep-link."""
    bot_url = f"https://t.me/{config.bot_username}?start={sku}"
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🛒 Замовити", url=bot_url)]
        ]
    )
    return keyboard


# --- Головна функція обробки та публікації ---

async def process_and_publish_post(bot: Bot, telethon_message: Message, is_new_post: bool):
    """
    Головна функція. Приймає повідомлення, обробляє та публікує в канал.
    """
    unique_post_id = f"{telethon_message.chat_id}_{telethon_message.id}"
    if unique_post_id in POSTED_IDS:
        logger.info(f"Пост {unique_post_id} вже було опубліковано. Пропускаємо.")
        return

    original_text = telethon_message.text
    if not original_text or not telethon_message.photo:
        logger.info(f"Повідомлення {unique_post_id} без тексту або фото, пропускаємо.")
        return

    # 1. Витягуємо артикул
    sku = _extract_sku(original_text)
    if not sku:
        logger.warning(f"Не вдалося знайти артикул в пості {unique_post_id}. Текст: '{original_text[:70]}...'")
        return

    # 2. Шукаємо товар в XML-кеші
    product_data = await xml_parser.get_product_by_sku(sku)
    if not product_data:
        logger.warning(f"Товар з артикулом {sku} не знайдено в XML. Пост {unique_post_id} не буде опубліковано.")
        return
        
    logger.info(f"Обробка поста {unique_post_id} з артикулом {sku}...")
    
    # Встановлюємо затримку
    delay = random.uniform(1*60, 10*60) if is_new_post else random.uniform(5*60, 30*60)
    logger.info(f"Заплановано публікацію поста {unique_post_id} через {delay/60:.2f} хв.")
    await asyncio.sleep(delay)

    # 3. Переписуємо текст за допомогою Gemini
    rewritten_text = await gemini_service.rewrite_post_text(original_text)

    # 4. Формуємо фінальний текст посту
    final_caption = (
        f"<b>{product_data['name']}</b>\n\n"
        f"{rewritten_text}\n\n"
        f"<b>Артикул:</b> <code>{sku}</code>\n"
        f"<b>Ціна:</b> {product_data['final_price']} грн"
    )

    # 5. Створюємо кнопку "Замовити"
    order_keyboard = _create_order_button(sku)
    
    # 6. Завантажуємо фото в пам'ять
    image_bytes_io = io.BytesIO()
    await telethon_message.download_media(file=image_bytes_io)
    image_bytes_io.seek(0) # Повертаємо курсор на початок

    # 7. Зберігаємо на Google Drive (якщо увімкнено)
    if config.use_gdrive:
        try:
            # Створюємо унікальне ім'я для файлу
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            photo_filename = f"{sku}_{timestamp}.jpg"
            text_filename = f"{sku}_{timestamp}.txt"
            
            # Викликаємо сервіс для збереження
            await gdrive_service.save_post_files(
                post_text=final_caption,
                image_bytes=image_bytes_io.getvalue(),
                photo_filename=photo_filename,
                text_filename=text_filename
            )
        except Exception as e:
            logger.error(f"Помилка при збереженні поста {sku} на Google Drive: {e}")
        finally:
            image_bytes_io.seek(0) # Повертаємо курсор для відправки в Telegram

    # 8. Публікуємо в основний канал
    try:
        await bot.send_photo(
            chat_id=config.main_channel,
            photo=image_bytes_io,
            caption=final_caption,
            reply_markup=order_keyboard
        )
        logger.info(f"✅ Пост з артикулом {sku} (ID: {unique_post_id}) успішно опубліковано в {config.main_channel}.")
        # Зберігаємо ID тільки після успішної публікації
        save_posted_id(unique_post_id)
        
    except TelegramBadRequest as e:
        if "caption is too long" in e.message:
            logger.warning(f"Опис для поста {sku} занадто довгий. Спроба скоротити та відправити ще раз.")
            # Спроба скоротити опис та відправити ще раз
            truncated_caption = final_caption[:1020] + "..."
            await bot.send_photo(
                chat_id=config.main_channel,
                photo=image_bytes_io,
                caption=truncated_caption,
                reply_markup=order_keyboard
            )
            logger.info(f"✅ Скорочена версія поста {sku} успішно опублікована.")
            save_posted_id(unique_post_id)
        else:
             logger.error(f"❌ Помилка публікації поста з артикулом {sku}: {e}")
    except Exception as e:
        logger.error(f"❌ Невідома помилка публікації поста з артикулом {sku}: {e}")