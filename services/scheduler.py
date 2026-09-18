# services/scheduler.py
"""CRON: регулярне оновлення XML/MyDrop-каталогів схвалених магазинів."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import delete as sa_delete, or_, select, update

from database.db import AsyncSessionLocal
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
    SupplierHistoryLog,
    SupplierStatus,
    product_variant_option_values,
    supplier_channels,
)
from services.mydrop_sync import import_supplier_catalog_and_process_ai
from services.supabase_storage import delete_product_pictures_from_supabase

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler(timezone="Europe/Kiev")
_sync_lock = asyncio.Lock()
XML_SYNC_JOB_ID = "sync_all_xml_suppliers"
PURGE_JOB_ID = "purge_deleted_stores_cron"
PURGE_AFTER_DAYS = 30
DELETION_NOTE_PREFIX = "[ЗАЯВКА НА ВИДАЛЕННЯ]"


def _source_type_value(supplier: Supplier) -> str:
    raw = getattr(supplier, "source_type", None)
    return (str(raw or "xml")).strip().lower() or "xml"


async def sync_all_xml_suppliers() -> None:
    """
    Усі схвалені XML-магазини (у БД статус active = approved у адмінці).
    Для кожного викликає імпорт з Upsert: нові → pending, існуючі оновлюються.
    """
    if _sync_lock.locked():
        logger.warning("XML-sync уже виконується — цей запуск пропущено.")
        return

    async with _sync_lock:
        if AsyncSessionLocal is None:
            logger.error("XML-sync: AsyncSessionLocal не ініціалізовано.")
            return

        supplier_ids: list[int] = []
        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    select(Supplier).where(
                        Supplier.status == SupplierStatus.active,
                        or_(
                            Supplier.source_type == "xml",
                            Supplier.source_type.is_(None),
                            Supplier.source_type == "",
                        ),
                    )
                )
            ).scalars().all()
            supplier_ids = [row.id for row in rows if _source_type_value(row) == "xml"]

        if not supplier_ids:
            logger.info("XML-sync: немає схвалених XML-магазинів для оновлення.")
            return

        totals = {
            "shops": 0,
            "created": 0,
            "updated": 0,
            "inactivated": 0,
            "errors": 0,
        }
        logger.info("XML-sync: старт, магазинів=%s.", len(supplier_ids))

        for supplier_id in supplier_ids:
            try:
                result = await import_supplier_catalog_and_process_ai(supplier_id)
                totals["shops"] += 1
                totals["created"] += int(result.get("created") or 0)
                totals["updated"] += int(result.get("updated") or 0)
                totals["inactivated"] += int(result.get("inactivated") or 0)
                totals["errors"] += int(result.get("errors") or 0)
                logger.info(
                    "XML-sync #%s: created=%s updated=%s inactivated=%s errors=%s",
                    supplier_id,
                    result.get("created", 0),
                    result.get("updated", 0),
                    result.get("inactivated", 0),
                    result.get("errors", 0),
                )
            except Exception as e:
                totals["errors"] += 1
                logger.error(
                    "XML-sync: збій магазину #%s: %s",
                    supplier_id, e, exc_info=True,
                )

        logger.info(
            "XML-sync завершено: shops=%s created=%s updated=%s inactivated=%s errors=%s",
            totals["shops"], totals["created"], totals["updated"],
            totals["inactivated"], totals["errors"],
        )


def _as_naive_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _supplier_source_link(supplier: Supplier) -> str:
    source_type = str(getattr(supplier, "source_type", None) or "xml").strip().lower()
    telegram_link = (
        getattr(supplier, "telegram_channel_link", None)
        or supplier.channel_link
        or supplier.telegram_channel
        or ""
    )
    xml_link = supplier.yml_link or supplier.xml_url or supplier.shop_url or ""
    if source_type == "telegram":
        return str(telegram_link or xml_link).strip()
    return str(xml_link or telegram_link).strip()


def _supplier_deletion_reason(supplier: Supplier) -> str:
    notes = supplier.admin_notes or ""
    if DELETION_NOTE_PREFIX in notes:
        after = notes.split(DELETION_NOTE_PREFIX, 1)[1].strip()
        extracted = after.split("\n\n", 1)[0].strip()
        if extracted:
            return extracted[:512]
    status = supplier.status.value if hasattr(supplier.status, "value") else str(supplier.status)
    return status or "deleted"


async def _detach_orders_and_services(db, supplier_id: int, product_ids: list[int], variant_ids: list[int]) -> None:
    """Замовлення лишаються: відв'язуємо FK, щоб можна було стерти магазин і товари."""
    if product_ids:
        await db.execute(
            update(OrderItem)
            .where(OrderItem.product_id.in_(product_ids))
            .values(product_id=None, variant_id=None)
        )
        await db.execute(
            update(PaidService)
            .where(PaidService.product_id.in_(product_ids))
            .values(product_id=None)
        )
    if variant_ids:
        await db.execute(
            update(OrderItem)
            .where(OrderItem.variant_id.in_(variant_ids))
            .values(variant_id=None)
        )
    await db.execute(
        update(OrderItem)
        .where(OrderItem.supplier_id == supplier_id)
        .values(supplier_id=None)
    )
    await db.execute(
        update(Order)
        .where(Order.supplier_id == supplier_id)
        .values(supplier_id=None)
    )
    await db.execute(sa_delete(PaidService).where(PaidService.supplier_id == supplier_id))
    await db.execute(sa_delete(PriceRule).where(PriceRule.supplier_id == supplier_id))
    await db.execute(
        sa_delete(supplier_channels).where(supplier_channels.c.supplier_id == supplier_id)
    )


async def _delete_supplier_products(db, supplier_id: int) -> int:
    product_ids = [
        int(row[0])
        for row in (await db.execute(select(Product.id).where(Product.supplier_id == supplier_id))).all()
    ]
    if not product_ids:
        await _detach_orders_and_services(db, supplier_id, [], [])
        return 0

    pictures_rows = (
        await db.execute(select(Product.pictures).where(Product.id.in_(product_ids)))
    ).all()
    for row in pictures_rows:
        try:
            delete_product_pictures_from_supabase(row[0])
        except Exception as e:
            logger.warning("Purge #%s: картинки Supabase не видалено: %s", supplier_id, e)

    variant_ids = [
        int(row[0])
        for row in (
            await db.execute(select(ProductVariant.id).where(ProductVariant.product_id.in_(product_ids)))
        ).all()
    ]
    option_ids = [
        int(row[0])
        for row in (
            await db.execute(select(ProductOption.id).where(ProductOption.product_id.in_(product_ids)))
        ).all()
    ]

    await _detach_orders_and_services(db, supplier_id, product_ids, variant_ids)

    if variant_ids:
        await db.execute(
            sa_delete(product_variant_option_values).where(
                product_variant_option_values.c.variant_id.in_(variant_ids)
            )
        )
        await db.execute(sa_delete(ProductVariant).where(ProductVariant.id.in_(variant_ids)))
    if option_ids:
        await db.execute(
            sa_delete(ProductOptionValue).where(ProductOptionValue.option_id.in_(option_ids))
        )
        await db.execute(sa_delete(ProductOption).where(ProductOption.id.in_(option_ids)))
    await db.execute(sa_delete(Product).where(Product.id.in_(product_ids)))
    return len(product_ids)


async def _purge_one_supplier(db, supplier: Supplier) -> None:
    sid = int(supplier.id)
    history = SupplierHistoryLog(
        original_supplier_id=sid,
        supplier_name=(supplier.store_name or supplier.name or f"Магазин #{sid}")[:255],
        source_link=_supplier_source_link(supplier) or None,
        deleted_at=supplier.deleted_at or datetime.now(timezone.utc),
        reason=_supplier_deletion_reason(supplier),
    )
    db.add(history)
    await db.flush()

    products_removed = await _delete_supplier_products(db, sid)
    await db.delete(supplier)
    await db.commit()
    logger.info(
        "Purge: фізично видалено магазин #%s (%s), товарів=%s.",
        sid,
        history.supplier_name,
        products_removed,
    )


async def purge_deleted_stores_cron() -> None:
    """
    Через 30 днів після запиту на видалення:
    запис у SupplierHistoryLog → стирання картинок/товарів/магазину.
    Замовлення клієнтів не чіпаємо (FK обнуляються).
    """
    if AsyncSessionLocal is None:
        logger.error("Purge: AsyncSessionLocal не ініціалізовано.")
        return

    cutoff = _as_naive_utc(datetime.now(timezone.utc)) - timedelta(days=PURGE_AFTER_DAYS)
    purged = 0
    skipped = 0

    async with AsyncSessionLocal() as db:
        rows = (
            (
                await db.execute(
                    select(Supplier).where(
                        Supplier.status.in_(
                            (SupplierStatus.deleted, SupplierStatus.deletion_requested)
                        )
                    )
                )
            )
            .scalars()
            .all()
        )
        stale_ids = []
        for supplier in rows:
            stamp = _as_naive_utc(supplier.deleted_at)
            if stamp is None or stamp > cutoff:
                continue
            stale_ids.append(int(supplier.id))

        logger.info("Purge: кандидатів старше %s днів: %s.", PURGE_AFTER_DAYS, len(stale_ids))

        for supplier_id in stale_ids:
            try:
                supplier = await db.get(Supplier, supplier_id)
                if supplier is None:
                    continue
                status = (
                    supplier.status.value
                    if hasattr(supplier.status, "value")
                    else str(supplier.status)
                )
                if status not in (
                    SupplierStatus.deleted.value,
                    SupplierStatus.deletion_requested.value,
                ):
                    continue
                await _purge_one_supplier(db, supplier)
                purged += 1
            except Exception as e:
                skipped += 1
                logger.error("Purge: збій магазину #%s: %s", supplier_id, e, exc_info=True)
                await db.rollback()

    logger.info("Purge завершено: видалено=%s, помилок=%s.", purged, skipped)


def start_scheduler() -> None:
    """Запускає AsyncIOScheduler з XML-синхронізацією кожні 4 години."""
    if _scheduler.get_job(XML_SYNC_JOB_ID) is None:
        _scheduler.add_job(
            sync_all_xml_suppliers,
            "interval",
            hours=4,
            id=XML_SYNC_JOB_ID,
            replace_existing=True,
            misfire_grace_time=3600,
            coalesce=True,
            max_instances=1,
        )
    if _scheduler.get_job(PURGE_JOB_ID) is None:
        _scheduler.add_job(
            purge_deleted_stores_cron,
            "cron",
            hour=3,
            minute=0,
            id=PURGE_JOB_ID,
            replace_existing=True,
            misfire_grace_time=3600,
            coalesce=True,
            max_instances=1,
        )
    if not _scheduler.running:
        _scheduler.start()
        logger.info(
            "XML-планувальник запущено: sync кожні 4 години, purge о 03:00."
        )
    else:
        logger.info("XML-планувальник уже працює.")


def stop_scheduler() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("XML-планувальник зупинено.")
