import asyncio
import logging
import threading
from flask import Flask, request, Response
from aiogram import Bot, Dispatcher, types
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.client.default import DefaultBotProperties

# --- Наші модулі ---
from config_reader import config
from handlers import user_commands, product_handlers, order_handlers
from services import telethon_service, scheduler_service # Поки що закоментовано

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

    # --- Запуск фонових сервісів ---
    # TODO: Розкоментувати, коли будете готові
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

# --- Правильний запуск для Gunicorn ---
@app.before_request
def start_bot_loop():
    """
    Запускає asyncio-цикл в окремому потоці при першому запиті.
    Це гарантує, що main_async() виконається один раз при старті воркера.
    """
    # Перевіряємо, чи цикл ще не запущений, щоб уникнути помилок
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # 'RuntimeError: There is no current event loop...'
        loop = None

    if loop is None or not loop.is_running():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        def run_loop():
            try:
                # Запускаємо нашу основну асинхронну функцію
                loop.run_until_complete(main_async())
            finally:
                loop.close()

        # Запускаємо цикл в окремому потоці, щоб не блокувати Flask
        thread = threading.Thread(target=run_loop)
        thread.daemon = True
        thread.start()
