# bot.py
import logging
import asyncio
from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.redis import RedisStorage
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

# --- НОВІ ІМПОРТИ ---
from aiogram.types import (
    BotCommand, 
    BotCommandScopeDefault, 
    WebAppInfo, 
    MenuButtonWebApp
)
# ---

from config_reader import config
from database.db import init_db
from services import telethon_service, scheduler_service
from handlers import (
    user_commands,
    product_handlers,
    cart_handlers,
    feedback_handler,
    admin_handlers,
    supplier_actions_handler # <-- НОВИЙ ІМПОРТ
)

logger = logging.getLogger(__name__)


# --- НОВА ФУНКЦІЯ ---
async def set_main_menu(bot: Bot):
    """
    Встановлює головне меню бота (команди /start, /basket) 
    та кнопку MenuButton (ліворуч), яка запускає MiniApp.
    """
    
    # 1. Встановлюємо список команд (те, що випадає при з /)
    main_commands = [
        BotCommand(command="/start", description="Перезапустити бота"),
        BotCommand(command="/basket", description="🛒 Мій кошик"),
        # TODO: У майбутньому додамо /my_orders, /help тощо
    ]
    await bot.set_my_commands(main_commands, BotCommandScopeDefault())
    
    # 2. Встановлюємо Кнопку Меню (ліворуч від поля вводу)
    if config.webapp_url:
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(
                text="Каталог", # Короткий текст для кнопки
                web_app=WebAppInfo(url=config.webapp_url)
            )
        )
        logger.info(f"Встановлено кнопку MenuButton (MiniApp) з URL: {config.webapp_url}")
    else:
        # Якщо URL не вказано, просто ставимо меню команд
        await bot.set_chat_menu_button(
            menu_button=None # Використовує MenuButtonDefault
        )
        logger.warning("WEBAPP_URL не вказано в .env! Кнопка MiniApp не буде встановлена.")
# --- КІНЕЦЬ НОВОЇ ФУНКЦІЇ ---


async def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
    )
    logger.info("Starting bot...")

    # Ініціалізація БД
    await init_db()

    # Ініціалізація Redis
    try:
        storage = RedisStorage.from_url(config.redis_url)
        logger.info("Підключено до Redis для FSM.")
    except Exception as e:
        logger.error(f"Не вдалося підключитися до Redis: {e}. Використовую MemoryStorage.")
        from aiogram.fsm.storage.memory import MemoryStorage
        storage = MemoryStorage()

    bot = Bot(
        token=config.bot_token.get_secret_value(),
        default=DefaultBotProperties(parse_mode=ParseMode.HTML)
    )
    dp = Dispatcher(storage=storage)

    # Реєстрація роутерів
    dp.include_router(user_commands.router)
    dp.include_router(product_handlers.router)
    dp.include_router(cart_handlers.router)
    dp.include_router(feedback_handler.router)
    dp.include_router(admin_handlers.router)
    dp.include_router(supplier_actions_handler.router)

    # --- ДОДАЄМО ВИКЛИК ---
    # Встановлюємо команди та кнопку меню
    await set_main_menu(bot)
    # ---

    # Запускаємо фонові сервіси (Telethon, Scheduler)
    # Передаємо 'bot' у сервіси, яким він потрібен
    asyncio.create_task(telethon_service.start_telethon_client(bot))
    asyncio.create_task(scheduler_service.start_scheduler(bot))

    try:
        await bot.delete_webhook(drop_pending_updates=True)
        logger.info("Running bot with polling...")
        await dp.start_polling(bot)
    finally:
        await bot.session.close()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Bot stopped.")