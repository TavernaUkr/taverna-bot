# api/wallets.py
"""
Фінансове ядро Mini App: гаманець користувача та журнал транзакцій (Ledger).
Користувача визначаємо з Authorization: Bearer <initData>.
Усі суми — в копійках (UAH) або бонусах (BONUS).
"""
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select

from api.auth import validate_init_data
from api_models import WalletResponse, TransactionResponse
from database.db import get_db, AsyncSession, ensure_user_wallet
from database.models import (
    User,
    Wallet,
    Transaction,
    Supplier,
    SupplierStatus,
    supplier_managers,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/wallets", tags=["Wallets (Mini App)"])


def _enum_value(value: Any) -> Optional[str]:
    """Значення Enum як рядок (адаптовано з api/suppliers.py)."""
    if value is None:
        return None
    return value.value if hasattr(value, "value") else str(value)


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


# --- Операційний баланс магазину (фінансовий спліт) ---------------------------

async def _get_supplier_with_finance_access(
    db: AsyncSession,
    supplier_id: int,
    authorization: Optional[str],
) -> tuple[Supplier, User, str]:
    """
    RBAC для фінансів магазину (адаптація _get_owned_supplier_or_403
    з api/suppliers.py): пускаємо
      - власника (supplier.user_id == current_user.id) — role='owner';
      - менеджера з правом can_view_balance — role='manager'.
    Інакше 403. Повертає (supplier, user, role).
    """
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        raise HTTPException(status_code=403, detail="Forbidden")

    supplier = await db.get(Supplier, supplier_id)
    if not supplier or _enum_value(supplier.status) == SupplierStatus.deleted.value:
        raise HTTPException(status_code=404, detail="Магазин не знайдено")

    # 1) Власник — повний доступ до фінансів.
    if supplier.user_id == user.id:
        return supplier, user, "owner"

    # 2) Менеджер: потрібне право can_view_balance у таблиці контрактів.
    can_view_balance = (
        await db.execute(
            select(supplier_managers.c.can_view_balance).where(
                supplier_managers.c.supplier_id == supplier.id,
                supplier_managers.c.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if can_view_balance:
        return supplier, user, "manager"

    # Менеджер без права (рядок у supplier_managers є) або чужа людина → 403.
    raise HTTPException(
        status_code=403,
        detail="Немає прав на перегляд балансу цього магазину",
    )


@router.get(
    "/supplier/{supplier_id}/transactions",
    response_model=list[TransactionResponse],
)
async def get_supplier_transactions(
    supplier_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """
    Історія транзакцій ОПЕРАЦІЙНОГО БАЛАНСУ магазину (фінансовий спліт):
    записи Ledger з supplier_id == supplier_id (wallet_id IS NULL,
    новіші першими) + пагінація limit/offset.
    Доступ: власник або менеджер з правом can_view_balance.
    """
    supplier, _user, _role = await _get_supplier_with_finance_access(
        db, supplier_id, authorization
    )

    transactions = (
        await db.execute(
            select(Transaction)
            .where(
                Transaction.supplier_id == supplier.id,
                # Транзакції магазину: wallet_id завжди NULL у фінансовому
                # спліті — але страховка від сміття не завадить.
                Transaction.wallet_id.is_(None),
            )
            .order_by(Transaction.created_at.desc(), Transaction.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return list(transactions)
