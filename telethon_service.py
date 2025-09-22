import logging
from telethon import TelegramClient, events
from config_reader import config
from services import publisher_service
from aiogram import Bot

logger = logging.getLogger(__name__)

# Створюємо клієнт Telethon один раз
client = TelegramClient(
    session=config.session_name,
    api_id=config.tg_api_id,
    api_hash=config.tg_api_hash
)

async def start_monitoring(bot: Bot):
    """Підключається до Telegram та слухає нові повідомлення в каналі постачальника."""
    logger.info("Запуск моніторингу каналу постачальника...")
    
    @client.on(events.NewMessage(chats=[config.supplier_channel]))
    async def handler(event):
        logger.info(f"Отримано новий пост з каналу {config.supplier_channel}!")
        # Передаємо об'єкт бота та повідомлення в наш центральний обробник
        await publisher_service.process_and_publish_post(bot, event.message)

    try:
        await client.start()
        logger.info("✅ Telethon клієнт успішно запущено.")
        await client.run_until_disconnected()
    except Exception as e:
        logger.error(f"❌ Помилка в роботі Telethon клієнта: {e}")
