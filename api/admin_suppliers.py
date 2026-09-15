# api/admin_suppliers.py
"""Заявки постачальників для React-адмінки Mini App."""
import logging
import time
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import delete, inspect, select, text, update

from api.auth import validate_init_data
from api_models import (
    AdminDirectCreateSupplierRequest,
    AdminSupplierDeleteResponse,
    PendingSupplierApplicationResponse,
)
from config_reader import config
from database.db import get_db, AsyncSession
from database.models import (
    Order,
    OrderItem,
    PaidService,
    PriceRule,
    Product,
    ProductOption,
    ProductOptionValue,
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
from services.mydrop_api import extract_public_api_key
from services.mydrop_sync import schedule_supplier_catalog_import

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/admin", tags=["Admin (Supplier Applications)"])

PENDING_STATUSES = (
    SupplierStatus.pending_ai_analysis,
    SupplierStatus.ai_in_progress,
    SupplierStatus.pending_admin_approval,
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
        import_started=import_started,
    )


def _assert_admin(
    telegram_id: Optional[int],
    authorization: Optional[str],
) -> None:
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


_SHOP_TABLE_CANDIDATES = ("stores", "shops", "store", "shop")


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

    def _maybe_insert_legacy_shop(sync_conn) -> None:
        insp = inspect(sync_conn)
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
            exists = sync_conn.execute(
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
            sync_conn.execute(
                text(f"INSERT INTO {target} ({col_sql}) VALUES ({bind_sql})"),
                values,
            )
            logger.info("Створено рядок магазину в %s для постачальника #%s.", target, supplier.id)
        except Exception as e:
            logger.warning(
                "Не вдалося вставити магазин у %s для постачальника #%s: %s",
                target, supplier.id, e,
            )

    await db.run_sync(_maybe_insert_legacy_shop)


async def _hard_delete_supplier(db: AsyncSession, supplier: Supplier) -> bool:
    """Жорстко видаляє товари, замовлення магазину і сам Supplier. User лишається."""
    supplier_id = supplier.id
    user_id = supplier.user_id
    user_reverted = False

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

    if user_id:
        user = await db.get(User, user_id)
        if user and user.role != UserRole.admin:
            other_active = (
                await db.execute(
                    select(Supplier.id).where(
                        Supplier.user_id == user_id,
                        Supplier.id != supplier_id,
                        Supplier.status == SupplierStatus.active,
                    ).limit(1)
                )
            ).scalar_one_or_none()
            if other_active is None:
                user.role = UserRole.client
                user_reverted = True

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


@router.post("/suppliers/direct-create", response_model=PendingSupplierApplicationResponse, status_code=201)
async def direct_create_supplier(
    request_data: AdminDirectCreateSupplierRequest,
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """
    Режим Бога: адмін створює магазин-вітрину одразу зі статусом approved.
    ІПН/ЄДРПОУ/IBAN — необов'язкові. Якщо є yml_link — одразу стартує імпорт.
    """
    _assert_admin(telegram_id, authorization)
    try:
        store_name = request_data.resolved_name()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    yml_link = request_data.resolved_yml()
    description = request_data.resolved_description()
    edrpou_ipn = request_data.resolved_edrpou_ipn()
    iban = request_data.resolved_iban()
    channel_link = request_data.resolved_channel()
    legal_name = request_data.resolved_legal_name()
    extracted_key = extract_public_api_key(yml_link) if yml_link else None
    catalog_type = SupplierType.mydrop if (
        (yml_link and "mydrop" in yml_link.lower()) or extracted_key
    ) else SupplierType.independent

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
        ai_score_report="Створено адміном (direct-create). AI-скоринг заявки не потрібен.",
    )
    db.add(new_supplier)
    await db.flush()
    await _ensure_shop_record(db, new_supplier)
    await db.commit()
    await db.refresh(new_supplier)

    import_started = bool(yml_link or extracted_key)
    if import_started:
        schedule_supplier_catalog_import(new_supplier.id)

    logger.info(
        "Адмін створив магазин #%s (%s), import_started=%s",
        new_supplier.id, store_name, import_started,
    )
    return _to_application(new_supplier, import_started=import_started)


@router.post("/suppliers/{supplier_id}/approve", response_model=PendingSupplierApplicationResponse)
async def approve_supplier_application(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    _assert_admin(telegram_id, authorization)

    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Заявку не знайдено")

    supplier.is_verified = True
    supplier.status = SupplierStatus.active
    extracted_key = extract_public_api_key(supplier.yml_link or supplier.xml_url or "")
    if extracted_key and not supplier.mydrop_api_key:
        supplier.mydrop_api_key = extracted_key
    if supplier.user_id:
        user = await db.get(User, supplier.user_id)
        if user and user.role != UserRole.admin:
            user.role = UserRole.supplier
    await _ensure_shop_record(db, supplier)
    await db.commit()
    await db.refresh(supplier)

    has_feed = bool(supplier.yml_link or supplier.xml_url or supplier.mydrop_api_key)
    if has_feed:
        schedule_supplier_catalog_import(supplier.id)

    logger.info(
        "Адмін схвалив заявку #%s, import_started=%s",
        supplier_id, has_feed,
    )
    return _to_application(supplier, import_started=has_feed)


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
