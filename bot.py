# bot.py
import asyncio
import logging
import traceback

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

async def _dump_asyncio_tasks():
    while True:
        await asyncio.sleep(60)
        try:
            tasks = [t for t in asyncio.all_tasks() if not t.done()]
            print(f"\nASYNCIO: alive_tasks={len(tasks)}", file=sys.stderr, flush=True)
            for i, t in enumerate(tasks[:15], start=1):  # не спамимо, максимум 15
                print(f"  [{i}] {t.get_name()} coro={t.get_coro()}", file=sys.stderr, flush=True)
                stack = t.get_stack(limit=5)
                if not stack:
                    print("       (no stack)", file=sys.stderr, flush=True)
                else:
                    for frame in stack:
                        print("      " + "".join(traceback.format_stack(frame, limit=1)).rstrip(),
                              file=sys.stderr, flush=True)
        except Exception as e:
            print(f"ASYNCIO_DUMP_ERROR: {e}", file=sys.stderr, flush=True)

import asyncio
import logging
import sys
from pathlib import Path

# --- [ФІКС PYTHONPATH] ---
current_dir = Path(__file__).parent
sys.path.append(str(current_dir))

# Імпортуємо ВЖЕ ГОТОВІ `bot`, `dp` та `storage` з нового файлу
from bot_instance import bot, dp, storage
# ---

from aiogram import Bot
from aiogram.types import (
    BotCommand, 
    BotCommandScopeDefault, 
    WebAppInfo, 
    MenuButtonWebApp
)

from config_reader import config
from database.db import init_db
from services import telethon_service, scheduler_service
from handlers import (
    user_commands,
    # product_handlers, # <-- ВИМКНЕНО (Замінено MiniApp)
    # cart_handlers,    # <-- ВИМКНЕНО (Логіка в `user_commands`)
    feedback_handler,
    # admin_handlers, # (Не потрібен для bot.py)
    supplier_actions_handler,
    partner_moderation_handler,
)

logger = logging.getLogger(__name__)

async def set_main_menu(bot_instance: Bot): # (Приймає `bot`)
    # ... (код `set_main_menu` без змін)
    main_commands = [
        BotCommand(command="/start", description="Перезапустити бота"),
        BotCommand(command="/basket", description="🛒 Мій кошик"),
    ]
    await bot_instance.set_my_commands(main_commands, BotCommandScopeDefault())
    await bot_instance.set_chat_menu_button(
        menu_button=MenuButtonWebApp(
            text="🛖ТАВЕРНА🍻",
            web_app=WebAppInfo(url=str(config.webapp_url))
        )
    )

async def main():
    #asyncio.create_task(_dump_asyncio_tasks(), name="debug_task_dump")
    logging.info("BOT: main started")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
    )
    logger.info("Starting bot...")

    # Ініціалізуємо БД
    # await init_db() # (Alembic робить це, не треба тут)

    # --- [ОНОВЛЕНО - ФАЗА 4.4] ---
    # `bot` та `dp` ВЖЕ СТВОРЕНІ. Нам не потрібно їх створювати.
    # ---

    # Реєстрація роутерів
    dp.include_router(user_commands.router)
    # dp.include_router(product_handlers.router) # <-- ВИМКНЕНО
    # dp.include_router(cart_handlers.router)    # <-- ВИМКНЕНО
    dp.include_router(feedback_handler.router)
    dp.include_router(supplier_actions_handler.router)
    dp.include_router(partner_moderation_handler.router)

    # Встановлюємо команди та кнопку меню
    await set_main_menu(bot)

    # Запускаємо фонові сервіси
    asyncio.create_task(telethon_service.start_telethon_client(bot))
    asyncio.create_task(scheduler_service.start_scheduler(bot))

    try:
        await bot.delete_webhook(drop_pending_updates=True)
        await dp.start_polling(bot)
    finally:
        await dp.fsm.storage.close()
        await bot.session.close()
        logger.info("Bot stopped.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Bot stopped by user.")