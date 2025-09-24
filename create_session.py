# create_session.py
from telethon import TelegramClient
import asyncio

# ‼️ ВАЖЛИВО: Переконайтесь, що ці значення відповідають вашим даним з .env файлу ‼️
api_id = 26537770  # Ваш TG_API_ID
api_hash = '4a0b761a1d24b8deaf29c5020eac1cc6' # Ваш TG_API_HASH - ТЕПЕР В ЛАПКАХ!
session_name = 'bot1'

async def main():
    print("Запуск створення сесії Telethon...")
    client = TelegramClient(session_name, api_id, api_hash)
    await client.start()
    print("==========================================================")
    print("!!! ВХІД УСПІШНИЙ! Файл сесії 'bot1.session' створено. !!!")
    print("==========================================================")
    me = await client.get_me()
    print(f"Ви увійшли як: {me.first_name} (@{me.username})")
    print("Тепер можете закрити цю програму (Ctrl+C).")
    await client.disconnect()

if __name__ == '__main__':
    asyncio.run(main())

