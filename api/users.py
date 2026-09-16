# api/users.py
"""
Налаштування поточного користувача Mini App (вібрація, сповіщення).
Користувача визначаємо з Authorization: Bearer <initData>.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select

from api.auth import validate_init_data
from api_models import UserResponse, UserSettingsUpdate
from database.db import get_db, AsyncSession
from database.models import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/users", tags=["Users (Mini App)"])


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


def _user_to_response(user: User) -> UserResponse:
    role = user.role.value if hasattr(user.role, "value") else user.role
    return UserResponse(
        id=user.id,
        telegram_id=str(user.telegram_id) if user.telegram_id is not None else None,
        email=user.email,
        first_name=user.first_name or "",
        last_name=user.last_name,
        username=user.username,
        loyalty_points=int(getattr(user, "loyalty_points", 0) or 0),
        role=role,
        haptic_enabled=True if user.haptic_enabled is None else bool(user.haptic_enabled),
        notifications_enabled=(
            True if user.notifications_enabled is None else bool(user.notifications_enabled)
        ),
    )


@router.patch("/me/settings", response_model=UserResponse)
async def update_my_settings(
    payload: UserSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """
    Оновлює вібрацію та сповіщення поточного користувача Mini App.
    Передавай лише ті поля, які треба змінити.
    """
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = (
        await db.execute(select(User).where(User.telegram_id == telegram_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    updates = {
        key: value
        for key, value in payload.model_dump(exclude_unset=True).items()
        if value is not None
    }
    for key, value in updates.items():
        setattr(user, key, value)

    try:
        await db.commit()
        await db.refresh(user)
    except Exception as e:
        await db.rollback()
        logger.error("Помилка в PATCH /api/v1/users/me/settings: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

    logger.info(
        "Оновлено налаштування telegram_id=%s haptic=%s notifications=%s",
        telegram_id,
        user.haptic_enabled,
        user.notifications_enabled,
    )
    return _user_to_response(user)
