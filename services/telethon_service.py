# services/telethon_service.py
import logging
from telethon import TelegramClient, events
from aiogram import Bot

from config_reader import config
from services import publisher_service

logger = logging.getLogger(__name__)

# Клієнт створюється один раз
client = TelegramClient(
    session=config.session_name,
    api_id=config.tg_api_id,
    api_hash=config.tg_api_hash
)

async def start_telethon_client(bot: Bot):
    """Підключається до Telegram та слухає нові повідомлення в каналі постачальника."""
    if not all([config.tg_api_id, config.tg_api_hash, config.supplier_channel]):
        logger.warning("Telethon не налаштовано (TG_API_ID, TG_API_HASH, SUPPLIER_CHANNEL). Моніторинг каналу вимкнено.")
        return

    logger.info("Запускаю моніторинг каналу постачальника...")

    @client.on(events.NewMessage(chats=[config.supplier_channel]))
    async def new_post_handler(event):
        logger.info(f"Отримано новий пост з каналу {config.supplier_channel}!")
        # Передаємо об'єкт бота та повідомлення в наш центральний обробник
        # Помічаємо, що це новий пост (is_new_post=True)
        await publisher_service.process_and_publish_post(bot, event.message, is_new_post=True)

    try:
        await client.start()
        logger.info("✅ Telethon клієнт успішно запущено.")
        # Ця функція буде працювати вічно у фоні
        await client.run_until_disconnected()
    except Exception as e:
        logger.error(f"❌ Помилка в роботі Telethon клієнта: {e}")