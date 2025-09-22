import sys
import os
import asyncio
import logging

# ==================== ФІНАЛЬНЕ ВИПРАВЛЕННЯ ====================
# Цей код додає кореневу папку проєкту до шляхів пошуку Python.
# Це гарантує, що імпорти `from handlers...`, `from services...`
# будуть працювати незалежно від того, як Gunicorn запускає додаток.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# ============================================================

from flask import Flask, request, jsonify
from aiogram import Bot, Dispatcher, types
from aiogram.fsm.storage.memory import MemoryStorage

# Тепер, після виправлення, ці імпорти спрацюють
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
    # Це потрібно, щоб Gunicorn міг імпортувати `app` без запуску бота
    asyncio.run(main())
