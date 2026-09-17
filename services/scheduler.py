# services/scheduler.py
"""CRON: регулярне оновлення XML/MyDrop-каталогів схвалених магазинів."""
import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import or_, select

from database.db import AsyncSessionLocal
from database.models import Supplier, SupplierStatus
from services.mydrop_sync import import_supplier_catalog_and_process_ai

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler(timezone="Europe/Kiev")
_sync_lock = asyncio.Lock()
XML_SYNC_JOB_ID = "sync_all_xml_suppliers"


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
    if not _scheduler.running:
        _scheduler.start()
        logger.info("XML-планувальник запущено: sync_all_xml_suppliers кожні 4 години.")
    else:
        logger.info("XML-планувальник уже працює.")


def stop_scheduler() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("XML-планувальник зупинено.")
