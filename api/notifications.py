# api/notifications.py
"""
Глобальна система сповіщень («Дзвоник») Mini App.
Користувача визначаємо з Authorization: Bearer <initData> (як у wallets).

  GET    /api/v1/me/notifications          — список сповіщень (created_at DESC)
                                             + unread_count для бейджа;
  POST   /api/v1/me/notifications/read-all — is_read=True для всіх сповіщень юзера;
  DELETE /api/v1/me/notifications          — ОЧИСТИТИ всі сповіщення юзера.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import delete, func, select, update

from api.auth import validate_init_data
from api_models import (
    ClearNotificationsResponse,
    MarkAllReadResponse,
    NotificationResponse,
    NotificationsListResponse,
)
from database.db import get_db, AsyncSession
from database.models import Notification, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/me", tags=["Notifications (Mini App)"])


def _telegram_id_from_authorization(authorization: Optional[str]) -> Optional[int]:
    """Bearer initData → telegram_id (адаптовано з api/wallets.py)."""
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


@router.get("/notifications", response_model=NotificationsListResponse)
async def get_my_notifications(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """
    Сповіщення поточного користувача (новіші першими).
    unread_count — по ВСІХ сповіщеннях юзера (без limit), для бейджа дзвоника.
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

    notifications = (
        await db.execute(
            select(Notification)
            .where(Notification.user_id == user.id)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    unread_count = int(
        (
            await db.execute(
                select(func.count(Notification.id)).where(
                    Notification.user_id == user.id,
                    Notification.is_read.is_(False),
                )
            )
        ).scalar()
        or 0
    )

    return NotificationsListResponse(
        items=[NotificationResponse.model_validate(item) for item in notifications],
        unread_count=unread_count,
    )


@router.post("/notifications/read-all", response_model=MarkAllReadResponse)
async def mark_all_notifications_read(
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """Прочитати всі: is_read=True для всіх непрочитаних сповіщень юзера."""
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    result = await db.execute(
        update(Notification)
        .where(
            Notification.user_id == user.id,
            Notification.is_read.is_(False),
        )
        .values(is_read=True)
    )
    await db.commit()

    marked = int(result.rowcount or 0)
    logger.info("Сповіщення user #%s: прочитано %s шт.", user.id, marked)
    return MarkAllReadResponse(ok=True, marked_read=marked)


@router.delete("/notifications", response_model=ClearNotificationsResponse)
async def clear_all_notifications(
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """Очистити всі: видаляє ВСІ сповіщення поточного користувача."""
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    result = await db.execute(
        delete(Notification).where(Notification.user_id == user.id)
    )
    await db.commit()

    deleted = int(result.rowcount or 0)
    logger.info("Сповіщення user #%s: видалено %s шт. (очищено список).", user.id, deleted)
    return ClearNotificationsResponse(ok=True, deleted=deleted)
