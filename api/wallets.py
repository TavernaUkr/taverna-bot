# api/wallets.py
"""
Фінансове ядро Mini App: гаманець користувача та журнал транзакцій (Ledger).
Користувача визначаємо з Authorization: Bearer <initData>.
Усі суми — в копійках (UAH) або бонусах (BONUS).
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select

from api.auth import validate_init_data
from api_models import WalletResponse, TransactionResponse
from database.db import get_db, AsyncSession, ensure_user_wallet
from database.models import User, Wallet, Transaction

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/wallets", tags=["Wallets (Mini App)"])


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


@router.get("/me", response_model=WalletResponse)
async def get_my_wallet(
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """Гаманець поточного користувача. Якщо немає — створюється з нульовими балансами."""
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    wallet = await ensure_user_wallet(user.id, db)
    await db.commit()  # зберігаємо, якщо щойно створили (або no-op)
    return wallet


@router.get("/me/transactions", response_model=list[TransactionResponse])
async def get_my_transactions(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """Журнал транзакцій поточного користувача (новіші першими, max 50 за замовчуванням)."""
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    wallet = await ensure_user_wallet(user.id, db)

    transactions = (
        await db.execute(
            select(Transaction)
            .where(Transaction.wallet_id == wallet.id)
            .order_by(Transaction.created_at.desc(), Transaction.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return list(transactions)
