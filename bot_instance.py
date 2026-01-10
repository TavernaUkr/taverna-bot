# bot_instance.py
import logging
from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.redis import RedisStorage
from redis.asyncio.client import Redis
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from config_reader import config

logger = logging.getLogger(__name__)

# --- [ФАЗА 4.4] Створюємо ОДИН екземпляр "storage" ---
try:
    redis = Redis(host='localhost', port=6379, db=0) # (Переконайся, що Redis запущено)
    storage = RedisStorage(redis=redis)
    logger.info("Підключено до Redis для FSM.")
except Exception as e:
    logger.error(f"Не вдалося підключитися до Redis: {e}. Використовую MemoryStorage.")
    from aiogram.fsm.storage.memory import MemoryStorage
    storage = MemoryStorage()

# --- [ФАЗА 4.4] Створюємо ОДИН екземпляр "bot" ---
bot = Bot(
    token=config.bot_token.get_secret_value(),
    default=DefaultBotProperties(parse_mode=ParseMode.HTML)
)

# --- [ФАЗА 4.4] Створюємо ОДИН "dispatcher" ---
dp = Dispatcher(storage=storage)

# --- [ФАЗА 4.4] Функція "get_bot_instance", яку всі імпортують ---
async def get_bot_instance() -> Bot:
    """
    FastAPI "Dependency" для отримання нашого єдиного екземпляра Бота.
    """
    return bot