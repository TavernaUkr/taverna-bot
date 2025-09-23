import asyncio
import logging
from flask import Flask, request, Response
from aiogram import Bot, Dispatcher, types
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.client.default import DefaultBotProperties

# --- Наші модулі ---
from config_reader import config
from handlers import user_commands, product_handlers, order_handlers
# ‼️ ІМПОРТУЄМО НАШІ ФОНОВІ СЕРВІСИ ‼️
from services import telethon_service, scheduler_service

# --- Налаштування логування ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(name)s - %(message)s')
logger = logging.getLogger("taverna")

# --- Ініціалізація Flask ---
app = Flask(__name__)

# --- Ініціалізація Aiogram ---
bot = Bot(token=config.bot_token, default=DefaultBotProperties(parse_mode="HTML"))
storage = MemoryStorage()
dp = Dispatcher(storage=storage)

# --- Основна асинхронна функція для запуску бота та фонових задач ---
async def main_async():
    # 1. Реєструємо роутери з наших хендлерів
    dp.include_router(user_commands.router)
    dp.include_router(product_handlers.router)
    dp.include_router(order_handlers.router)

    # 2. Встановлюємо вебхук
    webhook_url = f"{config.webhook_url.rstrip('/')}{config.webhook_path}"
    current_webhook = await bot.get_webhook_info()
    if current_webhook.url != webhook_url:
        await bot.set_webhook(url=webhook_url)
        logger.info(f"Webhook has been set to {webhook_url}")
    else:
        logger.info(f"Webhook is already set to {webhook_url}")
    
    logger.info("Bot ready — waiting for webhook updates...")

    # --- ‼️ ЗАПУСК ФОНОВИХ СЕРВІСІВ ‼️ ---
    # Передаємо об'єкт bot в кожен сервіс, щоб вони могли постити повідомлення
    asyncio.create_task(telethon_service.start_client(bot))
    asyncio.create_task(scheduler_service.start_scheduler(bot))

# --- Ендпоінти Flask ---
@app.route(config.webhook_path, methods=['POST'])
async def webhook_handler():
    """Приймає оновлення від Telegram."""
    try:
        update = types.Update.model_validate(request.json, context={"bot": bot})
        await dp.feed_update(bot=bot, update=update)
        return Response(status=200)
    except Exception as e:
        logger.error(f"Error in webhook handler: {e}")
        return Response(status=500)

@app.route('/healthz')
def health_check():
    """Ендпоінт для перевірки 'здоров'я' сервісом Render."""
    return "OK", 200

# --- Головний блок запуску ---
if __name__ == '__main__':
    # Цей блок запускає асинхронну функцію main при старті Gunicorn воркера
    try:
        asyncio.run(main_async())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Bot stopped!")
