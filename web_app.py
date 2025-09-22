import sys
import os
import logging
import asyncio

# ==================== ФІНАЛЬНА ДІАГНОСТИКА ====================
# Цей блок покаже нам, що саме бачить Python всередині сервера Render.
# Ми виводимо всю інформацію в логи, щоб зрозуміти, чому шляхи не працюють.
# flush=True гарантує, що ми побачимо ці повідомлення перед можливою помилкою.

try:
    print("--- PYTHON PATH DEBUGGING ---", flush=True)
    
    current_file_path = os.path.abspath(__file__)
    print(f"Абсолютний шлях до web_app.py: {current_file_path}", flush=True)
    
    project_root = os.path.dirname(current_file_path)
    print(f"Розрахований корінь проєкту: {project_root}", flush=True)
    
    handlers_path = os.path.join(project_root, 'handlers')
    print(f"Шлях до папки 'handlers', який ми перевіряємо: {handlers_path}", flush=True)
    
    handlers_exists = os.path.exists(handlers_path)
    print(f"Чи існує папка 'handlers' за цим шляхом? -> {handlers_exists}", flush=True)

    print(f"Початковий sys.path: {sys.path}", flush=True)

    # Примусово додаємо розрахований корінь проєкту до шляхів пошуку
    if project_root not in sys.path:
        sys.path.insert(0, project_root)
        print("!!! Корінь проєкту додано до sys.path.", flush=True)

    print(f"Модифікований sys.path: {sys.path}", flush=True)
    print("--- END DEBUGGING ---", flush=True)

except Exception as e:
    print(f"ПОМИЛКА під час діагностики шляхів: {e}", flush=True)
# ============================================================

from flask import Flask, request
from aiogram import Bot, Dispatcher, types
from aiogram.fsm.storage.memory import MemoryStorage

# Тепер, після діагностики, ці імпорти мають спрацювати
from config_reader import config
from handlers import user_commands, product_handlers, order_handlers
# from services import telethon_service, scheduler_service # Поки що закоментовано

# Налаштування логування
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(name)s - %(message)s')
logger = logging.getLogger("taverna")

# Ініціалізація
storage = MemoryStorage()
bot = Bot(token=config.bot_token, parse_mode="HTML")
dp = Dispatcher(storage=storage)
app = Flask(__name__)

# --- Flask Routes ---
@app.route("/")
def index():
    return "Bot is running!", 200

@app.route("/healthz")
def health_check():
    return "OK", 200

@app.route(config.webhook_path, methods=["POST"])
async def webhook():
    if request.headers.get('content-type') == 'application/json':
        update = types.Update.model_validate_json(request.get_data().decode('utf-8'))
        await dp.feed_update(bot=bot, update=update)
        return '', 200
    return "Bad request", 400

# --- Головна функція запуску ---
async def main():
    # Реєстрація роутерів
    dp.include_router(user_commands.router)
    dp.include_router(product_handlers.router)
    dp.include_router(order_handlers.router)

    # Встановлення вебхука
    webhook_info = await bot.get_webhook_info()
    if webhook_info.url != config.webhook_url:
        await bot.set_webhook(url=config.webhook_url)
        logger.info(f"Webhook set to {config.webhook_url}")

    logger.info("Bot ready — waiting for webhook updates...")

    # --- Запуск фонових сервісів ---
    # TODO: Розкоментувати, коли будете готові
    # asyncio.create_task(telethon_service.start_client())
    # asyncio.create_task(scheduler_service.start_scheduler())

if __name__ == '__main__':
    # Цей блок запускає асинхронну функцію main
    asyncio.run(main())

