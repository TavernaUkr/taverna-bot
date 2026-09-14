# api/suppliers.py
"""
Реєстрація постачальника з Mini App: збереження заявки, AI-скоринг у фоні,
сповіщення адмінам з кнопкою Mini App.
"""
import asyncio
import html
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from api_models import PartnerRegisterRequest, PartnerRegisterResponse
from bot_instance import get_bot_instance
from config_reader import config
from database.db import AsyncSessionLocal, get_db, AsyncSession
from database.models import (
    Supplier,
    SupplierLegalType,
    SupplierStatus,
    SupplierType,
    User,
    UserRole,
)
from api.auth import validate_init_data
from services.supplier_analyzer import SupplierAnalyzer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/suppliers", tags=["Suppliers (Mini App)"])


async def _get_user_by_telegram_id(db: AsyncSession, telegram_id: int) -> Optional[User]:
    stmt = select(User).where(User.telegram_id == telegram_id)
    return (await db.execute(stmt)).scalar_one_or_none()


def _legal_type_label(legal_type: Optional[SupplierLegalType]) -> str:
    if legal_type == SupplierLegalType.business:
        return "Бізнес (ТОВ / юр. особа)"
    return "ФОП / фізична особа"


def _application_keyboard(supplier_id: int) -> InlineKeyboardMarkup:
    base = config.MINI_APP_URL
    startapp = f"admin_supplier_{supplier_id}"
    if base:
        web_url = f"{base}/admin-dashboard?startapp={startapp}"
        view_btn = InlineKeyboardButton(
            text="🔍 Переглянути заявку",
            web_app=WebAppInfo(url=web_url),
        )
    else:
        view_btn = InlineKeyboardButton(
            text="🔍 Переглянути заявку",
            callback_data=f"partner:view:{supplier_id}",
        )
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [view_btn],
            [
                InlineKeyboardButton(
                    text="✅ Схвалити",
                    callback_data=f"partner:approve:{supplier_id}",
                ),
                InlineKeyboardButton(
                    text="❌ Відхилити",
                    callback_data=f"partner:reject:{supplier_id}",
                ),
            ],
        ]
    )


def _payload_for_ai(request_data: PartnerRegisterRequest, store_name: str) -> Dict[str, Any]:
    return {
        "supplier_type": request_data.supplier_type,
        "store_name": store_name,
        "full_name": request_data.full_name,
        "company_name": request_data.company_name,
        "edrpou_ipn": request_data.resolved_edrpou_ipn(),
        "email": request_data.email,
        "phone": request_data.phone,
        "yml_link": request_data.resolved_yml(),
        "channel_link": request_data.resolved_channel(),
        "manager_telegram": request_data.manager_telegram,
        "store_description": request_data.resolved_description(),
        "iban": request_data.resolved_iban(),
        "bank_name": request_data.resolved_bank(),
        "telegram_id": request_data.telegram_id,
    }


async def _has_duplicates(
    db: AsyncSession,
    edrpou_ipn: Optional[str],
    yml_link: Optional[str],
    exclude_id: Optional[int] = None,
) -> bool:
    filters = []
    if edrpou_ipn:
        filters.extend(
            [
                Supplier.edrpou_ipn == edrpou_ipn,
                Supplier.edrpou == edrpou_ipn,
                Supplier.ipn == edrpou_ipn,
            ]
        )
    if yml_link:
        filters.extend(
            [
                Supplier.yml_link == yml_link,
                Supplier.xml_url == yml_link,
            ]
        )
    if not filters:
        return False
    stmt = select(Supplier.id).where(or_(*filters))
    if exclude_id is not None:
        stmt = stmt.where(Supplier.id != exclude_id)
    stmt = stmt.limit(1)
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def _notify_admins_after_ai(supplier: Supplier) -> None:
    store = supplier.store_name or supplier.name or "-"
    legal = _legal_type_label(supplier.supplier_type)
    text = (
        "🚨 <b>Нова заявка на партнерство!</b>\n"
        f"🏢 Магазин: {html.escape(store)}\n"
        f"👤 Тип: {html.escape(legal)}\n\n"
        "🤖 AI Аналіз завершено. Перевірте заявку в системі."
    )
    keyboard = _application_keyboard(supplier.id)
    admin_ids = config.ADMIN_IDS
    if not admin_ids:
        logger.error("ADMIN_IDS порожній — заявка #%s не надіслана адмінам.", supplier.id)
        return

    bot = await get_bot_instance()
    for admin_id in admin_ids:
        try:
            await bot.send_message(
                chat_id=admin_id,
                text=text,
                reply_markup=keyboard,
            )
        except Exception as e:
            logger.error("Не вдалося надіслати заявку адміну %s: %s", admin_id, e)


async def _process_application_background(
    supplier_id: int,
    supplier_data: Dict[str, Any],
    has_duplicates: bool,
) -> None:
    """Окрема сесія БД: request-сесія вже закрита після відповіді клієнту."""
    analyzer = SupplierAnalyzer()
    try:
        report = await analyzer.analyze_supplier(supplier_data, has_duplicates)
    except Exception as e:
        logger.error("AI-скоринг заявки #%s впав: %s", supplier_id, e, exc_info=True)
        report = (
            "AI-аналіз завершився з помилкою. Потрібна ручна перевірка.\n"
            f"Дублікати в БД: {'так' if has_duplicates else 'ні'}."
        )

    async with AsyncSessionLocal() as db:
        supplier = await db.get(Supplier, supplier_id)
        if not supplier:
            logger.error("Фонова обробка: заявку #%s не знайдено.", supplier_id)
            return
        supplier.ai_score_report = report
        if supplier.status in (
            SupplierStatus.pending_ai_analysis,
            SupplierStatus.ai_in_progress,
        ):
            supplier.status = SupplierStatus.pending_admin_approval
        await db.commit()
        await db.refresh(supplier)
        snapshot = supplier

    try:
        await _notify_admins_after_ai(snapshot)
    except Exception as e:
        logger.error("Заявку #%s збережено, сповіщення адмінам не пішло: %s", supplier_id, e)


def _schedule_background(coro) -> None:
    task = asyncio.create_task(coro)
    def _log_task_result(done):
        try:
            exc = done.exception()
        except asyncio.CancelledError:
            return
        if exc:
            logger.error("Фонова задача заявки впала: %s", exc, exc_info=exc)
    task.add_done_callback(_log_task_result)


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


@router.post("/register", response_model=PartnerRegisterResponse, status_code=201)
async def register_partner(
    request_data: PartnerRegisterRequest,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """
    Зберігає заявку (pending), шукає дублі, ставить trial +30 днів для ФОП
    і запускає AI-скоринг у фоні.
    Користувача визначаємо з Authorization: Bearer <initData>.
    """
    try:
        legal_type = request_data.resolved_legal_type()
        store_name = request_data.resolved_name()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    telegram_id = _telegram_id_from_authorization(authorization)
    if telegram_id is None and request_data.telegram_id:
        telegram_id = int(request_data.telegram_id)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )
    yml_link = request_data.resolved_yml()
    channel_link = request_data.resolved_channel()
    edrpou_ipn = request_data.resolved_edrpou_ipn()
    iban = request_data.resolved_iban()
    description = request_data.resolved_description()
    email = (request_data.email or "").strip() or None
    phone = (request_data.phone or "").strip() or None

    user = await _get_user_by_telegram_id(db, telegram_id)
    if not user:
        user = User(
            telegram_id=telegram_id,
            full_name=request_data.full_name or store_name,
            first_name=request_data.full_name or store_name,
            username=(request_data.telegram_username or "").lstrip("@") or None,
            role=UserRole.client,
        )
        db.add(user)
        await db.flush()

    existing = (
        await db.execute(select(Supplier).where(Supplier.user_id == user.id))
    ).scalar_one_or_none()
    if existing and existing.status not in (SupplierStatus.rejected, SupplierStatus.disabled):
        raise HTTPException(
            status_code=409,
            detail="Цей Telegram-акаунт уже має заявку або магазин.",
        )

    has_duplicates = await _has_duplicates(db, edrpou_ipn, yml_link)
    trial_ends_at = None
    if legal_type == SupplierLegalType.individual:
        trial_ends_at = datetime.now(timezone.utc) + timedelta(days=30)

    catalog_type = (
        SupplierType.mydrop
        if yml_link and "mydrop" in yml_link.lower()
        else SupplierType.independent
    )
    unique_key = f"partner_{telegram_id}_{int(time.time())}"

    try:
        new_supplier = Supplier(
            user_id=user.id,
            key=unique_key,
            name=store_name,
            type=catalog_type,
            status=SupplierStatus.pending_ai_analysis,
            supplier_type=legal_type,
            yml_link=yml_link,
            channel_link=channel_link,
            xml_url=yml_link,
            telegram_channel=channel_link,
            contact_telegram_id=telegram_id,
            contact_phone=phone,
            is_verified=False,
            edrpou_ipn=edrpou_ipn,
            edrpou=edrpou_ipn if edrpou_ipn and len(edrpou_ipn) == 8 else None,
            ipn=edrpou_ipn if edrpou_ipn and len(edrpou_ipn) != 8 else None,
            email=email,
            phone=phone,
            manager_telegram=request_data.manager_telegram,
            store_name=store_name,
            store_description=description,
            iban=iban,
            payout_iban=iban,
            bank_name=request_data.resolved_bank(),
            legal_name=request_data.full_name or request_data.company_name,
            trial_ends_at=trial_ends_at,
            ai_score_report=None,
        )
        db.add(new_supplier)
        await db.commit()
        await db.refresh(new_supplier)
    except IntegrityError:
        await db.rollback()
        logger.warning("IntegrityError при реєстрації партнера telegram_id=%s", telegram_id)
        raise HTTPException(status_code=409, detail="Заявка з такими даними вже існує.")
    except Exception as e:
        await db.rollback()
        logger.error("Помилка в POST /api/v1/suppliers/register: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

    ai_payload = _payload_for_ai(request_data, store_name)
    ai_payload["telegram_id"] = telegram_id
    _schedule_background(
        _process_application_background(
            new_supplier.id,
            ai_payload,
            has_duplicates,
        )
    )

    logger.info(
        "Нова заявка партнера #%s (%s) від telegram_id=%s, duplicates=%s",
        new_supplier.id,
        store_name,
        telegram_id,
        has_duplicates,
    )
    return PartnerRegisterResponse(
        id=new_supplier.id,
        user_id=new_supplier.user_id,
        name=new_supplier.name,
        supplier_type=legal_type.value,
        yml_link=new_supplier.yml_link,
        channel_link=new_supplier.channel_link,
        is_verified=False,
        status="pending",
        has_duplicates=has_duplicates,
        trial_ends_at=new_supplier.trial_ends_at,
        created_at=new_supplier.created_at,
    )
