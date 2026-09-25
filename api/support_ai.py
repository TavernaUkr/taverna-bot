# api/support_ai.py
"""
Контекстний AI-чат клієнтської підтримки (B2C) — Крок 2 багатокрокового
флоу «Категорії → AI-Чат → Тікет».

Що робить:
- POST /api/v1/support/ai/chat — приймає категорію + історію повідомлень,
  підставляє ПРИХОВАНИЙ системний промт під категорію, питає Gemini
  (services.gemini_service, ротація ключів при 429) і повертає:
    * reply — текст відповіді клієнту;
    * escalate — чи потрібна жива людина (менеджер магазину/модератор);
    * ticket_topic / ticket_text — зібрана суть для створення тікета.

Правила ескалації (AI повертає JSON, але фронт не блочимо — є fallback):
- 'supplier' → питання до постачальника (менеджер магазину);
- 'tech'      → технічна підтримка платформи;
- 'complaint' → скарги (розслідує модератор/адмін);
- 'rating'    → оцінки (AI дякує, тікет не потрібен).

Авторизація: НЕ обов'язкова (гість може поставити питання), але якщо
є Bearer initData — передаємо ім'я/роль у промт для персоналізації.
"""
import logging
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.auth import validate_init_data
from database.db import get_db, AsyncSession
from services import gemini_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/support/ai", tags=["Support AI Chat (B2C)"])

# --- Категорії флоу (ідентичні меню /support на фронтенді) -------------------

SUPPORT_CATEGORY_IDS = {"supplier", "tech", "complaint", "rating"}

"""
Приховані системні промти. Це серце флоу: AI дізнається, що клієнт обрав,
і діє за сценарієм категорії. Промт НІКОЛИ не потрапляє на фронтенд.
"""
CATEGORY_SYSTEM_PROMPTS: Dict[str, str] = {
    "supplier": (
        "Ти — віртуальна служба підтримки маркетплейсу Taverna (тактичне та "
        "військове спорядження). Клієнт обрав розділ «Питання до постачальника» "
        "(замовлення, товари, доставка).\n"
        "Твоє завдання:\n"
        "1. Витягни номер замовлення ( формат '№12345' або '12345' чи ТТН) та "
        "назву магазину, якщо клієнт їх назвав.\n"
        "2. Дай корисну відповідь за загальними правилами (терміни доставки 1-3 "
        "дні Нова Пошта, повернення 14 днів у оригінальній упаковці).\n"
        "3. Якщо питання стосується конкретного замовлення/магазину (де посилка, "
        "проблема з товаром, обмін/повернення, скарга на роботу магазину) — "
        "потрібна ескалація: прямо запропонуй «підключити менеджера магазину».\n"
        "4. НЕ вигадуй статуси конкретного замовлення — ти їх не бачиш."
    ),
    "tech": (
        "Ти — віртуальна технічна підтримка маркетплейсу Taverna. Клієнт обрав "
        "розділ «Технічна підтримка» (проблеми з додатком, баги).\n"
        "Твоє завдання:\n"
        "1. уточни, що саме не працює (екран, кнопка, оплата, авторизація) та на "
        "якому пристрої;\n"
        "2. запропонуй базові кроки (перезавантажити Mini App, оновити Telegram, "
        "перевірити інтернет);\n"
        "3. якщо проблема не знімається базовими кроками АБО виглядає як баг "
        "(помилка на екрані, зникли дані, не проходить оплата) — ескалація: "
        "запропонуй «передати розробникам».\n"
        "4. НЕ обіцяй термінів виправлення."
    ),
    "complaint": (
        "Ти — віртуальна служба підтримки маркетплейсу Taverna. Клієнт обрав "
        "розділ «Скарги» (на модератора, адміна, продавця).\n"
        "Твоє завдання:\n"
        "1. Запитай, НА КОГО скарга (модератор / адміністратор / продавець-"
        "магазин) та номер замовлення, якщо скарга стосується замовлення.\n"
        "2. Зафіксуй суть порушення одним-двома реченнями (що сталося, коли).\n"
        "3. Поясни, що скарги анонімні та розглядаються керівництвом платформи.\n"
        "4. Після збору істоти — одразу ескалація модератору: запропонуй "
        "«передати скаргу на розгляд».\n"
        "5. Будь нейтральним, не обіцяй результат розгляду."
    ),
    "rating": (
        "Ти — віртуальна служба підтримки маркетплейсу Taverna. Клієнт обрав "
        "розділ «Оцінки» (оцінити магазин або додаток).\n"
        "Твоє завдання:\n"
        "1. Подякуй за бажання оцінити.\n"
        "2. Уточни, що саме він хоче оцінити — магазин (тоді назви чи номер "
        "магазину) чи додаток.\n"
        "3. Якщо клієнт хоче оцінити МАГАЗИН — дай інструкцію: Головна → "
        "Постачальники → обрати магазин → вкладка «Відгуки» на сторінці магазину "
        "( або зі сторінки «Мої замовлення» кнопкою «Оцінити магазин»).\n"
        "4. Якщо клієнт хоче оцінити ДОДАТОК — запропонуй йому оцінити прямо "
        "зараз через вбудований віджет (кнопка «Оцінити додаток») або в "
        "магазинах застосунків. Це і є «ескалація» категорії rating: у "
        "відповіді ОБОВ'ЯЗКОВО попроси поставити оцінку та зазначень.\n"
        "5. Тікет для оцінок НЕ створюємо."
    ),
}

# Яку тему тікета ставити для кожної категорії (TicketCreate.topic)
CATEGORY_TICKET_TOPICS: Dict[str, str] = {
    "supplier": "question",
    "tech": "other",
    "complaint": "complaint",
    "rating": "question",
}

# --- Pydantic-моделі ----------------------------------------------------------

class SupportAiMessage(BaseModel):
    """Одне повідомлення історії чату."""
    role: Literal["user", "assistant"] = "user"
    content: str = Field(min_length=1, max_length=4000)


class SupportAiChatRequest(BaseModel):
    category: Literal["supplier", "tech", "complaint", "rating"]
    messages: List[SupportAiMessage] = Field(min_length=1, max_length=30)
    supplier_id: Optional[int] = Field(default=None, gt=0)
    order_id: Optional[int] = Field(default=None, gt=0)


class SupportAiChatResponse(BaseModel):
    reply: str
    escalate: bool = False
    ticket_topic: Optional[str] = None
    ticket_text: Optional[str] = None


# --- Допоміжні ----------------------------------------------------------------

def _short_json_prompt_hint() -> str:
    """
    Інструкція Gemini відповісти СТРУКТУРОВО. Gemini зобов'язаний повернути
    JSON-об'єкт {reply, escalate, ticket_text} — фронтенд далі малює
    відповідь і, за потреби, кнопку «Створити звернення».
    """
    return (
        "\n\nФОРМАТ ВІДПОВІДІ (строго JSON, без markdown-огорож):\n"
        '{"reply": "<текст відповіді клієнту українською, 2-5 речень>", '
        '"escalate": <true|false>, '
        '"ticket_text": "<одне-два речення: суть звернення для тікета, або null>"}\n'
        "Правила:\n"
        "- escalate=true — лише якщо потрібна жива людина (менеджер магазину, "
        "розробник чи модератор) або клієнт прямо просить людину;\n"
        "- ticket_text — обов'язковий, коли escalate=true (стоф);\n"
        "- Не додавай жодного тексту поза JSON."
    )


async def _resolve_user_optional(
    authorization: Optional[str],
    db: AsyncSession,
) -> Optional[Dict[str, Any]]:
    """Ім'я/роль авторизованого клієнта для персоналізації промта."""
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    try:
        user_data = validate_init_data(token.strip())
    except Exception:
        return None
    if not user_data:
        return None
    first_name = str(user_data.get("first_name") or "").strip()
    username = str(user_data.get("user_name") or user_data.get("username") or "").strip()
    return {"name": first_name or username or ""}


@router.post("/chat", response_model=SupportAiChatResponse)
async def support_ai_chat(
    payload: SupportAiChatRequest,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """
    Контекстний AI-чат підтримки. Приймає категорію + історію, повертає
    відповідь + прапорець ескалації + готовий текст тікета.
    """
    # 0) AI доступний? (ключі Gemini сконфігуровано?)
    if not gemini_service._has_gemini_keys():
        raise HTTPException(
            status_code=503,
            detail="AI-асистент тимчасово недоступний. Спробуйте пізніше.",
        )

    # 1) Збираємо системний промт: базова особистість + сценарій категорії
    base_prompt = (
        "Ти — віртуальна служба підтримки маркетплейсу Taverna "
        "(тактичне/військове спорядження, Україна). Відповідай ТІЛЬКИ українською, "
        "дружньо, стисло (2-5 речень), без вигадок. Не вигадуй статуси замовлень."
    )
    category_prompt = CATEGORY_SYSTEM_PROMPTS[payload.category]

    user_info = await _resolve_user_optional(authorization, db)
    personalization = ""
    if user_info and user_info.get("name"):
        personalization = f"\n\nКлієнта звати: {user_info['name']}."

    system_instruction = (
        base_prompt
        + "\n\n"
        + category_prompt
        + personalization
        + _short_json_prompt_hint()
    )

    # 2) Історія → звичайний діалог для Gemini
    history_lines: List[str] = []
    for msg in payload.messages[-12:]:
        who = "Клієнт" if msg.role == "user" else "Підтримка"
        history_lines.append(f"{who}: {msg.content}")
    dialogue = "\n".join(history_lines)

    prompt = (
        f"Категорія звернення: {payload.category}\n"
        f"supplier_id: {payload.supplier_id or 'не вказано'}\n"
        f"order_id: {payload.order_id or 'не вказано'}\n\n"
        f"Діалог:\n{dialogue}"
    )

    # 3) Gemini → JSON {reply, escalate, ticket_text}
    try:
        raw = await gemini_service._generate_content(
            prompt,
            system_instruction=system_instruction,
            temperature=0.4,
            max_output_tokens=800,
        )
    except Exception as e:
        logger.error("Support AI chat: Gemini error: %s", e, exc_info=True)
        raise HTTPException(
            status_code=502,
            detail="AI-сервер не відповів. Спробуйте ще раз.",
        )

    parsed = gemini_service.extract_gemini_json(raw) if raw else None
    reply_text = ""
    escalate = False
    ticket_text: Optional[str] = None

    if isinstance(parsed, dict):
        reply_text = str(parsed.get("reply") or "").strip()
        escalate = bool(parsed.get("escalate"))
        tt = parsed.get("ticket_text")
        ticket_text = str(tt).strip() if tt else None
    else:
        # Gemini відповів не-JSON (буває) — показуємо як звичайний текст,
        # ескалацію не форсуємо, клієнт може попросити людину вручну.
        reply_text = (raw or "").strip()

    # Страховка: просив людину текстом, але escalate не поставив — ставимо,
    # якщо у відповіді є маркери (стоф-маркери, не AI-вирішуване).
    if not escalate:
        markers = ("менеджер", "розробник", "модератор", "передам", "з'єднати")
        low = reply_text.lower()
        if any(m in low for m in markers) and "ставлю" not in low:
            escalate = True
    if escalate and not ticket_text:
        # Збираємо суть з останнього повідомлення клієнта
        user_msgs = [m for m in payload.messages if m.role == "user"]
        if user_msgs:
            ticket_text = user_msgs[-1].content[:1000]

    return SupportAiChatResponse(
        reply=reply_text or "Вибачте, виникла технічна помилка. Спробуйте ще раз.",
        escalate=escalate,
        ticket_topic=CATEGORY_TICKET_TOPICS[payload.category],
        ticket_text=ticket_text,
    )


@router.get("/support-shop")
async def get_support_shop_id(db: AsyncSession = Depends(get_db)):
    """
    Публічний резолв ID службового магазину платформи «Taverna Support»
    (key='taverna_support'). Фронтенд використовує його як supplier_id
    для тікетів тех. підтримки та скарг на модератора/адміна —
    supplier_id у support_tickets NOT NULL.
    Немає магазину → 503 (ескалація недоступна, фронт покаже toast).
    """
    from database.db import PLATFORM_SUPPORT_SUPPLIER_KEY
    from database.models import Supplier

    supplier = (
        await db.execute(
            select(Supplier.id).where(Supplier.key == PLATFORM_SUPPORT_SUPPLIER_KEY)
        )
    ).scalar_one_or_none()
    if supplier is None:
        raise HTTPException(status_code=503, detail="Служба ескалації недоступна")
    return {"supplier_id": supplier}
