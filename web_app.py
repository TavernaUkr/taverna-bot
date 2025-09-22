import asyncio
import logging
import threading
from flask import Flask, request, Response
from aiogram import Bot, Dispatcher, types
from aiogram.fsm.storage.memory import MemoryStorage

# --- Наші модулі ---
from config_reader import config
from handlers import user_commands, product_handlers, order_handlers
# TODO: Створити та імпортувати ці сервіси
# from services import telethon_client, scheduler_service 

# --- Налаштування логування ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Ініціалізація Flask ---
app = Flask(__name__)

# --- Ініціалізація Aiogram ---
bot = Bot(token=config.bot_token, parse_mode="HTML")
storage = MemoryStorage()
dp = Dispatcher(storage=storage)

# --- Основна асинхронна функція для запуску бота та фонових задач ---
async def main_async():
    # 1. Реєструємо роутери з наших хендлерів
    dp.include_router(user_commands.router)
    dp.include_router(product_handlers.router)
    dp.include_router(order_handlers.router)
    # TODO: Додати роутер для адмін-команд

    # 2. Встановлюємо вебхук
    webhook_url = f"{config.webhook_url}{config.webhook_path}" # Змінено
    await bot.set_webhook(webhook_url, allowed_updates=dp.resolve_used_update_types())
    logger.info(f"Вебхук встановлено на: {webhook_url}")

    # 3. Запускаємо фонові задачі (поки що заглушки)
    # asyncio.create_task(telethon_client.start_monitoring(on_new_post))
    # asyncio.create_task(scheduler_service.start_scheduler())
    logger.info("Фонові задачі (Telethon, Scheduler) готові до запуску.")

    # Ця частина потрібна, щоб asyncio-цикл не завершувався
    await asyncio.Event().wait()


# --- Ендпоінти Flask ---
@app.route(config.webhook_path, methods=['POST']) # Змінено
async def webhook_handler():
    """Приймає оновлення від Telegram."""
    try:
        update_data = request.json
        update = types.Update.model_validate(update_data, context={"bot": bot})
        await dp.feed_update(bot=bot, update=update)
        return Response(status=200)
    except Exception as e:
        logger.error(f"Помилка в обробнику вебхука: {e}")
        return Response(status=500)

@app.route('/healthz')
def health_check():
    """Ендпоінт для перевірки 'здоров'я' сервісом Render."""
    return "OK", 200

# --- Функція, що запускає asyncio-цикл в окремому потоці ---
def run_async_tasks():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(main_async())
    finally:
        loop.close()

# --- Запуск ---
if __name__ == '__main__':
    # Запускаємо асинхронні задачі в фоновому потоці
    async_thread = threading.Thread(target=run_async_tasks)
    async_thread.daemon = True
    async_thread.start()
    
    # Запускаємо Flask-сервер (для локального тестування)
    # На Render це буде робити gunicorn
    app.run(host='0.0.0.0', port=8000)
