# web_app.py
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
from services import telethon_service, scheduler_service, xml_parser

# --- Глобальна змінна-запобіжник, щоб уникнути подвійного запуску ---
bot_loop_started = threading.Event()

# --- Налаштування логування ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(name)s - %(message)s'
)
logger = logging.getLogger("taverna")

# --- Ініціалізація Flask ---
app = Flask(__name__)

# --- Ініціалізація Aiogram ---
# Використовуємо parse_mode з конфігурації, якщо він там є, або HTML за замовчуванням
bot = Bot(token=config.bot_token, default=DefaultBotProperties(parse_mode="HTML"))
storage = MemoryStorage()
dp = Dispatcher(storage=storage)

# !!! ПІДКЛЮЧАЄМО РОУТЕРИ ТУТ (ОДИН РАЗ ПРИ СТАРТІ) !!!
dp.include_router(user_commands.router)
dp.include_router(product_handlers.router)
dp.include_router(order_handlers.router)
logger.info("Роутери Aiogram підключено.")

# --- Основна асинхронна функція для запуску бота та фонових задач ---
async def main_async():
    """
    Ця функція запускає всі асинхронні процеси:
    - Реєстрація обробників Aiogram
    - Встановлення вебхука
    - Запуск клієнта Telethon для моніторингу
    - Запуск планувальника (Cron-Job) для постингу старих постів
    """

    # 2. Переконуємось, що кеш товарів завантажено при старті
    await xml_parser.get_products_cache()

    # 3. Встановлюємо вебхук
    # Перевіряємо, чи webhook_url взагалі заданий
    if config.webhook_url:
        webhook_url = f"{config.webhook_url.rstrip('/')}{config.webhook_path}"
        current_webhook = await bot.get_webhook_info()
        if current_webhook.url != webhook_url:
            await bot.set_webhook(url=webhook_url)
            logger.info(f"Вебхук встановлено на {webhook_url}")
        else:
            logger.info(f"Вебхук вже встановлено на {webhook_url}")
    else:
        logger.warning("WEBHOOK_URL не вказано! Бот не зможе отримувати оновлення від Telegram.")

    logger.info("Бот готовий до роботи і чекає на вебхуки...")

    # --- ЗАПУСК ФОНОВИХ СЕРВІСІВ ---
    # Створюємо асинхронні задачі, які будуть працювати паралельно
    asyncio.create_task(telethon_service.start_telethon_client(bot))
    asyncio.create_task(scheduler_service.start_scheduler(bot))

# --- Ендпоінти Flask ---
@app.route(config.webhook_path, methods=['POST'])
async def webhook_handler():
    """Цей ендпоінт приймає оновлення від Telegram і передає їх в Aiogram."""
    try:
        update_data = request.get_json()
        update = types.Update.model_validate(update_data, context={"bot": bot})
        await dp.feed_update(bot=bot, update=update)
        return Response(status=200)
    except Exception as e:
        logger.error(f"Помилка в обробнику вебхука: {e}")
        return Response(status=500)

@app.route('/healthz')
def health_check():
    """Ендпоінт для Render Health Check, який показує, що сервіс живий."""
    return "OK", 200

# --- Правильний запуск для Gunicorn (використовується на Render) ---
@app.before_request
def start_bot_loop():
    """
    Цей хук Flask гарантує, що наш асинхронний цикл з ботом
    та фоновими задачами запуститься ЛИШЕ ОДИН РАЗ при старті сервера.
    """
    if not bot_loop_started.is_set():
        bot_loop_started.set()

        def run_loop():
            # Кожна фонова нитка повинна мати свій власний цикл подій
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                # Запускаємо нашу головну асинхронну функцію
                loop.run_until_complete(main_async())
                # Ця функція не завершиться, оскільки в ній є вічні задачі
                loop.run_forever()
            finally:
                loop.close()

        # Запускаємо все це у фоновому потоці, щоб не блокувати веб-сервер
        thread = threading.Thread(target=run_loop)
        thread.daemon = True # Робимо потік демоном, щоб він завершувався разом з основним процесом
        thread.start()