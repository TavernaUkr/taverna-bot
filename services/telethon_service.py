# services/telethon_service.py
import json
import logging
import asyncio
from typing import Any, Dict, Optional
from aiogram import Bot
from telethon import TelegramClient, events
from sqlalchemy.future import select

from config_reader import config
# БІЛЬШЕ НЕ ІМПОРТУЄМО publisher_service
from services import llm_service
from database.db import AsyncSessionLocal
from database.models import Supplier, SupplierType, SupplierStatus # <-- НОВІ ІМПОРТИ

logger = logging.getLogger(__name__)

client = TelegramClient(
    config.session_name,
    config.tg_api_id,
    config.tg_api_hash.get_secret_value(), # .get_secret_value() для Pydantic v2
    system_version="4.16.30-vxCUSTOM"
)


async def extract_product_attributes_with_ai(
    raw_text: str,
    category_hint: str
) -> Optional[Dict[str, Any]]:
    """
    "AI-Класифікатор" (порт з gemini_service на NVIDIA NIM).
    Витягує структуровані дані (атрибути та опції) з хаотичного тексту
    поста постачальника (URL/Telegram).
    """
    if not llm_service.has_llm_keys():
        logger.warning("Видобування атрибутів пропущено (немає NVIDIA_API_KEY).")
        return None

    # Це "мозок" нашого гнучкого парсера.
    # Ми даємо LLM роль і просимо повернути *лише* JSON.
    system_prompt = f"""
Ти - AI-асистент для E-commerce платформи TavernaGroup.
Твоє завдання - аналізувати текст опису товару від постачальника і витягувати з нього *лише* структуровані дані у форматі JSON.
Категорія цього товару: "{category_hint}".

Правила JSON:
1.  `name`: Очищена назва товару (без ціни, розмірів, кольорів).
2.  `attributes`: Об'єкт з фільтрами (Бренд, Матеріал, Рік, Країна, Діагональ...).
3.  `options`: Масив опцій, які впливають на ціну/SKU (Колір, Розмір, Вага, Пам'ять...).
4.  `base_price`: Дроп-ціна, знайдена в тексті (тільки число).

Якщо ти не можеш знайти дані, повертай null.
Повертай *ТІЛЬКИ* JSON, без жодного іншого тексту.

Приклад 1 (Одяг):
Вхід: "Тактична сорочка (убакс) мультикам. Розміри S, M, L. Матеріал: Ріп-стоп. Ціна 900 грн."
Вихід:
{{
  "name": "Тактична сорочка (убакс)",
  "attributes": {{ "Матеріал": "Ріп-стоп" }},
  "options": [
    {{ "name": "Колір", "values": ["мультикам"] }},
    {{ "name": "Розмір", "values": ["S", "M", "L"] }}
  ],
  "base_price": 900
}}

Приклад 2 (Електроніка):
Вхід: "Новий iPhone 15 Pro, 256GB, колір Natural Titanium. В наявності! Ціна 45000 UAH."
Вихід:
{{
  "name": "iPhone 15 Pro",
  "attributes": {{ "Бренд": "Apple", "Модель": "iPhone 15 Pro" }},
  "options": [
    {{ "name": "Пам'ять", "values": ["256GB"] }},
    {{ "name": "Колір", "values": ["Natural Titanium"] }}
  ],
  "base_price": 45000
}}

Приклад 3 (Кава):
Вхід: "Кава 'Арабіка Бразилія'. Вага: 250г або 1кг. Помел: під турку, під еспресо. 250г = 300 грн, 1кг = 1000 грн."
Вихід:
{{
  "name": "Кава 'Арабіка Бразилія'",
  "attributes": {{ "Країна": "Бразилія", "Тип": "Арабіка" }},
  "options": [
    {{ "name": "Вага", "values": ["250г", "1кг"] }},
    {{ "name": "Помел", "values": ["під турку", "під еспресо"] }}
  ],
  "base_price": 300
}}
"""

    try:
        text = await llm_service.generate_json_response(
            prompt=raw_text,
            system_prompt=system_prompt,
            temperature=0.0,
            max_tokens=4096,
        )

        json_data = llm_service.extract_json(text)
        if not isinstance(json_data, dict):
            logger.warning(f"NVIDIA LLM повернув невалідний JSON (extract). Raw: {str(text)[:500]}")
            return None

        logger.info(f"✅ NVIDIA LLM успішно витягнув атрибути: {json_data}")
        return json_data

    except Exception as e:
        logger.error(f"❌ Помилка NVIDIA LLM (extract): {e}", exc_info=True)
        return None

async def handle_independent_post(event: events.NewMessage.Event, supplier: Supplier):
    """
    [ФАЗА 3.6 - "Кругообіг"] (Твій План 17/19)
    Обробляє пост "Незалежного" постачальника.
    1. Бере текст/фото.
    2. Відправляє в NVIDIA LLM для витягування атрибутів (План 19).
    3. Створює/оновлює `Product` та `ProductVariant` в БД.
    """
    logger.info(f"Telethon: Отримано пост від Independent постачальника: {supplier.name}")
    raw_text = event.message.text or ""

    # 1. Викликаємо AI-Класифікатор
    ai_data = await extract_product_attributes_with_ai(
        raw_text,
        category_hint=supplier.category_tag or "unknown"
    )

    if not ai_data:
        logger.warning(f"NVIDIA LLM не зміг розпарсити пост від {supplier.name}")
        return
        
    # 2. Тут буде складна логіка (Фаза 3.6 / 15G):
    # - Знайти `Product` за `ai_data['name']`
    # - Створити `ProductOptions` (з `ai_data['options']`)
    # - Створити `ProductVariant`
    # - Записати `ai_data['attributes']` в `Product.attributes`
    
    logger.info(f"Telethon + AI: Успішно розпарсено товар {ai_data.get('name')} (поки що не збережено в БД)")
    
    # 3. Тимчасова заглушка: просто надсилаємо в тест-канал
    try:
        bot = event.client._bot
        await bot.send_message(
            config.test_channel,
            f"Telethon+NVIDIA LLM розпізнав товар від {supplier.name}:\n"
            f"```json\n{json.dumps(ai_data, ensure_ascii=False, indent=2)}\n```"
        )
    except Exception:
        pass # Не страшно, якщо не вийшло

async def start_telethon_client(bot: Bot):
    """Запускає Telethon та налаштовує обробники для ВСІХ постачальників з БД."""
    if not all([config.tg_api_id, config.tg_api_hash]):
        logger.warning("Telethon не налаштовано (API_ID/API_HASH відсутні).")
        return

    logger.info("Запуск Telethon клієнта...")
    
    try:
        # Pydantic v2 вимагає .get_secret_value()
        await client.start(bot_token=config.bot_token.get_secret_value())
        # Зберігаємо інстанс `bot` всередині `client`, щоб хендлери мали до нього доступ
        client._bot = bot 
        logger.info("Telethon клієнт успішно запущено.")
    except Exception as e:
        logger.error(f"Помилка запуску Telethon: {e}", exc_info=True)
        return

    try:
        from services.telegram_listener import register_telegram_channel_listeners
        register_telegram_channel_listeners(client)
    except Exception as e:
        logger.error("Telethon: не вдалося увімкнути live-слухач каналів: %s", e, exc_info=True)