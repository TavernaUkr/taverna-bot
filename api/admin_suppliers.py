# api/admin_suppliers.py
"""Заявки постачальників для React-адмінки Mini App."""
import logging
import time
from datetime import datetime, timezone
from typing import List, Optional
from uuid import uuid4
import math

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from sqlalchemy import delete, func, inspect, select, text, update

from api.auth import validate_init_data
from api_models import (
    AdminApproveDeletionResponse,
    AdminAiQueueResponse,
    AdminAiQueueCurrentResponse,
    AdminAiQueueWaitingItem,
    AdminDirectCreateSupplierRequest,
    AdminStoreListItem,
    AdminSupplierDeleteResponse,
    PendingSupplierApplicationResponse,
    SupplierImportProgressResponse,
    SupplierQueueShopProgress,
    SupplierTransferRequest,
    SupplierTransferResponse,
    TelegramChannelVerifyRequest,
    TelegramChannelVerifyResponse,
)
from config_reader import config
from database.db import get_db, AsyncSession
from database.models import (
    Order,
    OrderItem,
    PaidService,
    PriceRule,
    Product,
    ProductAIStatus,
    ProductOption,
    ProductOptionValue,
    ProductStatus,
    ProductVariant,
    Supplier,
    SupplierLegalType,
    SupplierStatus,
    SupplierType,
    User,
    UserRole,
    product_variant_option_values,
    supplier_channels,
)
from api.suppliers import (
    SECONDS_PER_PRODUCT_AI,
    _clear_deletion_request_notes,
    _deletion_reason,
    _deletion_requested,
    assert_source_not_duplicate,
    verify_telegram_channel_or_raise,
)
from services.ai_queue_worker import build_ai_queue_view
from services.mydrop_api import (
    InvalidMyDropYmlLinkError,
    normalize_mydrop_yml_link,
)
from services.mydrop_sync import schedule_supplier_catalog_import
from services.telegram_sync import run_telegram_import_job

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/admin", tags=["Admin (Supplier Applications)"])

PENDING_STATUSES = (
    SupplierStatus.pending_ai_analysis,
    SupplierStatus.ai_in_progress,
    SupplierStatus.pending_admin_approval,
)

HISTORY_STATUSES = (
    SupplierStatus.parsing,
    SupplierStatus.active,
    SupplierStatus.rejected,
    SupplierStatus.banned,
    SupplierStatus.deleted,
    SupplierStatus.disabled,
)


def _to_application(
    supplier: Supplier,
    import_started: bool = False,
) -> PendingSupplierApplicationResponse:
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
    elif status_value == SupplierStatus.active.value:
        ui_status = "approved"
    elif status_value == SupplierStatus.disabled.value:
        ui_status = "banned"
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
        source_type=getattr(supplier, "source_type", None) or "xml",
        telegram_channel_link=getattr(supplier, "telegram_channel_link", None),
        channel_link=supplier.channel_link,
        manager_telegram=supplier.manager_telegram,
        iban=supplier.iban or supplier.payout_iban,
        bank_name=supplier.bank_name,
        status=ui_status,
        is_verified=bool(supplier.is_verified),
        telegram_id=int(supplier.contact_telegram_id) if supplier.contact_telegram_id else None,
        ai_score_report=supplier.ai_score_report,
        scoring_result=supplier.ai_score_report,
        trial_ends_at=supplier.trial_ends_at,
        created_at=supplier.created_at,
        approved_at=getattr(supplier, "approved_at", None),
        restored_at=getattr(supplier, "restored_at", None),
        deleted_at=getattr(supplier, "deleted_at", None),
        import_started=import_started,
        deletion_reason=_deletion_reason(supplier),
    )


def _to_store_item(supplier: Supplier, product_count: int = 0) -> AdminStoreListItem:
    status_value = supplier.status.value if getattr(supplier.status, "value", None) else str(supplier.status)
    return AdminStoreListItem(
        id=supplier.id,
        shop_name=supplier.store_name or supplier.name or "-",
        company_name=supplier.legal_name,
        contact_name=supplier.legal_name,
        is_active=status_value == SupplierStatus.active.value,
        created_at=supplier.created_at,
        manager_telegram=supplier.manager_telegram,
        xml_url=supplier.yml_link or supplier.xml_url,
        description=supplier.store_description,
        logo_url=supplier.logo_url,
        cover_image_url=supplier.cover_image_url,
        product_count=product_count,
        user_id=supplier.user_id,
        telegram_id=int(supplier.contact_telegram_id) if supplier.contact_telegram_id else None,
        status="approved" if status_value == SupplierStatus.active.value else status_value,
    )


def _assert_admin(
    telegram_id: Optional[int],
    authorization: Optional[str],
) -> Optional[int]:
    resolved = telegram_id
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token.strip():
            user_data = validate_init_data(token.strip())
            if user_data is None:
                raise HTTPException(
                    status_code=401,
                    detail="Invalid initData: Hash mismatch or expired",
                )
            raw_id = user_data.get("id")
            if raw_id:
                resolved = int(raw_id)
    if resolved is not None and resolved not in set(config.ADMIN_IDS):
        raise HTTPException(status_code=403, detail="Admin access required")
    return resolved


_PLACEHOLDER_TELEGRAM_IDS = {0, 123456789}


def _is_placeholder_telegram_id(value: Optional[int]) -> bool:
    if value is None:
        return True
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return True
    return parsed <= 0 or parsed in _PLACEHOLDER_TELEGRAM_IDS


_SHOP_TABLE_CANDIDATES = ("stores", "shops", "store", "shop")


async def _load_user_by_telegram(db: AsyncSession, telegram_id: int) -> Optional[User]:
    return (
        await db.execute(select(User).where(User.telegram_id == int(telegram_id)))
    ).scalars().first()


async def _load_user_by_id(db: AsyncSession, user_id: int) -> Optional[User]:
    return await db.get(User, int(user_id))


async def _resolve_current_admin(
    db: AsyncSession,
    telegram_id: Optional[int],
    authorization: Optional[str],
) -> tuple[Optional[int], Optional[User]]:
    """Поточний адмін: Bearer initData → query telegram_id → перший User з роллю admin."""
    admin_tg = _assert_admin(telegram_id, authorization)
    if _is_placeholder_telegram_id(admin_tg):
        admin_tg = None
    admin_user = await _load_user_by_telegram(db, admin_tg) if admin_tg else None
    if admin_user is None:
        admin_user = (
            await db.execute(
                select(User).where(User.role == UserRole.admin).order_by(User.id.asc())
            )
        ).scalars().first()
        if admin_user and admin_tg is None and getattr(admin_user, "telegram_id", None):
            admin_tg = int(admin_user.telegram_id)
    return admin_tg, admin_user


async def _resolve_shop_owner(
    db: AsyncSession,
    request_data: AdminDirectCreateSupplierRequest,
    admin_tg: Optional[int],
    admin_user: Optional[User],
) -> tuple[Optional[int], Optional[int]]:
    """
    Власник магазину: явний user_id / telegram_id з тіла запиту,
    інакше — поточний адмін.
    """
    owner_user_id = getattr(request_data, "user_id", None)
    owner_tg = (
        getattr(request_data, "owner_telegram_id", None)
        or getattr(request_data, "telegram_id", None)
    )
    owner_user: Optional[User] = None
    if owner_user_id:
        try:
            owner_user = await _load_user_by_id(db, int(owner_user_id))
        except (TypeError, ValueError):
            owner_user = None
    if owner_user is None and not _is_placeholder_telegram_id(owner_tg):
        owner_user = await _load_user_by_telegram(db, int(owner_tg))

    if owner_user is not None:
        tg = int(owner_user.telegram_id) if owner_user.telegram_id else (
            int(owner_tg) if not _is_placeholder_telegram_id(owner_tg) else None
        )
        return tg, int(owner_user.id)

    if not _is_placeholder_telegram_id(owner_tg):
        return int(owner_tg), admin_user.id if admin_user else None

    return (
        int(admin_tg) if admin_tg else None,
        int(admin_user.id) if admin_user else None,
    )


def _shop_name_of(supplier: Supplier) -> str:
    return (supplier.store_name or supplier.name or "").strip() or "Магазин"


async def _ensure_shop_record(db: AsyncSession, supplier: Supplier) -> None:
    """
    Магазин у цій БД — це сам Supplier (store_name).
    Якщо раптом є окрема таблиця Store/Shop — створюємо рядок і туди.
    """
    shop_name = _shop_name_of(supplier)
    supplier.store_name = shop_name
    if not (supplier.name or "").strip():
        supplier.name = shop_name

    def _maybe_insert_legacy_shop(sync_session) -> None:
        # db.run_sync() передає Session, а inspect() працює лише з Connection/Engine.
        try:
            bind = sync_session.connection()
        except Exception:
            bind = sync_session.get_bind()
        insp = inspect(bind)
        tables = set(insp.get_table_names())
        target = next((name for name in _SHOP_TABLE_CANDIDATES if name in tables), None)
        if not target:
            logger.info(
                "Таблиці Store/Shop немає — вітрина постачальника #%s = Supplier.store_name «%s».",
                supplier.id, shop_name,
            )
            return

        cols = {col["name"] for col in insp.get_columns(target)}
        if "supplier_id" in cols:
            exists = sync_session.execute(
                text(f"SELECT 1 FROM {target} WHERE supplier_id = :sid LIMIT 1"),
                {"sid": supplier.id},
            ).first()
            if exists:
                return

        values = {}
        if "name" in cols:
            values["name"] = shop_name
        if "shop_name" in cols:
            values["shop_name"] = shop_name
        if "store_name" in cols:
            values["store_name"] = shop_name
        if "supplier_id" in cols:
            values["supplier_id"] = supplier.id
        if "user_id" in cols and supplier.user_id:
            values["user_id"] = supplier.user_id
        if "is_active" in cols:
            values["is_active"] = True
        if "status" in cols:
            values["status"] = "active"
        if not values:
            logger.warning("Таблиця %s є, але немає відомих колонок для вставки магазину.", target)
            return

        col_sql = ", ".join(values.keys())
        bind_sql = ", ".join(f":{key}" for key in values)
        try:
            sync_session.execute(
                text(f"INSERT INTO {target} ({col_sql}) VALUES ({bind_sql})"),
                values,
            )
            logger.info("Створено рядок магазину в %s для постачальника #%s.", target, supplier.id)
        except Exception as e:
            logger.warning(
                "Не вдалося вставити магазин у %s для постачальника #%s: %s",
                target, supplier.id, e,
            )

    try:
        await db.run_sync(_maybe_insert_legacy_shop)
    except Exception as e:
        logger.warning(
            "Перевірка legacy Store/Shop для постачальника #%s пропущена: %s",
            supplier.id, e,
        )


def _user_role_value(user: User) -> str:
    return user.role.value if hasattr(user.role, "value") else str(user.role)


async def _count_other_approved_shops(
    db: AsyncSession,
    user_id: int,
    exclude_supplier_id: int,
) -> int:
    """Скільки ще магазинів зі статусом approved/active є в цього user_id."""
    result = await db.execute(
        select(func.count(Supplier.id)).where(
            Supplier.user_id == user_id,
            Supplier.id != exclude_supplier_id,
            Supplier.status == SupplierStatus.active,
        )
    )
    return int(result.scalar() or 0)


async def _maybe_revert_user_to_client(
    db: AsyncSession,
    user_id: Optional[int],
    exclude_supplier_id: int,
) -> bool:
    """
    client ставимо лише якщо це не admin і це був останній approved-магазин.
    """
    if not user_id:
        return False
    user = await db.get(User, user_id)
    if not user:
        return False
    if _user_role_value(user) == UserRole.admin.value:
        logger.info("Роль admin не змінюємо (user_id=%s, магазин #%s).", user_id, exclude_supplier_id)
        return False
    others = await _count_other_approved_shops(db, user_id, exclude_supplier_id)
    if others > 0:
        logger.info(
            "User #%s має ще %s активних магазинів — роль supplier лишаємо.",
            user_id,
            others,
        )
        return False
    user.role = UserRole.client
    return True


async def _mark_all_supplier_products_deleted(db: AsyncSession, supplier_id: int) -> int:
    """
    Усі товари магазину зникають з каталогу: status=deleted, AI cancelled,
    is_ai_processed=False (готовий completed теж ховаємо).
    """
    result = await db.execute(
        update(Product)
        .where(Product.supplier_id == supplier_id)
        .values(
            status=ProductStatus.deleted,
            is_ai_processed=False,
            ai_status=ProductAIStatus.cancelled,
        )
    )
    return int(result.rowcount or 0)


async def _restore_all_supplier_products(db: AsyncSession, supplier_id: int) -> int:
    """
    Повертає soft-deleted товари в каталог і знову ставить
    необроблені (cancelled / без AI) у чергу Gemini як pending.
    """
    restored = await db.execute(
        update(Product)
        .where(
            Product.supplier_id == supplier_id,
            Product.status == ProductStatus.deleted,
        )
        .values(status=ProductStatus.active)
    )
    queued = await db.execute(
        update(Product)
        .where(
            Product.supplier_id == supplier_id,
            Product.ai_status == ProductAIStatus.cancelled,
            Product.is_ai_processed.is_(False),
        )
        .values(ai_status=ProductAIStatus.pending)
    )
    queued_count = int(queued.rowcount or 0)
    if queued_count:
        logger.info(
            "Restore #%s: повернуто %s товарів у AI-чергу (cancelled → pending).",
            supplier_id,
            queued_count,
        )
    return int(restored.rowcount or 0)


async def _hard_delete_supplier(db: AsyncSession, supplier: Supplier) -> bool:
    """Жорстко видаляє товари, замовлення магазину і сам Supplier. User лишається."""
    supplier_id = supplier.id
    user_id = supplier.user_id

    product_ids = list(
        (await db.execute(select(Product.id).where(Product.supplier_id == supplier_id))).scalars().all()
    )
    variant_ids = []
    option_ids = []
    if product_ids:
        variant_ids = list(
            (await db.execute(
                select(ProductVariant.id).where(ProductVariant.product_id.in_(product_ids))
            )).scalars().all()
        )
        option_ids = list(
            (await db.execute(
                select(ProductOption.id).where(ProductOption.product_id.in_(product_ids))
            )).scalars().all()
        )

    if variant_ids:
        await db.execute(
            delete(product_variant_option_values).where(
                product_variant_option_values.c.variant_id.in_(variant_ids)
            )
        )
    if option_ids:
        await db.execute(delete(ProductOptionValue).where(ProductOptionValue.option_id.in_(option_ids)))
        await db.execute(delete(ProductOption).where(ProductOption.id.in_(option_ids)))
    if variant_ids:
        await db.execute(delete(ProductVariant).where(ProductVariant.id.in_(variant_ids)))

    await db.execute(delete(OrderItem).where(OrderItem.supplier_id == supplier_id))
    if product_ids:
        await db.execute(delete(OrderItem).where(OrderItem.product_id.in_(product_ids)))
        await db.execute(delete(PaidService).where(PaidService.product_id.in_(product_ids)))

    await db.execute(delete(PaidService).where(PaidService.supplier_id == supplier_id))

    order_ids = list(
        (await db.execute(select(Order.id).where(Order.supplier_id == supplier_id))).scalars().all()
    )
    if order_ids:
        await db.execute(update(Order).where(Order.parent_order_id.in_(order_ids)).values(parent_order_id=None))
        await db.execute(update(Order).where(Order.id.in_(order_ids)).values(parent_order_id=None))
        await db.execute(delete(OrderItem).where(OrderItem.order_id.in_(order_ids)))
        await db.execute(delete(PaidService).where(PaidService.order_id.in_(order_ids)))
        await db.execute(delete(Order).where(Order.id.in_(order_ids)))

    await db.execute(delete(PriceRule).where(PriceRule.supplier_id == supplier_id))
    await db.execute(delete(supplier_channels).where(supplier_channels.c.supplier_id == supplier_id))
    if product_ids:
        await db.execute(delete(Product).where(Product.id.in_(product_ids)))

    user_reverted = await _maybe_revert_user_to_client(db, user_id, supplier_id)

    supplier.deleted_at = datetime.now(timezone.utc)
    await db.delete(supplier)
    await db.commit()
    return user_reverted


@router.get("/suppliers/pending", response_model=List[PendingSupplierApplicationResponse])
async def list_pending_supplier_applications(
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """Список заявок зі статусом pending, включно з ai_score_report."""
    _assert_admin(telegram_id, authorization)

    stmt = (
        select(Supplier)
        .where(Supplier.status.in_(PENDING_STATUSES))
        .order_by(Supplier.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_application(item) for item in rows]


@router.get("/suppliers/deletion-requests", response_model=List[PendingSupplierApplicationResponse])
async def list_deletion_requests(
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """Постачальники, які подали заявку на видалення магазину."""
    _assert_admin(telegram_id, authorization)

    stmt = (
        select(Supplier)
        .where(Supplier.status == SupplierStatus.deletion_requested)
        .order_by(Supplier.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_application(item) for item in rows]


@router.get("/suppliers/history", response_model=List[PendingSupplierApplicationResponse])
async def list_supplier_history(
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """Історія: approved (активні), rejected, banned, deleted."""
    _assert_admin(telegram_id, authorization)

    stmt = (
        select(Supplier)
        .where(Supplier.status.in_(HISTORY_STATUSES))
        .order_by(Supplier.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_application(item) for item in rows]


@router.get("/suppliers/all", response_model=List[AdminStoreListItem])
async def list_all_active_stores(
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """
    Усі магазини платформи для адмінки (без фільтра по user_id / telegram_id).
    Активні та вимкнені; видалені й заявки не показуємо.
    """
    _assert_admin(telegram_id, authorization)

    stmt = (
        select(Supplier)
        .where(
            Supplier.status.in_((SupplierStatus.active, SupplierStatus.disabled)),
        )
        .order_by(Supplier.created_at.desc())
    )
    rows = list((await db.execute(stmt)).scalars().all())
    if not rows:
        return []

    supplier_ids = [item.id for item in rows]
    count_rows = (
        await db.execute(
            select(Product.supplier_id, func.count(Product.id))
            .where(
                Product.supplier_id.in_(supplier_ids),
                Product.status != ProductStatus.deleted,
            )
            .group_by(Product.supplier_id)
        )
    ).all()
    counts = {int(sid): int(cnt) for sid, cnt in count_rows}
    return [_to_store_item(item, counts.get(item.id, 0)) for item in rows]


@router.get("/suppliers/import-progress", response_model=SupplierImportProgressResponse)
async def admin_global_import_progress(
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """Глобальна AI-черга: усі pending/processing товари в системі."""
    _assert_admin(telegram_id, authorization)

    total = int(
        (
            await db.execute(
                select(func.count(Product.id)).where(
                    Product.status != ProductStatus.deleted,
                    Product.ai_status != ProductAIStatus.cancelled,
                )
            )
        ).scalar()
        or 0
    )
    completed = int(
        (
            await db.execute(
                select(func.count(Product.id)).where(
                    Product.status != ProductStatus.deleted,
                    Product.ai_status == ProductAIStatus.completed,
                )
            )
        ).scalar()
        or 0
    )
    in_queue = int(
        (
            await db.execute(
                select(func.count(Product.id)).where(
                    Product.status != ProductStatus.deleted,
                    Product.ai_status.in_((ProductAIStatus.pending, ProductAIStatus.processing)),
                )
            )
        ).scalar()
        or 0
    )
    estimated_minutes = math.ceil(in_queue * SECONDS_PER_PRODUCT_AI / 60) if in_queue else 0
    return SupplierImportProgressResponse(
        total=total,
        completed=completed,
        estimated_minutes=estimated_minutes,
        is_importing=in_queue > 0,
        queue_ahead=in_queue,
        queue_position=0,
    )


@router.get("/ai-queue", response_model=AdminAiQueueResponse)
async def admin_ai_queue(
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """
    Глобальна AI-черга по магазинах:
    хто обробляється зараз + хто чекає.
    shops — усі магазини системи з queue_position і сумарним estimated_minutes.
    """
    _assert_admin(telegram_id, authorization)
    view = await build_ai_queue_view(db)
    if not view:
        return AdminAiQueueResponse(current_processing=None, waiting_list=[], shops=[])

    def _shop_item(row: dict) -> SupplierQueueShopProgress:
        estimated = int(row.get("estimated_minutes", row["remaining_minutes"]))
        fetching = bool(row.get("is_fetching_xml"))
        position = int(row["queue_position"])
        status = str(row.get("status") or (
            "fetching_xml" if fetching else ("processing" if position == 0 else "waiting")
        ))
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

    def _waiting_item(row: dict) -> AdminAiQueueWaitingItem:
        estimated = int(row.get("estimated_minutes", row["remaining_minutes"]))
        return AdminAiQueueWaitingItem(
            supplier_id=int(row["supplier_id"]),
            shop_name=str(row["shop_name"]),
            pending_count=int(row["pending_count"]),
            queue_position=int(row["queue_position"]),
            processed=int(row["processed"]),
            total=int(row["total"]),
            remaining_minutes=estimated,
            wait_minutes=int(row["wait_minutes"]),
            estimated_minutes=estimated,
            created_at=row.get("created_at"),
            is_fetching_xml=bool(row.get("is_fetching_xml")),
        )

    shops = [_shop_item(row) for row in view]
    first = view[0]
    estimated = int(first.get("estimated_minutes", first["remaining_minutes"]))
    current = AdminAiQueueCurrentResponse(
        supplier_id=int(first["supplier_id"]),
        shop_name=str(first["shop_name"]),
        processed=int(first["processed"]),
        total=int(first["total"]),
        pending_count=int(first["pending_count"]),
        remaining_minutes=estimated,
        wait_minutes=int(first["wait_minutes"]),
        estimated_minutes=estimated,
        created_at=first.get("created_at"),
        is_fetching_xml=bool(first.get("is_fetching_xml")),
    )
    waiting_src = view[1:]
    return AdminAiQueueResponse(
        current_processing=current,
        waiting_list=[_waiting_item(row) for row in waiting_src],
        shops=shops,
    )


@router.post("/suppliers/{supplier_id}/approve-deletion", response_model=AdminApproveDeletionResponse)
async def approve_supplier_deletion(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """
    Адмін підтверджує видалення: статус deleted, УСІ товари ховаємо з каталогу,
    роль User → client лише якщо не admin і немає інших approved-магазинів.
    """
    _assert_admin(telegram_id, authorization)

    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Постачальника не знайдено")

    status_value = supplier.status.value if hasattr(supplier.status, "value") else str(supplier.status)
    if status_value == SupplierStatus.deleted.value:
        raise HTTPException(status_code=409, detail="Магазин уже видалено.")
    if not _deletion_requested(supplier):
        raise HTTPException(status_code=409, detail="Немає заявки на видалення.")

    products_removed = await _mark_all_supplier_products_deleted(db, supplier_id)

    supplier.status = SupplierStatus.deleted
    supplier.is_verified = False
    supplier.deleted_at = datetime.now(timezone.utc)

    user_reverted = await _maybe_revert_user_to_client(db, supplier.user_id, supplier_id)

    await db.commit()
    logger.info(
        "Адмін підтвердив видалення #%s, products_deleted=%s, user_reverted=%s",
        supplier_id,
        products_removed,
        user_reverted,
    )
    return AdminApproveDeletionResponse(
        ok=True,
        supplier_id=supplier_id,
        status="deleted",
        user_reverted=user_reverted,
        products_archived=products_removed,
        ai_cancelled=products_removed,
        detail="Магазин видалено. Усі товари прибрано з каталогу.",
    )


@router.post("/suppliers/{supplier_id}/restore", response_model=PendingSupplierApplicationResponse)
async def restore_supplier(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """
    Soft Undelete: повертає видалений магазин і його товари.
    Статус у БД — active (у відповіді адмінки це 'approved').
    """
    _assert_admin(telegram_id, authorization)

    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Постачальника не знайдено")

    status_value = supplier.status.value if hasattr(supplier.status, "value") else str(supplier.status)
    if status_value != SupplierStatus.deleted.value:
        raise HTTPException(status_code=409, detail="Магазин не видалено — відновлювати нічого.")

    supplier.status = SupplierStatus.active
    supplier.is_verified = True
    supplier.deleted_at = None
    now_utc = datetime.now(timezone.utc)
    supplier.restored_at = now_utc
    supplier.queue_joined_at = now_utc
    if supplier.approved_at is None:
        supplier.approved_at = now_utc
    _clear_deletion_request_notes(supplier)

    if supplier.user_id:
        user = await db.get(User, supplier.user_id)
        if user and _user_role_value(user) == UserRole.client.value:
            user.role = UserRole.supplier

    products_restored = await _restore_all_supplier_products(db, supplier_id)
    await _ensure_shop_record(db, supplier)
    await db.commit()
    await db.refresh(supplier)

    logger.info(
        "Адмін відновив магазин #%s, products_restored=%s",
        supplier_id,
        products_restored,
    )
    return _to_application(supplier)


@router.post("/suppliers/verify-telegram", response_model=TelegramChannelVerifyResponse)
async def admin_verify_telegram_channel(
    request_data: TelegramChannelVerifyRequest,
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """Жива перевірка доступу до Telegram-каналу перед створенням магазину адміном."""
    _assert_admin(telegram_id, authorization)
    return await verify_telegram_channel_or_raise(request_data.telegram_channel_link)


@router.post("/suppliers/direct-create", response_model=PendingSupplierApplicationResponse, status_code=201)
async def direct_create_supplier(
    request_data: AdminDirectCreateSupplierRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """
    Режим Бога: адмін створює магазин-вітрину одразу зі статусом approved.
    ІПН/ЄДРПОУ/IBAN — необов'язкові. Якщо є yml_link — одразу стартує імпорт.
    Якщо власника не вказано / тестовий — магазин належить адміну.
    """
    admin_tg, admin_user = await _resolve_current_admin(db, telegram_id, authorization)
    owner_tg, owner_user_id = await _resolve_shop_owner(
        db, request_data, admin_tg, admin_user
    )
    try:
        store_name = request_data.resolved_name()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

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
    await assert_source_not_duplicate(
        db,
        source_type,
        yml_link=yml_link,
        telegram_channel_link=telegram_channel_link,
    )
    description = request_data.resolved_description()
    edrpou_ipn = request_data.resolved_edrpou_ipn()
    iban = request_data.resolved_iban()
    channel_link = request_data.resolved_channel()
    legal_name = request_data.resolved_legal_name()
    catalog_type = SupplierType.mydrop if extracted_key else SupplierType.independent

    legal_type = None
    raw_legal = (request_data.supplier_type or "").strip().lower()
    if raw_legal in ("business", "company"):
        legal_type = SupplierLegalType.business
    elif raw_legal in ("individual", "fop", "person"):
        legal_type = SupplierLegalType.individual

    unique_key = f"admin_direct_{int(time.time())}_{uuid4().hex[:8]}"
    new_supplier = Supplier(
        key=unique_key,
        name=store_name,
        type=catalog_type,
        status=SupplierStatus.active,
        supplier_type=legal_type,
        yml_link=yml_link,
        source_type=source_type,
        telegram_channel_link=telegram_channel_link,
        channel_link=channel_link,
        xml_url=yml_link,
        telegram_channel=channel_link,
        is_verified=True,
        edrpou_ipn=edrpou_ipn,
        edrpou=edrpou_ipn if edrpou_ipn and len(edrpou_ipn) == 8 else None,
        ipn=edrpou_ipn if edrpou_ipn and len(edrpou_ipn) != 8 else None,
        manager_telegram=request_data.manager_telegram,
        store_name=store_name,
        store_description=description,
        iban=iban,
        payout_iban=iban,
        bank_name=request_data.resolved_bank(),
        legal_name=legal_name,
        mydrop_api_key=extracted_key,
        ai_score_report=(
            None
            if source_type == "telegram"
            else "Створено адміном (direct-create). AI-скоринг заявки не потрібен."
        ),
        approved_at=datetime.now(timezone.utc),
        contact_telegram_id=owner_tg,
        user_id=owner_user_id,
    )
    if source_type == "telegram" or yml_link or extracted_key:
        new_supplier.status = SupplierStatus.parsing
    db.add(new_supplier)
    await db.flush()
    await _ensure_shop_record(db, new_supplier)
    await db.commit()
    await db.refresh(new_supplier)

    import_started = False
    if source_type == "telegram":
        background_tasks.add_task(run_telegram_import_job, new_supplier.id)
        import_started = True
        from api.suppliers import _process_application_background, _schedule_background
        _schedule_background(
            _process_application_background(
                new_supplier.id,
                {
                    "source_type": "telegram",
                    "telegram_channel_link": telegram_channel_link,
                    "channel_link": channel_link,
                    "store_name": store_name,
                },
                False,
            )
        )
    elif yml_link or extracted_key:
        schedule_supplier_catalog_import(new_supplier.id)
        import_started = True

    logger.info(
        "Адмін створив магазин #%s (%s), owner_user_id=%s, owner_tg=%s, import_started=%s",
        new_supplier.id, store_name, owner_user_id, owner_tg, import_started,
    )
    return _to_application(new_supplier, import_started=import_started)


@router.post("/suppliers/{supplier_id}/transfer", response_model=SupplierTransferResponse)
async def transfer_supplier_ownership(
    supplier_id: int,
    request_data: SupplierTransferRequest,
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """
    Передача прав на магазин: прив'язує suppliers.user_id до users.id
    за Telegram username. Роль партнера в БД — supplier.
    """
    _assert_admin(telegram_id, authorization)

    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Постачальника не знайдено")

    username = (request_data.new_owner_username or "").strip().lstrip("@")
    if not username:
        raise HTTPException(status_code=400, detail="Вкажіть username нового власника.")

    username_l = username.lower()
    new_owner = (
        await db.execute(
            select(User).where(
                or_(
                    func.lower(User.username) == username_l,
                    func.lower(User.username) == f"@{username_l}",
                )
            )
        )
    ).scalar_one_or_none()
    if not new_owner:
        raise HTTPException(
            status_code=404,
            detail="Користувач не знайдений. Він має хоча б раз запустити бота.",
        )

    previous_user_id = supplier.user_id
    supplier.user_id = new_owner.id
    if new_owner.telegram_id:
        supplier.contact_telegram_id = int(new_owner.telegram_id)

    current_role = _user_role_value(new_owner)
    if current_role not in (UserRole.admin.value, UserRole.supplier.value):
        new_owner.role = UserRole.supplier

    if previous_user_id and previous_user_id != new_owner.id:
        await _maybe_revert_user_to_client(db, previous_user_id, supplier_id)

    await db.commit()
    logger.info(
        "Адмін передав магазин #%s користувачу @%s (user_id=%s)",
        supplier_id,
        username,
        new_owner.id,
    )
    return SupplierTransferResponse(message="Права успішно передано")


@router.post("/suppliers/{supplier_id}/approve", response_model=PendingSupplierApplicationResponse)
async def approve_supplier_application(
    supplier_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    _assert_admin(telegram_id, authorization)

    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Заявку не знайдено")

    source_type = (getattr(supplier, "source_type", None) or "xml").strip().lower()

    supplier.is_verified = True
    supplier.approved_at = datetime.now(timezone.utc)
    if source_type != "telegram":
        try:
            canonical_yml, extracted_key = normalize_mydrop_yml_link(
                supplier.yml_link or supplier.xml_url or supplier.mydrop_api_key or ""
            )
        except InvalidMyDropYmlLinkError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if extracted_key:
            supplier.yml_link = canonical_yml
            supplier.xml_url = canonical_yml
            supplier.mydrop_api_key = extracted_key
            supplier.type = SupplierType.mydrop
        elif canonical_yml:
            supplier.yml_link = canonical_yml
            supplier.xml_url = canonical_yml
    if supplier.user_id:
        user = await db.get(User, supplier.user_id)
        if user and user.role != UserRole.admin:
            user.role = UserRole.supplier
    await _ensure_shop_record(db, supplier)

    import_started = False
    if source_type == "telegram":
        supplier.status = SupplierStatus.parsing
        import_started = True
    else:
        has_feed = bool(supplier.yml_link or supplier.xml_url or supplier.mydrop_api_key)
        if has_feed:
            supplier.status = SupplierStatus.parsing
            import_started = True
        else:
            supplier.status = SupplierStatus.active

    await db.commit()
    await db.refresh(supplier)

    if source_type == "telegram":
        background_tasks.add_task(run_telegram_import_job, supplier.id)
    elif import_started:
        schedule_supplier_catalog_import(supplier.id)

    logger.info(
        "Адмін схвалив заявку #%s, source_type=%s, import_started=%s",
        supplier_id, source_type, import_started,
    )
    return _to_application(supplier, import_started=import_started)


@router.post("/suppliers/{supplier_id}/reject", response_model=PendingSupplierApplicationResponse)
async def reject_supplier_application(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    _assert_admin(telegram_id, authorization)

    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Заявку не знайдено")

    supplier.is_verified = False
    supplier.status = SupplierStatus.rejected
    await db.commit()
    await db.refresh(supplier)
    logger.info("Адмін відхилив заявку #%s", supplier_id)
    return _to_application(supplier)


@router.delete("/suppliers/{supplier_id}", response_model=AdminSupplierDeleteResponse)
async def hard_delete_supplier(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """Жорстке видалення постачальника, його товарів і магазину. User лишається клієнтом."""
    _assert_admin(telegram_id, authorization)

    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Постачальника не знайдено")

    user_reverted = await _hard_delete_supplier(db, supplier)
    logger.info(
        "Адмін видалив постачальника #%s, user_reverted=%s",
        supplier_id, user_reverted,
    )
    return AdminSupplierDeleteResponse(
        ok=True,
        supplier_id=supplier_id,
        user_reverted=user_reverted,
        detail="Постачальника та його товари видалено. Користувач знову став клієнтом.",
    )
