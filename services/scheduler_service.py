# services/scheduler_service.py
import logging
import asyncio
import random
from aiogram import Bot
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from config_reader import config
from services import publisher_service
from services.telethon_service import client as telethon_client # Імпортуємо клієнт

logger = logging.getLogger(__name__)
_scheduler = AsyncIOScheduler(timezone="Europe/Kiev")

async def post_random_job(bot: Bot):
    """Завдання, яке знаходить випадковий старий пост і відправляє його на обробку."""
    logger.info("Планувальник: шукаю випадковий старий пост для публікації.")
    
    if not telethon_client.is_connected():
        logger.warning("Планувальник: Telethon клієнт не підключений. Пропускаю завдання.")
        return
        
    try:
        # Логіка зі старого коду для пошуку випадкового поста
        entity = await telethon_client.get_entity(config.supplier_channel)
        # Отримуємо загальну кількість повідомлень, щоб знати діапазон для пошуку
        total_messages = (await telethon_client.get_messages(entity, limit=0)).total
        
        # Робимо до 15 спроб знайти унікальний пост
        for _ in range(15):
            # Вибираємо випадкове зміщення від початку історії
            random_offset_id = random.randint(1, total_messages - 1)
            messages = await telethon_client.get_messages(entity, limit=1, offset_id=random_offset_id)
            
            if not messages:
                continue

            message = messages[0]
            unique_post_id = f"{message.chat_id}_{message.id}"

            # Перевіряємо, чи не публікували ми цей пост раніше
            if unique_post_id not in publisher_service.POSTED_IDS:
                logger.info(f"Планувальник: знайдено унікальний старий пост ID: {message.id}. Відправляю на обробку...")
                # Помічаємо, що це старий пост (is_new_post=False)
                await publisher_service.process_and_publish_post(bot, message, is_new_post=False)
                return # Виходимо після успішної знахідки
                
        logger.info("Планувальник: не вдалося знайти новий унікальний пост за 15 спроб.")

    except Exception as e:
        logger.error(f"Помилка в роботі планувальника випадкових постів: {e}", exc_info=True)


async def start_scheduler(bot: Bot):
    """Запускає планувальник, який публікує старі пости у випадковий час."""
    # Додаємо завдання, яке буде запускатись кожні 20 хвилин.
    # Випадкова затримка всередині самого publisher_service забезпечить різний час постингу.
    _scheduler.add_job(
        post_random_job,
        'interval',
        minutes=20, # Можна налаштувати (напр. 30 або 40)
        args=(bot,)
    )
    
    _scheduler.start()
    logger.info("✅ Планувальник завдань (Cron-Job) запущено.")