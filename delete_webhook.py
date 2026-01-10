import asyncio
from aiogram import Bot
from config_reader import config
async def main():
    bot = Bot(token=config.bot_token.get_secret_value())
    await bot.delete_webhook(drop_pending_updates=True)
    print("Webhook deleted!")
    await bot.session.close()
asyncio.run(main())