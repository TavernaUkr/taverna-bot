# api/auth.py
"""
Авторизація Telegram Mini App: валідація initData і upsert користувача.
"""
import hmac
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from urllib.parse import parse_qsl

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from api_models import TelegramAuthRequest, TelegramAuthResponse, TelegramAuthUserResponse
from config_reader import config
from database.db import get_db, AsyncSession
from database.models import User, UserRole
from services.auth_service import validate_init_data as _shared_validate_init_data

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/auth", tags=["Auth (Telegram Mini App)"])


def validate_init_data(init_data: str) -> Optional[Dict[str, Any]]:
    """
    Валідація initData за офіційною документацією Telegram Mini Apps.

    Алгоритм:
      secret_key = HMAC-SHA256(key="WebAppData", msg=BOT_TOKEN)
      data_check_string = відсортовані поля key=value без hash, через \\n
      hash = hex(HMAC-SHA256(secret_key, data_check_string))

    Повертає dict поля `user` або None, якщо підпис невалідний / дані застарілі.
    https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    """
    try:
        if not init_data or not str(init_data).strip():
            logger.warning("Invalid initData: empty payload")
            return None

        bot_token = config.BOT_TOKEN
        parsed_data = dict(parse_qsl(init_data, keep_blank_values=True))

        hash_to_check = parsed_data.pop("hash", None)
        if not hash_to_check:
            logger.warning("Invalid initData: 'hash' field is missing")
            return None

        auth_date_ts = int(parsed_data.get("auth_date", 0) or 0)
        auth_date = datetime.fromtimestamp(auth_date_ts, timezone.utc)
        if datetime.now(timezone.utc) - auth_date > timedelta(hours=1):
            logger.warning("Invalid initData: Data is older than 1 hour")
            return None

        data_check_string = "\n".join(
            f"{k}={v}" for k, v in sorted(parsed_data.items())
        )
        secret_key = hmac.new(
            b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256
        ).digest()
        calculated_hash = hmac.new(
            secret_key, data_check_string.encode("utf-8"), hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(calculated_hash, hash_to_check):
            logger.error("CRITICAL: Invalid initData hash. Possible attack.")
            return None

        if "user" in parsed_data:
            return json.loads(parsed_data["user"])
        return {}
    except Exception as e:
        logger.error("Помилка валідації initData: %s", e, exc_info=True)
        # Fallback на спільну реалізацію в auth_service (той самий алгоритм)
        return _shared_validate_init_data(init_data)


def _compose_full_name(
    first_name: Optional[str],
    last_name: Optional[str],
    username: Optional[str],
) -> str:
    parts = [p for p in (first_name, last_name) if p]
    if parts:
        return " ".join(parts).strip()
    if username:
        return username
    return "Користувач"


def _user_to_response(user: User) -> TelegramAuthUserResponse:
    telegram_id = int(user.telegram_id) if user.telegram_id is not None else 0
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    full_name = user.full_name or _compose_full_name(
        user.first_name, user.last_name, user.username
    )
    return TelegramAuthUserResponse(
        id=user.id,
        telegram_id=telegram_id,
        username=user.username,
        full_name=full_name,
        first_name=user.first_name,
        last_name=user.last_name,
        role=role,
        created_at=user.created_at,
    )


async def _get_user_by_telegram_id(db: AsyncSession, telegram_id: int) -> Optional[User]:
    stmt = select(User).where(User.telegram_id == telegram_id)
    return (await db.execute(stmt)).scalar_one_or_none()


@router.post("/telegram", response_model=TelegramAuthResponse)
async def auth_via_telegram(
    request_data: TelegramAuthRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Mini App надсилає initData. Якщо підпис валідний — знаходимо або
    створюємо User (роль client) і повертаємо його дані.
    Без валідного initData клієнт залишається Гостем (401).
    """
    init_data = request_data.resolved_init_data()
    if not init_data:
        return TelegramAuthResponse(
            user=TelegramAuthUserResponse(
                id=0,
                telegram_id=0,
                username=None,
                full_name="Гість",
                first_name="Гість",
                last_name=None,
                role="guest",
                created_at=None,
            ),
            role="guest",
            is_guest=True,
        )

    user_data = validate_init_data(init_data)
    if user_data is None:
        logger.warning("Спроба Mini App-авторизації з невалідним initData.")
        raise HTTPException(
            status_code=401,
            detail="Invalid initData: Hash mismatch or expired",
        )

    telegram_id = user_data.get("id")
    if not telegram_id:
        raise HTTPException(
            status_code=400,
            detail="Invalid initData: 'user' field is missing",
        )

    telegram_id = int(telegram_id)
    first_name = user_data.get("first_name") or "User"
    last_name = user_data.get("last_name")
    username = user_data.get("username")
    full_name = _compose_full_name(first_name, last_name, username)
    admin_ids = set(config.ADMIN_IDS)

    try:
        user = await _get_user_by_telegram_id(db, telegram_id)
        if user:
            user.first_name = first_name
            user.last_name = last_name
            user.username = username
            user.full_name = full_name
            if telegram_id in admin_ids and user.role != UserRole.admin:
                user.role = UserRole.admin
            logger.info("Mini App логін: telegram_id=%s role=%s", telegram_id, user.role)
        else:
            role = UserRole.admin if telegram_id in admin_ids else UserRole.client
            user = User(
                telegram_id=telegram_id,
                first_name=first_name,
                last_name=last_name,
                username=username,
                full_name=full_name,
                role=role,
            )
            db.add(user)
            logger.info("Створено Mini App клієнта: telegram_id=%s role=%s", telegram_id, role)

        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        user = await _get_user_by_telegram_id(db, telegram_id)
        if not user:
            raise HTTPException(status_code=409, detail="User already exists")
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error("Помилка в POST /api/v1/auth/telegram: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

    payload = _user_to_response(user)
    return TelegramAuthResponse(
        user=payload,
        role=payload.role,
        is_guest=False,
    )
