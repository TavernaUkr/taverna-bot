import logging
import asyncio
import random
from apscheduler.schedulers.asyncio import AsyncIOScheduler
# from services import gdrive_service, publisher_service

logger = logging.getLogger(__name__)

async def post_random_job():
    """Завдання, яке буде виконуватись планувальником."""
    logger.info("Планувальник: час публікувати випадковий старий пост.")
    # TODO: Реалізувати логіку отримання випадкового поста з GDrive
    # post_data = await gdrive_service.get_random_post()
    # if post_data:
    #     await publisher_service.process_and_publish_post_from_gdrive(post_data)

async def start_scheduler():
    """Запускає планувальник, який публікує старі пости."""
    scheduler = AsyncIOScheduler(timezone="Europe/Kiev")
    
    # Додаємо завдання: запускати post_random_job кожні 5-30 хвилин
    scheduler.add_job(
        post_random_job,
        'interval',
        minutes=random.randint(5, 30)
    )
    
    scheduler.start()
    logger.info("✅ Планувальник завдань запущено.")
