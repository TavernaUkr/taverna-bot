# api/admin_suppliers.py
"""Заявки постачальників для React-адмінки Mini App."""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from api_models import PendingSupplierApplicationResponse
from config_reader import config
from database.db import get_db, AsyncSession
from database.models import Supplier, SupplierStatus, User, UserRole

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/admin", tags=["Admin (Supplier Applications)"])

PENDING_STATUSES = (
    SupplierStatus.pending_ai_analysis,
    SupplierStatus.ai_in_progress,
    SupplierStatus.pending_admin_approval,
)


def _to_application(supplier: Supplier) -> PendingSupplierApplicationResponse:
    legal = supplier.supplier_type.value if getattr(supplier.supplier_type, "value", None) else (
        str(supplier.supplier_type) if supplier.supplier_type else None
    )
    status_value = supplier.status.value if getattr(supplier.status, "value", None) else str(supplier.status)
    if status_value in (
        SupplierStatus.pending_ai_analysis.value,
        SupplierStatus.ai_in_progress.value,
        SupplierStatus.pending_admin_approval.value,
    ):
        ui_status = "pending"
    else:
        ui_status = status_value
    return PendingSupplierApplicationResponse(
        id=supplier.id,
        shop_name=supplier.store_name or supplier.name or "-",
        full_name=supplier.legal_name,
        email=supplier.email,
        phone=supplier.phone or supplier.contact_phone,
        company_name=supplier.legal_name if legal == "business" else None,
        supplier_type=legal,
        tax_id=supplier.edrpou_ipn or supplier.edrpou or supplier.ipn,
        description=supplier.store_description,
        xml_url=supplier.yml_link or supplier.xml_url,
        yml_link=supplier.yml_link,
        channel_link=supplier.channel_link,
        manager_telegram=supplier.manager_telegram,
        iban=supplier.iban or supplier.payout_iban,
        bank_name=supplier.bank_name,
        status=ui_status,
        is_verified=bool(supplier.is_verified),
        telegram_id=int(supplier.contact_telegram_id) if supplier.contact_telegram_id else None,
        ai_score_report=supplier.ai_score_report,
        trial_ends_at=supplier.trial_ends_at,
        created_at=supplier.created_at,
    )


@router.get("/suppliers/pending", response_model=List[PendingSupplierApplicationResponse])
async def list_pending_supplier_applications(
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
):
    """Список заявок зі статусом pending, включно з ai_score_report."""
    if telegram_id is not None and telegram_id not in set(config.ADMIN_IDS):
        raise HTTPException(status_code=403, detail="Admin access required")

    stmt = (
        select(Supplier)
        .where(Supplier.status.in_(PENDING_STATUSES))
        .order_by(Supplier.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_application(item) for item in rows]


@router.post("/suppliers/{supplier_id}/approve", response_model=PendingSupplierApplicationResponse)
async def approve_supplier_application(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
):
    if telegram_id is not None and telegram_id not in set(config.ADMIN_IDS):
        raise HTTPException(status_code=403, detail="Admin access required")

    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Заявку не знайдено")

    supplier.is_verified = True
    supplier.status = SupplierStatus.active
    if supplier.user_id:
        user = await db.get(User, supplier.user_id)
        if user and user.role != UserRole.admin:
            user.role = UserRole.supplier
    await db.commit()
    await db.refresh(supplier)
    logger.info("Адмін схвалив заявку #%s", supplier_id)
    return _to_application(supplier)


@router.post("/suppliers/{supplier_id}/reject", response_model=PendingSupplierApplicationResponse)
async def reject_supplier_application(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
):
    if telegram_id is not None and telegram_id not in set(config.ADMIN_IDS):
        raise HTTPException(status_code=403, detail="Admin access required")

    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Заявку не знайдено")

    supplier.is_verified = False
    supplier.status = SupplierStatus.rejected
    await db.commit()
    await db.refresh(supplier)
    logger.info("Адмін відхилив заявку #%s", supplier_id)
    return _to_application(supplier)
