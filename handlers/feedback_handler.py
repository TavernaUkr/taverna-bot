# handlers/feedback_handler.py
import logging
from aiogram import Router, F
from aiogram.types import PollAnswer
from aiogram.fsm.context import FSMContext
from aiogram import Bot
from services import feedback_service

logger = logging.getLogger(__name__)
router = Router()

@router.poll_answer()
async def handle_feedback_poll_answer(poll_answer: PollAnswer, bot: Bot):
    """
    (Фаза 3.7) "Ловить" відповіді на ВСІ опитування.
    """
    # Передаємо відповідь у наш сервіс, щоб він розібрався, чи це наше опитування
    await feedback_service.process_feedback_poll(bot, poll_answer)