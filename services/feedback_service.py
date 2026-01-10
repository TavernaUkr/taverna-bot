# services/feedback_service.py
import logging
from aiogram import Bot
from aiogram.types import PollAnswer
from config_reader import config
from database.models import Order
from database.db import AsyncSessionLocal
from sqlalchemy import update
from sqlalchemy.future import select

logger = logging.getLogger(__name__)

# ID твого чату/теми для відгуків `taverna_ukr_voice`
FEEDBACK_CHAT_ID = config.feedback_chat_id 

async def request_feedback(bot: Bot, order: Order):
    """
    (Фаза 3.7) Надсилає клієнту запит на оцінку (Poll) після
    завершення замовлення (коли status='completed').
    """
    # TODO: Ця функція буде викликатися, коли ми отримаємо
    # webhook від Фулфілмент-Хабу НП про те, що замовлення "Доставлено".
    
    logger.info(f"Надсилаю запит на відгук для замовлення {order.order_uid}")
    try:
        user_id = order.user_telegram_id
        
        # Створюємо унікальний ID для опитування
        # Ми "ховаємо" ID замовлення в `poll_id`
        poll_id = f"feedback_{order.id}" 
        
        await bot.send_message(
            chat_id=user_id,
            text=f"Дякуємо за ваше замовлення <b>{order.order_uid}</b>!\n\n"
                 f"Будь ласка, оцініть якість роботи TavernaGroup, це займе 5 секунд:"
        )
        
        # Надсилаємо Опитування
        poll_msg = await bot.send_poll(
            chat_id=user_id,
            question=f"Ваша оцінка замовлення {order.order_uid}:",
            options=["⭐️", "⭐️⭐️", "⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️⭐️"],
            is_anonymous=False, # Нам потрібно знати, хто голосує
            type="quiz", # Тип "Вікторина"
            correct_option_id=4, # Не має значення, але потрібно для quiz
            payload=poll_id # <-- Наш унікальний ID
        )
        
    except Exception as e:
        logger.error(f"Не вдалося надіслати запит на відгук: {e}", exc_info=True)
        
async def process_feedback_poll(bot: Bot, poll_answer: PollAnswer):
    """
    (Фаза 3.7) Обробляє відповідь на опитування (PollAnswer).
    (План 17.2)
    """
    poll_id = poll_answer.poll_id
    if not poll_id.startswith("feedback_"):
        return # Це не наше опитування

    try:
        order_id = int(poll_id.split("_")[1])
        # Оцінка = індекс кнопки (0=1, 1=2, ..., 4=5)
        rating = poll_answer.option_ids[0] + 1 
        user_id = poll_answer.user.id
        
        logger.info(f"Отримано відгук! Замовлення: {order_id}, Оцінка: {rating}★, User: {user_id}")
        
        # 1. Зберігаємо оцінку в БД
        async with AsyncSessionLocal() as db:
            async with db.begin():
                await db.execute(
                    update(Order).where((Order.id == order_id) & (Order.user_telegram_id == user_id))
                    .values(rating=rating)
                )
            await db.commit()
            
        # 2. Відповідаємо клієнту
        await bot.send_message(
            chat_id=user_id,
            text=f"Дякуємо за вашу оцінку ({'⭐️' * rating})! Ваш відгук опубліковано анонімно у `Taverna Voice`."
        )
        
        # 3. Публікуємо анонімний відгук у `taverna_ukr_voice`
        await bot.send_message(
            chat_id=FEEDBACK_CHAT_ID,
            text=f"💬 **Новий анонімний відгук!**\n\n**Оцінка:** {'⭐️' * rating}"
            # Ми не показуємо ім'я, як ти і просив
        )
        
        # 4. Оновлюємо головне опитування (Твій План 17.2)
        # **Рішення (15G):** Як я і казав, API Телеграм НЕ ДОЗВОЛЯЄ боту "голосувати"
        # у чужому опитуванні або редагувати його опції.
        # **АЛЕ** ми можемо *зупинити* старе опитування і *надіслати нове*
        # з оновленими даними, а потім *закріпити* його.
        # (Це складна логіка, ми реалізуємо її у Фазі 5,
        # поки що достатньо публікації відгуків вище).

    except Exception as e:
        logger.error(f"Помилка обробки відгуку (PollAnswer): {e}", exc_info=True)