# api/tickets.py
"""
Омніканальний комунікаційний міст: Support Tickets + AI-роутинг.
Клієнт створює тікет → AI-бот обробляє (status='ai_handling') →
за потреби ескалація менеджеру магазину (status='escalated').

Доступ (RBAC-lite):
- клієнт: бачить/пише лише у СВОЇ тікети (customer_id == user.id);
- менеджер/власник магазину: бачить/пише у тікети своїх магазинів
  (supplier.user_id == user.id або рядок у supplier_managers).
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import selectinload

from api.auth import validate_init_data
from api_models import (
    MessageCreate,
    TicketCreate,
    TicketMessageResponse,
    TicketResponse,
)
from database.db import get_db, AsyncSession
from database.db import PLATFORM_SUPPORT_SUPPLIER_KEY
from database.models import (
    Order,
    Supplier,
    SupportTicket,
    TicketMessage,
    User,
    supplier_managers,
)
from core.ai_support_service import ai_support_service  # AI-резюме при закритті тікета
from core.billing_service import process_ticket_payout  # B2B-білінг: виплата менеджеру

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/tickets", tags=["Tickets (Mini App)"])

VALID_TICKET_STATUSES = {"ai_handling", "escalated", "closed"}


def _telegram_id_from_authorization(authorization: Optional[str]) -> Optional[int]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    user_data = validate_init_data(token.strip())
    if user_data is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid initData: Hash mismatch or expired",
        )
    raw_id = user_data.get("id")
    if not raw_id:
        raise HTTPException(status_code=401, detail="Invalid initData: user is missing")
    return int(raw_id)


async def _get_user_by_telegram_id(db: AsyncSession, telegram_id: int) -> Optional[User]:
    return (
        await db.execute(select(User).where(User.telegram_id == telegram_id))
    ).scalar_one_or_none()


async def _user_manages_supplier(db: AsyncSession, user_id: int, supplier_id: int) -> bool:
    """Чи є юзер власником або менеджером магазину (supplier_id)."""
    owner_or_manager = (
        await db.execute(
            select(Supplier.id).where(
                Supplier.id == supplier_id,
                or_(
                    Supplier.user_id == user_id,
                    Supplier.managers.any(id=user_id),
                ),
            )
        )
    ).scalar_one_or_none()
    return owner_or_manager is not None


async def _user_can_access_supplier_tickets(db: AsyncSession, user: "User", supplier_id: int) -> bool:
    """
    Розширений доступ до тікетів магазину:
    - власник/менеджер магазину — як раніше;
    - АДМІН платформи — додатково до службового магазину «Taverna Support»
      (тех. підтримка, скарги на модератора/адміна), бо в нього немає
      власного магазину-власника, а розглядати ці звернення musить хтось
      з керівництва платформи.
    """
    if await _user_manages_supplier(db, user.id, supplier_id):
        return True
    role = getattr(user, "role", None)
    if str(role) == "UserRole.admin" or str(getattr(role, "value", "")) == "admin":
        support_id = (
            await db.execute(
                select(Supplier.id).where(Supplier.key == PLATFORM_SUPPORT_SUPPLIER_KEY)
            )
        ).scalar_one_or_none()
        return support_id is not None and supplier_id == support_id
    return False


async def _get_ticket_with_access(
    db: AsyncSession,
    ticket_id: int,
    user: User,
) -> tuple[Optional[SupportTicket], Optional[str]]:
    """
    Тікет, якщо юзер — клієнт-автор АБО представник магазину (власник/менеджер).
    Повертає (ticket, None) або (None, reason_403/404).
    """
    ticket = await db.get(SupportTicket, ticket_id)
    if not ticket:
        return None, "Тікет не знайдено"

    if ticket.customer_id == user.id:
        return ticket, None

    if await _user_can_access_supplier_tickets(db, user, ticket.supplier_id):
        return ticket, None

    return None, "Немає доступу до цього тікета"


@router.post("/", response_model=TicketResponse, status_code=201)
async def create_ticket(
    payload: TicketCreate,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """
    Клієнт створює тікет до магазину. Одразу створюється перше
    повідомлення з текстом клієнта. Status='ai_handling' за замовчуванням.
    """
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    # Магазин має існувати (без видалених)
    supplier = await db.get(Supplier, payload.supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Магазин не знайдено")

    # Якщо тікет прив'язаний до замовлення — воно має належати клієнту
    # і стосуватись цього ж магазину.
    if payload.order_id is not None:
        order = await db.get(Order, payload.order_id)
        if not order:
            raise HTTPException(status_code=404, detail="Замовлення не знайдено")
        order_customer_tg = order.user_telegram_id
        if order_customer_tg is None or order_customer_tg != user.telegram_id:
            raise HTTPException(
                status_code=403,
                detail="Це замовлення не належить вам",
            )
        if order.supplier_id is not None and order.supplier_id != payload.supplier_id:
            raise HTTPException(
                status_code=400,
                detail="Замовлення стосується іншого магазину",
            )

    ticket = SupportTicket(
        order_id=payload.order_id,
        customer_id=user.id,
        supplier_id=payload.supplier_id,
        status="ai_handling",
        topic=payload.topic,
    )
    db.add(ticket)
    await db.flush()  # отримуємо ticket.id для першого повідомлення

    first_message = TicketMessage(
        ticket_id=ticket.id,
        sender_id=user.id,
        sender_role="customer",
        text=payload.text,
        is_read=False,
    )
    db.add(first_message)
    await db.commit()
    await db.refresh(ticket)

    logger.info(
        "Створено тікет #%s (customer=%s, supplier=%s, order=%s, topic=%s)",
        ticket.id, user.id, payload.supplier_id, payload.order_id, payload.topic,
    )
    return TicketResponse(
        id=ticket.id,
        order_id=ticket.order_id,
        customer_id=ticket.customer_id,
        supplier_id=ticket.supplier_id,
        assigned_manager_id=ticket.assigned_manager_id,
        status=ticket.status,
        topic=ticket.topic,
        ai_summary=ticket.ai_summary,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        message_count=1,
        last_message_at=ticket.created_at,
    )


@router.get("/me", response_model=List[TicketResponse])
async def get_my_tickets(
    role: str = Query(default="customer", pattern="^(customer|manager)$"),
    status: Optional[str] = Query(default=None),
    supplier_id: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """
    Тікети поточного юзера.
    role='customer' — тікети, які він створив (customer_id == user.id).
    role='manager' — тікети магазинів, де він власник/менеджер.
    Фільтр status: 'ai_handling' | 'escalated' | 'closed'.
    Фільтр supplier_id — тікети саме цього магазину (Orders Hub, вкладка
    «Чат з клієнтами»: SupportPanel supplierId={shop.id}).
    """
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    if status is not None and status not in VALID_TICKET_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Невірний status. Дозволені: {', '.join(sorted(VALID_TICKET_STATUSES))}",
        )
    if supplier_id is not None and not await _user_manages_supplier(db, user.id, supplier_id):
        raise HTTPException(
            status_code=403,
            detail="Немає доступу до тікетів цього магазину",
        )

    # Базовий підзапит агрегатів: кількість повідомлень + час останнього.
    msg_agg = (
        select(
            TicketMessage.ticket_id.label("tid"),
            func.count(TicketMessage.id).label("message_count"),
            func.max(TicketMessage.created_at).label("last_message_at"),
        )
        .group_by(TicketMessage.ticket_id)
        .subquery()
    )

    conditions = []
    if role == "customer":
        conditions.append(SupportTicket.customer_id == user.id)
    else:
        # Магазини, де юзер власник або менеджер
        managed_supplier_ids = (
            select(Supplier.id).where(
                or_(
                    Supplier.user_id == user.id,
                    Supplier.managers.any(id=user.id),
                )
            )
        )
        # Адміністратори платформи додатково бачать тікети службового
        # магазину «Taverna Support» (тех. підтримка + скарги на персонал).
        if str(getattr(user, "role", "")) == "UserRole.admin" or getattr(user, "role", None) == "admin":
            support_supplier_id = (
                select(Supplier.id).where(
                    Supplier.key == PLATFORM_SUPPORT_SUPPLIER_KEY
                )
            )
            conditions.append(
                or_(
                    SupportTicket.supplier_id.in_(managed_supplier_ids),
                    SupportTicket.supplier_id.in_(support_supplier_id),
                )
            )
        else:
            conditions.append(SupportTicket.supplier_id.in_(managed_supplier_ids))

    stmt = (
        select(SupportTicket, msg_agg.c.message_count, msg_agg.c.last_message_at)
        .outerjoin(msg_agg, msg_agg.c.tid == SupportTicket.id)
        .where(*conditions)
    )
    if status is not None:
        stmt = stmt.where(SupportTicket.status == status)
    # Orders Hub: тікети саме цього магазину (SupportPanel supplierId)
    if supplier_id is not None:
        stmt = stmt.where(SupportTicket.supplier_id == supplier_id)
    stmt = (
        stmt
        .order_by(SupportTicket.updated_at.desc().nullslast(), SupportTicket.id.desc())
        .limit(limit)
        .offset(offset)
    )

    rows = (await db.execute(stmt)).all()
    return [
        TicketResponse(
            id=t.id,
            order_id=t.order_id,
            customer_id=t.customer_id,
            supplier_id=t.supplier_id,
            assigned_manager_id=t.assigned_manager_id,
            status=t.status,
            topic=t.topic,
            ai_summary=t.ai_summary,
            created_at=t.created_at,
            updated_at=t.updated_at,
            message_count=int(message_count or 0),
            last_message_at=last_message_at,
        )
        for (t, message_count, last_message_at) in rows
    ]


@router.post("/{ticket_id}/assign", response_model=TicketResponse)
async def assign_ticket(
    ticket_id: int,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """
    «Взяти тікет в роботу» (Claim Ticket). Менеджер/власник магазину
    закріплює тікет за собою:
    - assigned_manager_id = current_user.id (на це поле зав'язаний білінг
      rate_per_dispute при закритті тікета);
    - status: 'ai_handling' → 'escalated' (аналог «new/open → in_progress»:
      'escalated' у цій системі і означає «взяв менеджер»).
    Повторне взяття неможливе: 400, якщо тікет уже закріплено.
    """
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    ticket, reason = await _get_ticket_with_access(db, ticket_id, user)
    if not ticket:
        code = 404 if reason == "Тікет не знайдено" else 403
        raise HTTPException(status_code=code, detail=reason)

    # Лиш представник магазину (менеджер/власник) може забрати тікет.
    # Адміні платформи — тікети службового магазину «Taverna Support».
    # Клієнт-автор сюди не доходить: гейт нижче його відсікає.
    if not await _user_can_access_supplier_tickets(db, user, ticket.supplier_id):
        raise HTTPException(
            status_code=403,
            detail="Взяти тікет в роботу може лише менеджер магазину",
        )

    if ticket.status == "closed":
        raise HTTPException(status_code=400, detail="Тікет закрито")

    if ticket.assigned_manager_id is not None:
        raise HTTPException(status_code=400, detail="Ticket already assigned")

    ticket.assigned_manager_id = user.id
    if ticket.status == "ai_handling":
        ticket.status = "escalated"
    ticket.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(ticket)

    logger.info(
        "Тікет #%s взято в роботу: manager user=%s (status=%s)",
        ticket.id, user.id, ticket.status,
    )

    return TicketResponse(
        id=ticket.id,
        order_id=ticket.order_id,
        customer_id=ticket.customer_id,
        supplier_id=ticket.supplier_id,
        assigned_manager_id=ticket.assigned_manager_id,
        status=ticket.status,
        topic=ticket.topic,
        ai_summary=ticket.ai_summary,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
    )


@router.patch("/{ticket_id}/close", response_model=TicketResponse)
async def close_ticket(
    ticket_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """
    Закриття тікета. Тільки представник магазину (власник/менеджер).
    status → 'closed', після чого у фоні (BackgroundTasks) Gemini генерує
    ai_summary — коротке резюме всієї переписки, щоб власник/модератор
    одразу бачив суть проблеми та прийняте рішення.
    """
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    ticket, reason = await _get_ticket_with_access(db, ticket_id, user)
    if not ticket:
        code = 404 if reason == "Тікет не знайдено" else 403
        raise HTTPException(status_code=code, detail=reason)

    # Лиш клієнт-автор не може закривати тікет — тільки магазин:
    # менеджер або власник (supplier), що має доступ до цього магазину.
    if ticket.customer_id == user.id and not await _user_can_access_supplier_tickets(
        db, user, ticket.supplier_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Закрити тікет може лише менеджер або власник магазину",
        )

    if ticket.status == "closed":
        raise HTTPException(status_code=400, detail="Тікет уже закрито")

    ticket.status = "closed"
    ticket.updated_at = datetime.now(timezone.utc)

    # B2B-білінг: розрахунок з менеджером за тарифом rate_per_dispute.
    # Строго СИНХРОННО до commit (не BackgroundTasks!): переказ балансів,
    # ledger-записи та закриття тікета — одна атомарна транзакція БД.
    # Якщо білінг впаде (наприклад, контракт недоступний) — закриття
    # відкотиться разом із ним, гроші не загубляться.
    payout_amount = await process_ticket_payout(ticket.id, db)

    await db.commit()
    await db.refresh(ticket)

    # Background Task: AI-резюме не блокує відповідь клієнту.
    # Сервіс сам відкриє власну сесію БД (сесія запиту вже закриється).
    background_tasks.add_task(ai_support_service.generate_ticket_summary, ticket.id)

    logger.info(
        "Тікет #%s закрито user=%s. AI-резюме поставлено у фонову чергу. Виплата менеджеру: %s коп.",
        ticket.id, user.id, payout_amount,
    )

    return TicketResponse(
        id=ticket.id,
        order_id=ticket.order_id,
        customer_id=ticket.customer_id,
        supplier_id=ticket.supplier_id,
        assigned_manager_id=ticket.assigned_manager_id,
        status=ticket.status,
        topic=ticket.topic,
        ai_summary=ticket.ai_summary,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        message_count=0,
        last_message_at=None,
    )


@router.post("/{ticket_id}/messages", response_model=TicketMessageResponse, status_code=201)
async def add_ticket_message(
    ticket_id: int,
    payload: MessageCreate,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """
    Додає повідомлення в тікет. Доступ: автор-клієнт або представник
    магазину (власник/менеджер). sender_role має відповідати реальній
    ролі юзера (захист від підробки ролі в payload).
    """
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    ticket, reason = await _get_ticket_with_access(db, ticket_id, user)
    if not ticket:
        code = 404 if reason == "Тікет не знайдено" else 403
        raise HTTPException(status_code=code, detail=reason)

    if ticket.status == "closed":
        raise HTTPException(status_code=400, detail="Тікет закрито. Створіть новий.")

    # Анти-спуфінг ролі: клієнт пише як 'customer', представник магазину —
    # як 'manager' або 'supplier' (власник).
    is_customer = ticket.customer_id == user.id
    is_shop_side = await _user_can_access_supplier_tickets(db, user, ticket.supplier_id)
    if is_customer and payload.sender_role != "customer":
        raise HTTPException(
            status_code=403,
            detail="Клієнт може писати лише від себе (sender_role='customer')",
        )
    if is_shop_side and payload.sender_role == "customer":
        raise HTTPException(
            status_code=403,
            detail="Представник магазину не може писати від імені клієнта",
        )
    if not is_customer and not is_shop_side:
        raise HTTPException(status_code=403, detail=reason or "Немає доступу до цього тікета")

    message = TicketMessage(
        ticket_id=ticket.id,
        sender_id=user.id,
        sender_role=payload.sender_role,
        text=payload.text,
        is_read=False,
    )
    db.add(message)
    # Торкання updated_at тікета (onupdate спрацює лише при зміні атрибутів,
    # тому явно оновлюємо серверний бік)
    ticket.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(message)

    logger.info(
        "Повідомлення #%s у тікет #%s від user=%s (%s)",
        message.id, ticket.id, user.id, payload.sender_role,
    )
    return message


@router.get("/{ticket_id}/messages", response_model=List[TicketMessageResponse])
async def get_ticket_messages(
    ticket_id: int,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """Історія переписки тікета (старіші → новіші). Доступ: учасники тікета."""
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    ticket, reason = await _get_ticket_with_access(db, ticket_id, user)
    if not ticket:
        code = 404 if reason == "Тікет не знайдено" else 403
        raise HTTPException(status_code=code, detail=reason)

    messages = (
        await db.execute(
            select(TicketMessage)
            .where(TicketMessage.ticket_id == ticket.id)
            .order_by(TicketMessage.created_at.asc(), TicketMessage.id.asc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    # Позначаємо всі повідомлення як прочитані для того, хто дивиться історію
    # (клієнт читає відповіді магазину; магазин — повідомлення клієнта).
    await db.execute(
        update(TicketMessage)
        .where(
            TicketMessage.ticket_id == ticket.id,
            TicketMessage.sender_id != user.id,
        )
        .values(is_read=True)
    )
    await db.commit()

    return list(messages)
