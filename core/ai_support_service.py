# core/ai_support_service.py
"""
AI-резюмування тікетів підтримки + архітектура під транскрипцію голосових.

Що робить:
- generate_ticket_summary(): при закритті тікета збирає всю переписку
  (TicketMessage, сортовані за created_at), формує діалог "Role: Text"
  і просить Gemini зробити короткий звіт українською (до 500 символів).
- Сервіс викликається через FastAPI BackgroundTasks, тому ВІДКРИВАЄ
  ВЛАСНУ сесію БД (AsyncSessionLocal), якщо session=None: сесія запиту
  закривається одразу після відповіді клієнту і непридатна для фону.

Архітектура під транскрипцію голосових (Крок 2 БД):
- TicketMessage.media_url — посилання на файл (voice/video_note);
- TicketMessage.is_transcribed — прапорець "голосове вже розшифровано";
- _render_dialogue() позначає нерозшифровані голосові як
  "[Голосове повідомлення — не розшифровано]", щоб Gemini не вигадував зміст.

Gemini: використовуємо існуючу асинхронну обгортку проєкту
services.gemini_service._generate_content (google-genai + ротація ключів при 429).
"""
import logging
from typing import List, Optional

from sqlalchemy import select

from database.db import AsyncSession, AsyncSessionLocal
from database.models import SupportTicket, TicketMessage
from services import gemini_service

logger = logging.getLogger(__name__)

# Ролі, які людиночитабельно підставляємо у діалог для Gemini
_ROLE_LABELS = {
    "customer": "Клієнт",
    "manager": "Менеджер",
    "supplier": "Постачальник (власник магазину)",
    "ai_bot": "AI-бот підтримки",
}

# Обмеження розміру діалогу, що йде в Gemini (захист від величезних тікетів)
MAX_DIALOGUE_CHARS = 30000
# Обмеження довжини самого резюме
MAX_SUMMARY_CHARS = 500


class AISupportService:
    """
    AI-аналіз комунікації в тікетах підтримки.
    Поки що — резюме при закритті; далі (архітектурно) — транскрипція голосових.
    """

    # ---------------------------------------------------------------
    # Діалог → текст для Gemini
    # ---------------------------------------------------------------
    @staticmethod
    def _render_dialogue(messages: List[TicketMessage]) -> str:
        """
        Формує текстовий діалог у вигляді: "Role: Text \\n Role: Text...".
        Голосові без транскрипції позначаємо явно, щоб AI не вигадував.
        """
        lines: List[str] = []
        for msg in messages:
            role = _ROLE_LABELS.get(msg.sender_role, msg.sender_role)
            text = (msg.text or "").strip()
            # Архітектура під транскрипцію: якщо це медіа-повідомлення,
            # яке ще не розшифроване — не даємо AI текст, якого не існує.
            if msg.media_url and not text:
                text = (
                    "[Голосове повідомлення — розшифровано]"
                    if msg.is_transcribed
                    else "[Голосове повідомлення — не розшифровано]"
                )
            lines.append(f"{role}: {text}")
        dialogue = "\n".join(lines)
        # Захист від гігантських переписок: обрізаємо з кінця (найновіші важливіші)
        if len(dialogue) > MAX_DIALOGUE_CHARS:
            dialogue = dialogue[-MAX_DIALOGUE_CHARS:]
        return dialogue

    # ---------------------------------------------------------------
    # Резюме тікета (викликається при закритті)
    # ---------------------------------------------------------------
    @staticmethod
    async def generate_ticket_summary(
        ticket_id: int,
        session: Optional[AsyncSession] = None,
    ) -> str:
        """
        Генерує коротке AI-резюме переписки тікета і ЗБЕРІГАЄ його
        у SupportTicket.ai_summary. Повертає текст резюме (або "").

        Можна викликати двояко:
        1) передати сесію запиту (якщо викликаєте прямо в ендпоінті);
        2) передати session=None — тоді сервіс сам відкриє/закриє сесію
           (єдиний правильний спосіб для FastAPI BackgroundTasks).
        """
        # BackgroundTasks: сесія запиту вже закрита — відкриваємо власну
        own_session = session is None
        if own_session:
            if AsyncSessionLocal is None:
                logger.error("AI-резюме #%s: AsyncSessionLocal не ініціалізовано.", ticket_id)
                return ""
            session = AsyncSessionLocal()

        try:
            # 1. Усі повідомлення тікета, відсортовані за created_at
            messages = (
                await session.execute(
                    select(TicketMessage)
                    .where(TicketMessage.ticket_id == ticket_id)
                    .order_by(TicketMessage.created_at.asc(), TicketMessage.id.asc())
                )
            ).scalars().all()

            if not messages:
                logger.warning("AI-резюме #%s: повідомлень немає — нічого резюмувати.", ticket_id)
                return ""

            # 2. Текстовий діалог: "Role: Text \n Role: Text..."
            dialogue = AISupportService._render_dialogue(messages)

            # 3. Промт у Gemini
            prompt = (
                "Проаналізуй цей діалог між клієнтом і підтримкою. "
                "Напиши короткий звіт (до 500 символів) українською: "
                "1) Суть звернення. 2) Яке рішення було прийнято.\n\n"
                f"Діалог:\n{dialogue}"
            )

            summary = ""
            try:
                summary = await gemini_service._generate_content(
                    prompt,
                    system_instruction=(
                        "Ти — аналітик служби підтримки маркетплейсу. "
                        "Ти пишеш стислі, фактичні звіти українською, без води, "
                        "без вигадок. Якщо рішення в діалозі не прозвучало — так і напиши."
                    ),
                    temperature=0.3,
                    max_output_tokens=1024,
                )
            except Exception as e:
                logger.error(
                    "AI-резюме #%s: помилка Gemini: %s", ticket_id, e, exc_info=True
                )
                return ""

            summary = (summary or "").strip()[:MAX_SUMMARY_CHARS]

            # 4. Зберігаємо результат у ticket.ai_summary
            if summary:
                ticket = await session.get(SupportTicket, ticket_id)
                if ticket is not None:
                    ticket.ai_summary = summary
                    await session.commit()
                    logger.info("AI-резюме #%s збережено (%s символів).", ticket_id, len(summary))

            return summary

        finally:
            if own_session and session is not None:
                await session.close()


# Єдиний інстанс для імпорту в ендпоінтах: api.tickets
ai_support_service = AISupportService()
