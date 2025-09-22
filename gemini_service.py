# services/gemini_service.py
import logging
import re
import google.generativeai as genai

# Імпортуємо наш централізований конфіг
from config_reader import config

# Налаштовуємо логер
logger = logging.getLogger(__name__)

# Ініціалізуємо модель один раз при завантаженні модуля
model = None
if config.gemini_api_key:
    try:
        genai.configure(api_key=config.gemini_api_key)
        model = genai.GenerativeModel('gemini-1.5-flash')
        logger.info("✅ Сервіс Gemini AI успішно ініціалізовано.")
    except Exception as e:
        logger.error(f"❌ Помилка ініціалізації Gemini AI: {e}")
else:
    logger.warning("⚠️ GEMINI_API_KEY не знайдено. Функціонал AI буде недоступний.")


async def rewrite_post_text(original_text: str) -> str:
    """
    Переписує текст поста за допомогою Gemini AI, зберігаючи артикул.
    Якщо виникає помилка, повертає оригінальний текст.
    """
    if not model:
        logger.warning("Спроба використати Gemini AI, але сервіс не ініціалізовано.")
        return original_text

    # 1. Витягуємо артикул з тексту, щоб він не загубився
    sku_match = re.search(r'Артикул: (\S+)', original_text)
    sku = sku_match.group(1) if sku_match else None
    
    # Ваш унікальний та детальний промпт
    prompt = f"""
        Перепиши цей пост для Telegram-каналу, який продає тактичний одяг та спорядження.
        Стиль: впевнений, трохи агресивний, патріотичний.
        Вимоги:
        1. Збережи ключову інформацію про товар.
        2. Додай емодзі, що відповідають тематиці (🔥, 🇺🇦, 💪, 🎯, ✅).
        3. Структуруй текст: заголовок, опис, характеристики, ціна.
        4. Не вигадуй нічого, чого немає в оригінальному тексті.
        5. Дуже важливо: НЕ ЗМІНЮЙ і не згадуй АРТИКУЛ у своїй відповіді.
        6. Текст має бути повністю українською мовою.

        Оригінальний текст:
        ---
        {original_text}
        ---
        """

    try:
        response = await model.generate_content_async(prompt)
        rewritten_text = response.text

        # 2. Повертаємо артикул на місце, якщо він був знайдений
        if sku:
            # Переконуємось, що "Артикул:" вже є, якщо ні - додаємо
            if "Артикул:" not in rewritten_text:
                 rewritten_text += f"\n\nАртикул: {sku}"

        logger.info(f"Текст для поста з артикулом {sku} успішно переписано.")
        return rewritten_text.strip()

    except Exception as e:
        logger.error(f"Помилка під час роботи з Gemini AI: {e}")
        # У разі помилки повертаємо оригінальний текст, щоб не зупиняти роботу
        return original_text