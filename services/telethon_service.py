# services/telethon_service.py
import logging
import asyncio
from aiogram import Bot
from telethon import TelegramClient, events
from sqlalchemy.future import select

from config_reader import config
# БІЛЬШЕ НЕ ІМПОРТУЄМО publisher_service
from services import gemini_service # <-- Наш "мозок"
from database.db import AsyncSessionLocal
from database.models import Supplier, SupplierType, SupplierStatus # <-- НОВІ ІМПОРТИ

logger = logging.getLogger(__name__)

async def start_client(bot=None):
    logger.info("Telethon: start_client is disabled (stub).")
    return

client = TelegramClient(
    config.session_name,
    config.tg_api_id,
    config.tg_api_hash.get_secret_value(), # .get_secret_value() для Pydantic v2
    system_version="4.16.30-vxCUSTOM"
)

async def handle_independent_post(event: events.NewMessage.Event, supplier: Supplier):
    """
    [ФАЗА 3.6 - "Кругообіг"] (Твій План 17/19)
    Обробляє пост "Незалежного" постачальника.
    1. Бере текст/фото.
    2. Відправляє в Gemini для витягування атрибутів (План 19).
    3. Створює/оновлює `Product` та `ProductVariant` в БД.
    """
    logger.info(f"Telethon: Отримано пост від Independent постачальника: {supplier.name}")
    raw_text = event.message.text or ""
    
    # 1. Викликаємо AI-Класифікатор
    ai_data = await gemini_service.extract_product_attributes_with_ai(
        raw_text, 
        category_hint=supplier.category_tag or "unknown"
    )
    
    if not ai_data:
        logger.warning(f"Gemini не зміг розпарсити пост від {supplier.name}")
        return
        
    # 2. Тут буде складна логіка (Фаза 3.6 / 15G):
    # - Знайти `Product` за `ai_data['name']`
    # - Створити `ProductOptions` (з `ai_data['options']`)
    # - Створити `ProductVariant`
    # - Записати `ai_data['attributes']` в `Product.attributes`
    
    logger.info(f"Telethon + AI: Успішно розпарсено товар {ai_data.get('name')} (поки що не збережено в БД)")
    
    # 3. Тимчасова заглушка: просто надсилаємо в тест-канал
    try:
        bot = event.client._bot
        await bot.send_message(
            config.test_channel,
            f"Telethon+Gemini розпізнав товар від {supplier.name}:\n"
            f"```json\n{json.dumps(ai_data, ensure_ascii=False, indent=2)}\n```"
        )
    except Exception:
        pass # Не страшно, якщо не вийшло

async def start_telethon_client(bot: Bot):
    """Запускає Telethon та налаштовує обробники для ВСІХ постачальників з БД."""
    if not all([config.tg_api_id, config.tg_api_hash]):
        logger.warning("Telethon не налаштовано (API_ID/API_HASH відсутні).")
        return

    logger.info("Запуск Telethon клієнта...")
    
    try:
        # Pydantic v2 вимагає .get_secret_value()
        await client.start(bot_token=config.bot_token.get_secret_value())
        # Зберігаємо інстанс `bot` всередині `client`, щоб хендлери мали до нього доступ
        client._bot = bot 
        logger.info("Telethon клієнт успішно запущено.")
    except Exception as e:
        logger.error(f"Помилка запуску Telethon: {e}", exc_info=True)
        return

    # --- НОВА ЛОГІКА (15G) ---
    # 1. Отримуємо ВСІХ 'Independent' постачальників з БД
    async with AsyncSessionLocal() as db:
        stmt = select(Supplier).where(
            (Supplier.status == SupplierStatus.active) & # Тільки активні
            (Supplier.type == SupplierType.independent) &
            (Supplier.telegram_channel != None) # У кого є канал
        )
        independent_suppliers = (await db.execute(stmt)).scalars().all()
    
    # 2. Підписуємось на канал КОЖНОГО постачальника
    if not independent_suppliers:
        logger.info("Telethon: Не знайдено 'Independent' постачальників з каналами для відстеження.")
    
    for supplier in independent_suppliers:
        try:
            channel_username = supplier.telegram_channel.replace("https://t.me/", "").replace("@", "")
            
            # Використовуємо `lambda` для "захоплення" `supplier`
            @client.on(events.NewMessage(chats=channel_username))
            async def independent_handler(event, s=supplier):
                # Викликаємо обробник, передаючи інфо про постачальника
                asyncio.create_task(
                    handle_independent_post(event, s)
                )
            
            logger.info(f"Telethon: Успішно підписано на канал @{channel_username} (Постачальник: {supplier.name})")
            
        except Exception as e:
            logger.error(f"Telethon: Не вдалося підписатися на {supplier.telegram_channel}: {e}")