# auth_scraper.py
"""Одноразова авторизація юзербота для читання історії Telegram-каналів."""
import asyncio
from pathlib import Path

from telethon import TelegramClient

from config_reader import config

SESSION_PATH = Path(__file__).resolve().parent / "scraper_session"


def _secret(value) -> str:
    if value is None:
        return ""
    if hasattr(value, "get_secret_value"):
        return str(value.get_secret_value())
    return str(value)


async def main() -> None:
    api_id = config.tg_api_id
    api_hash = _secret(config.tg_api_hash)
    if not api_id or not api_hash:
        raise SystemExit("У .env немає TG_API_ID / TG_API_HASH.")

    client = TelegramClient(str(SESSION_PATH), api_id, api_hash)
    await client.start()
    print("Юзербот успішно авторизовано! Файл scraper_session.session створено.")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
