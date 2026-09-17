# api/suppliers.py
"""
Реєстрація постачальника з Mini App: збереження заявки, AI-скоринг у фоні,
сповіщення адмінам з кнопкою Mini App.
"""
import asyncio
import html
import json
import logging
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError

from api_models import (
    PartnerRegisterRequest,
    PartnerRegisterResponse,
    SupplierDeletionRequest,
    SupplierDeletionResponse,
    SupplierMeResponse,
    SupplierQueueShopProgress,
)
from bot_instance import get_bot_instance
from config_reader import config
from database.db import AsyncSessionLocal, get_db, AsyncSession
from database.models import (
    Product,
    ProductAIStatus,
    ProductStatus,
    Supplier,
    SupplierLegalType,
    SupplierStatus,
    SupplierType,
    User,
    UserRole,
)
from api.auth import validate_init_data
from services.mydrop_api import InvalidMyDropYmlLinkError, normalize_mydrop_yml_link
from services.supplier_analyzer import SupplierAnalyzer, analyze_telegram_channel
from services.ai_queue_worker import (
    BLOCKED_SUPPLIER_STATUSES,
    build_ai_queue_view,
)

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


def _deletion_keyboard(supplier: Supplier) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    base = config.MINI_APP_URL
    startapp = f"admin_supplier_{supplier.id}"
    if base:
        web_url = f"{base}/admin-dashboard?startapp={startapp}"
        rows.append([
            InlineKeyboardButton(
                text="🔍 Переглянути заявку",
                web_app=WebAppInfo(url=web_url),
            )
        ])
    else:
        rows.append([
            InlineKeyboardButton(
                text="🔍 Переглянути заявку",
                callback_data=f"partner:view:{supplier.id}",
            )
        ])
    username = _telegram_username(supplier.manager_telegram)
    if username:
        rows.append([
            InlineKeyboardButton(
                text="💬 Зв'язатися з менеджером",
                url=f"https://t.me/{username}",
            )
        ])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _telegram_username(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    value = raw.strip().replace("https://", "").replace("http://", "")
    value = value.lstrip("@")
    if value.lower().startswith("t.me/"):
        value = value[5:]
    value = value.split("?")[0].strip("/")
    if "/" in value:
        value = value.split("/")[-1]
    cleaned = value.replace("_", "")
    if len(value) < 3 or not cleaned.isalnum():
        return None
    return value


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
        "source_type": request_data.resolved_source_type(),
        "telegram_channel_link": request_data.resolved_telegram_channel_link(),
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
    mydrop_api_key: Optional[str] = None,
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
    if mydrop_api_key:
        filters.append(Supplier.mydrop_api_key == mydrop_api_key)
    if not filters:
        return False
    stmt = select(Supplier.id).where(or_(*filters))
    if exclude_id is not None:
        stmt = stmt.where(Supplier.id != exclude_id)
    stmt = stmt.limit(1)
    return (await db.execute(stmt)).scalar_one_or_none() is not None


DUPLICATE_SOURCE_DETAIL = (
    "Магазин з таким посиланням або каналом вже зареєстровано в системі."
)


def _normalize_yml_key(value: Optional[str]) -> Optional[str]:
    raw = (value or "").strip().rstrip("/").lower()
    return raw or None


def _normalize_tg_key(value: Optional[str]) -> Optional[str]:
    raw = (value or "").strip()
    if not raw:
        return None
    raw = raw.replace("https://", "").replace("http://", "").replace("www.", "")
    lower = raw.lower()
    for prefix in ("t.me/", "telegram.me/", "telegram.dog/"):
        if lower.startswith(prefix):
            raw = raw[len(prefix):]
            lower = raw.lower()
            break
    if lower.startswith("s/"):
        raw = raw[2:]
        lower = raw.lower()
    return raw.strip("/@").lower() or None


async def assert_source_not_duplicate(
    db: AsyncSession,
    source_type: str,
    *,
    yml_link: Optional[str] = None,
    telegram_channel_link: Optional[str] = None,
    exclude_id: Optional[int] = None,
) -> None:
    """Стоп-кран: той самий XML або Telegram-канал не можна зареєструвати двічі."""
    source = (source_type or "xml").strip().lower()
    stmt = select(Supplier).where(Supplier.status != SupplierStatus.deleted)
    if exclude_id is not None:
        stmt = stmt.where(Supplier.id != exclude_id)

    if source == "telegram":
        needle = _normalize_tg_key(telegram_channel_link)
        if not needle:
            return
        stmt = stmt.where(
            or_(
                Supplier.telegram_channel_link.isnot(None),
                Supplier.channel_link.isnot(None),
                Supplier.telegram_channel.isnot(None),
            )
        )
        rows = (await db.execute(stmt)).scalars().all()
        for row in rows:
            for raw in (
                getattr(row, "telegram_channel_link", None),
                row.channel_link,
                row.telegram_channel,
            ):
                if _normalize_tg_key(raw) == needle:
                    raise HTTPException(status_code=400, detail=DUPLICATE_SOURCE_DETAIL)
        return

    needle = _normalize_yml_key(yml_link)
    if not needle:
        return
    stmt = stmt.where(
        or_(
            Supplier.yml_link.isnot(None),
            Supplier.xml_url.isnot(None),
        )
    )
    rows = (await db.execute(stmt)).scalars().all()
    for row in rows:
        for raw in (row.yml_link, row.xml_url):
            if _normalize_yml_key(raw) == needle:
                raise HTTPException(status_code=400, detail=DUPLICATE_SOURCE_DETAIL)


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
    source_type = str(supplier_data.get("source_type") or "xml").strip().lower()
    channel_link = (
        supplier_data.get("telegram_channel_link")
        or supplier_data.get("channel_link")
        or ""
    )
    try:
        if source_type == "telegram":
            result = await analyze_telegram_channel(str(channel_link or ""))
            report = json.dumps(result, ensure_ascii=False, indent=2)
        else:
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


SECONDS_PER_PRODUCT_AI = 15
DELETION_NOTE_PREFIX = "[ЗАЯВКА НА ВИДАЛЕННЯ]"


async def _get_supplier_for_telegram(
    db: AsyncSession,
    telegram_id: int,
) -> Optional[Supplier]:
    user = await _get_user_by_telegram_id(db, telegram_id)
    filters = [Supplier.contact_telegram_id == telegram_id]
    if user:
        filters.append(Supplier.user_id == user.id)
    stmt = (
        select(Supplier)
        .where(
            or_(*filters),
            Supplier.status != SupplierStatus.deleted,
        )
        .order_by(
            (Supplier.status == SupplierStatus.active).desc(),
            Supplier.id.desc(),
        )
    )
    return (await db.execute(stmt)).scalars().first()


async def _supplier_ids_for_telegram(
    db: AsyncSession,
    telegram_id: int,
) -> list[int]:
    user = await _get_user_by_telegram_id(db, telegram_id)
    filters = [Supplier.contact_telegram_id == telegram_id]
    if user:
        filters.append(Supplier.user_id == user.id)
    stmt = select(Supplier.id).where(
        or_(*filters),
        Supplier.status.notin_(BLOCKED_SUPPLIER_STATUSES),
    )
    ids = [int(x) for x in (await db.execute(stmt)).scalars().all()]

    role_value = None
    if user is not None and user.role is not None:
        role_value = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role_value == UserRole.admin.value:
        orphan_stmt = select(Supplier.id).where(
            Supplier.status.notin_(BLOCKED_SUPPLIER_STATUSES),
            Supplier.user_id.is_(None),
            Supplier.contact_telegram_id.is_(None),
        )
        ids.extend(int(x) for x in (await db.execute(orphan_stmt)).scalars().all())
        if user is not None:
            await db.execute(
                update(Supplier)
                .where(
                    Supplier.status.notin_(BLOCKED_SUPPLIER_STATUSES),
                    Supplier.user_id.is_(None),
                    Supplier.contact_telegram_id.is_(None),
                )
                .values(user_id=user.id, contact_telegram_id=telegram_id)
            )
            await db.commit()
    return list(dict.fromkeys(ids))


def _enum_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    return value.value if hasattr(value, "value") else str(value)


def _deletion_requested(supplier: Supplier) -> bool:
    status = _enum_value(supplier.status)
    if status == SupplierStatus.deletion_requested.value:
        return True
    notes = supplier.admin_notes or ""
    return DELETION_NOTE_PREFIX in notes


def _deletion_reason(supplier: Supplier) -> Optional[str]:
    notes = supplier.admin_notes or ""
    if DELETION_NOTE_PREFIX not in notes:
        return None
    after = notes.split(DELETION_NOTE_PREFIX, 1)[1].strip()
    return after.split("\n\n", 1)[0].strip() or None


def _clear_deletion_request_notes(supplier: Supplier) -> None:
    """Прибирає блок заявки на видалення з admin_notes (після restore)."""
    notes = supplier.admin_notes or ""
    if DELETION_NOTE_PREFIX not in notes:
        return
    after = notes.split(DELETION_NOTE_PREFIX, 1)[1]
    parts = after.split("\n\n", 1)
    remainder = parts[1].strip() if len(parts) > 1 else ""
    supplier.admin_notes = remainder or None


async def _product_stats(db: AsyncSession, supplier_id: int) -> tuple[int, int]:
    total = (
        await db.execute(select(func.count(Product.id)).where(Product.supplier_id == supplier_id))
    ).scalar() or 0
    completed = (
        await db.execute(
            select(func.count(Product.id)).where(
                Product.supplier_id == supplier_id,
                Product.ai_status == ProductAIStatus.completed,
            )
        )
    ).scalar() or 0
    return int(total), int(completed)


async def _notify_admins_deletion_request(supplier: Supplier, reason: str) -> None:
    store = html.escape(supplier.store_name or supplier.name or "-")
    reason_safe = html.escape(reason.strip())
    text = (
        "🗑 <b>Заявка на видалення магазину</b>\n"
        f"🏢 Магазин: {store}\n"
        f"🆔 ID: {supplier.id}\n\n"
        f"📝 Причина:\n{reason_safe}"
    )
    admin_ids = config.ADMIN_IDS
    if not admin_ids:
        logger.error("ADMIN_IDS порожній — заявку на видалення #%s не надіслано адмінам.", supplier.id)
        return
    bot = await get_bot_instance()
    keyboard = _deletion_keyboard(supplier)
    for admin_id in admin_ids:
        try:
            await bot.send_message(
                chat_id=admin_id,
                text=text,
                reply_markup=keyboard,
            )
        except Exception as e:
            logger.error("Не вдалося надіслати заявку на видалення адміну %s: %s", admin_id, e)


@router.get("/me", response_model=SupplierMeResponse)
async def get_my_supplier(
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """Картка магазину поточного постачальника для «Керування магазинами»."""
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    supplier = await _get_supplier_for_telegram(db, telegram_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Магазин не знайдено")

    store_name = (supplier.store_name or supplier.name or "").strip()
    if not store_name:
        raise HTTPException(status_code=404, detail="Магазин не знайдено")

    product_count, completed_products = await _product_stats(db, supplier.id)
    return SupplierMeResponse(
        id=supplier.id,
        store_name=store_name,
        supplier_type=_enum_value(supplier.supplier_type),
        status=_enum_value(supplier.status) or "pending_ai_analysis",
        is_verified=bool(supplier.is_verified),
        product_count=product_count,
        completed_products=completed_products,
        deletion_requested=_deletion_requested(supplier),
        created_at=getattr(supplier, "created_at", None),
        approved_at=getattr(supplier, "approved_at", None),
        deleted_at=getattr(supplier, "deleted_at", None),
    )


@router.post("/me/request-deletion", response_model=SupplierDeletionResponse)
async def request_my_shop_deletion(
    payload: SupplierDeletionRequest,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """Постачальник просить адміна видалити магазин. Сам запис не стираємо."""
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    reason = (payload.reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=400, detail="Вкажіть причину видалення.")

    supplier = await _get_supplier_for_telegram(db, telegram_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Магазин не знайдено")
    if _deletion_requested(supplier) or _enum_value(supplier.status) in (
        SupplierStatus.deletion_requested.value,
        SupplierStatus.deleted.value,
    ):
        raise HTTPException(status_code=409, detail="Заявку на видалення вже надіслано.")

    block = f"{DELETION_NOTE_PREFIX}\n{reason}"
    existing = (supplier.admin_notes or "").strip()
    supplier.admin_notes = f"{block}\n\n{existing}" if existing else block
    supplier.status = SupplierStatus.deletion_requested

    cancel_result = await db.execute(
        update(Product)
        .where(
            Product.supplier_id == supplier.id,
            Product.ai_status == ProductAIStatus.pending,
        )
        .values(ai_status=ProductAIStatus.cancelled)
    )
    cancelled_count = int(cancel_result.rowcount or 0)
    await db.commit()
    logger.info(
        "Kill Switch: заявка на видалення #%s, pending→cancelled: %s",
        supplier.id,
        cancelled_count,
    )

    try:
        await _notify_admins_deletion_request(supplier, reason)
    except Exception as e:
        logger.error("Заявку на видалення #%s збережено, сповіщення адмінам не пішло: %s", supplier.id, e)

    return SupplierDeletionResponse()


def _widget_shop_from_row(row: dict) -> SupplierQueueShopProgress:
    fetching = bool(row.get("is_fetching_xml"))
    position = int(row["queue_position"])
    status = str(row.get("status") or (
        "fetching_xml" if fetching else ("processing" if position == 0 else "waiting")
    ))
    estimated = int(row.get("estimated_minutes", row.get("remaining_minutes") or 0))
    return SupplierQueueShopProgress(
        supplier_id=int(row["supplier_id"]),
        shop_name=str(row["shop_name"]),
        status=status,
        total=int(row["total"]),
        processed=int(row["processed"]),
        pending_count=int(row["pending_count"]),
        queue_position=position,
        items_ahead=int(row["items_ahead"]),
        estimated_minutes=estimated,
        wait_minutes=int(row["wait_minutes"]),
        is_processing=bool(row["is_processing"]),
        is_fetching_xml=fetching,
    )


@router.get("/me/import-progress", response_model=List[SupplierQueueShopProgress])
async def get_my_import_progress(
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
):
    """
    Масив магазинів поточного користувача в XML-парсингу або AI-черзі.
    Час магазину №2 = (залишок №1 + товари №2) * 15 / 60.
    """
    telegram_id = _telegram_id_from_authorization(authorization)
    if not telegram_id:
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )

    owner_ids = set(int(x) for x in await _supplier_ids_for_telegram(db, telegram_id))
    if not owner_ids:
        return []

    view = await build_ai_queue_view(db)
    mine = [row for row in view if int(row["supplier_id"]) in owner_ids]
    return [_widget_shop_from_row(row) for row in mine]


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
    try:
        yml_link, extracted_key = normalize_mydrop_yml_link(request_data.resolved_yml())
    except InvalidMyDropYmlLinkError as e:
        raise HTTPException(status_code=400, detail=str(e))
    source_type = request_data.resolved_source_type()
    telegram_channel_link = request_data.resolved_telegram_channel_link()
    if source_type == "telegram" and not telegram_channel_link:
        raise HTTPException(
            status_code=400,
            detail="Для джерела Telegram вкажіть посилання на канал (наприклад @my_shoes_drop).",
        )
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

    has_duplicates = await _has_duplicates(
        db, edrpou_ipn, yml_link, mydrop_api_key=extracted_key,
    )
    await assert_source_not_duplicate(
        db,
        source_type,
        yml_link=yml_link,
        telegram_channel_link=telegram_channel_link,
    )
    trial_ends_at = None
    if legal_type == SupplierLegalType.individual:
        trial_ends_at = datetime.now(timezone.utc) + timedelta(days=30)

    catalog_type = SupplierType.mydrop if extracted_key else SupplierType.independent
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
            source_type=source_type,
            telegram_channel_link=telegram_channel_link,
            channel_link=channel_link,
            xml_url=yml_link,
            mydrop_api_key=extracted_key,
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
    ai_payload["yml_link"] = new_supplier.yml_link
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
