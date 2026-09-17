# services/ai_queue_worker.py
"""
Контрольована черга Gemini: 1 товар / 15 секунд (~4 на хвилину).
Строго по постачальниках: спочатку один магазин, потім наступний.
Без asyncio.gather. 429/503 → знову pending.
"""
import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import func, or_, select, update

from database.db import AsyncSessionLocal, engine, ensure_product_ai_status_column
from database.models import Product, ProductAIStatus, ProductStatus, Supplier, SupplierStatus
from services.ai_processor import GeminiCapacityError, ProductAIProcessor

logger = logging.getLogger(__name__)

AI_QUEUE_INTERVAL_SECONDS = 15
STALE_PROCESSING_MINUTES = 10
JOB_ID = "ai_product_queue_job"

BLOCKED_SUPPLIER_STATUSES = (
    SupplierStatus.deletion_requested,
    SupplierStatus.deleted,
    SupplierStatus.banned,
)

_PENDING_PRODUCT = (
    Product.ai_status == ProductAIStatus.pending,
    Product.status != ProductStatus.deleted,
)

_scheduler = AsyncIOScheduler(timezone="Europe/Kiev")
_processor: ProductAIProcessor | None = None


def minutes_for_items(count: int) -> int:
    """((кількість товарів) * 15) / 60, хвилини вгору."""
    n = max(0, int(count or 0))
    if n <= 0:
        return 0
    return int(math.ceil(n * AI_QUEUE_INTERVAL_SECONDS / 60))


def estimate_queue_minutes(
    *,
    items_ahead: int,
    pending_items: int = 0,
    fetching_xml: bool = False,
) -> int:
    """((items_ahead + pending цього магазину) * 15) / 60. XML: pending=0."""
    return minutes_for_items(items_ahead + pending_items)


def _created_sort_key(value: Any, supplier_id: int) -> tuple:
    if value is None:
        return (1, "", int(supplier_id))
    if hasattr(value, "isoformat"):
        return (0, value.isoformat(), int(supplier_id))
    return (0, str(value), int(supplier_id))


async def fetch_strict_supplier_queue(db) -> List[Dict[str, Any]]:
    """
    Унікальні постачальники з pending-товарами.
    Хто раніше зареєстрував магазин (created_at) — той перший.
    """
    oldest = func.min(Product.created_at)
    pending_count = func.count(Product.id)
    stmt = (
        select(
            Product.supplier_id,
            oldest.label("oldest_pending"),
            pending_count.label("pending_count"),
            Supplier.created_at.label("registered_at"),
        )
        .join(Supplier, Supplier.id == Product.supplier_id)
        .where(
            *_PENDING_PRODUCT,
            Supplier.status.notin_(BLOCKED_SUPPLIER_STATUSES),
        )
        .group_by(Product.supplier_id, Supplier.created_at)
        .order_by(Supplier.created_at.asc(), Product.supplier_id.asc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "supplier_id": int(row.supplier_id),
            "oldest_pending": row.oldest_pending,
            "pending_count": int(row.pending_count or 0),
            "registered_at": row.registered_at,
        }
        for row in rows
    ]


def _shop_name_of(supplier: Supplier) -> str:
    return (supplier.store_name or supplier.name or "").strip() or f"Магазин #{supplier.id}"


def _enum_str(value: Any) -> str:
    if value is None:
        return ""
    return value.value if hasattr(value, "value") else str(value)


def _has_valid_yml(supplier: Supplier) -> bool:
    return bool((supplier.yml_link or supplier.xml_url or supplier.mydrop_api_key or "").strip())


def _supplier_is_approved(supplier: Supplier) -> bool:
    status = _enum_str(supplier.status)
    if status in (SupplierStatus.active.value, "approved", "active"):
        return True
    if getattr(supplier, "is_verified", False) and getattr(supplier, "approved_at", None):
        return True
    return False


def is_fetching_xml(supplier: Optional[Supplier], total: int) -> bool:
    """True: магазин схвалений, є YML, але товарів у базі ще немає (йде парсинг)."""
    if supplier is None:
        return False
    if int(total or 0) > 0:
        return False
    return _supplier_is_approved(supplier) and _has_valid_yml(supplier)


async def build_ai_queue_view(db) -> List[Dict[str, Any]]:
    """
    Глобальна черга магазинів за датою реєстрації (created_at).
    items_ahead = сума pending усіх магазинів, зареєстрованих раніше.
    queue_position = скільки магазинів у черзі перед цим.
    estimated_minutes = ((items_ahead + pending цього) * 15) / 60.
    """
    queue = await fetch_strict_supplier_queue(db)
    rows_by_id: Dict[int, Dict[str, Any]] = {}

    supplier_map: Dict[int, Supplier] = {}
    if queue:
        supplier_ids = [int(row["supplier_id"]) for row in queue]
        suppliers = (
            (await db.execute(select(Supplier).where(Supplier.id.in_(supplier_ids))))
            .scalars()
            .all()
        )
        supplier_map = {int(s.id): s for s in suppliers}

        totals = (
            await db.execute(
                select(Product.supplier_id, func.count(Product.id))
                .where(
                    Product.supplier_id.in_(supplier_ids),
                    Product.status != ProductStatus.deleted,
                    Product.ai_status != ProductAIStatus.cancelled,
                )
                .group_by(Product.supplier_id)
            )
        ).all()
        total_map = {int(sid): int(cnt) for sid, cnt in totals}

        processed_rows = (
            await db.execute(
                select(Product.supplier_id, func.count(Product.id))
                .where(
                    Product.supplier_id.in_(supplier_ids),
                    Product.status != ProductStatus.deleted,
                    Product.ai_status == ProductAIStatus.completed,
                )
                .group_by(Product.supplier_id)
            )
        ).all()
        processed_map = {int(sid): int(cnt) for sid, cnt in processed_rows}

        for row in queue:
            sid = int(row["supplier_id"])
            supplier = supplier_map.get(sid)
            total = total_map.get(sid, 0)
            rows_by_id[sid] = {
                "supplier_id": sid,
                "shop_name": _shop_name_of(supplier) if supplier else f"Магазин #{sid}",
                "pending_count": int(row["pending_count"]),
                "processed": processed_map.get(sid, 0),
                "total": total,
                "created_at": getattr(supplier, "created_at", None) if supplier else row.get("registered_at"),
                "oldest_pending": row.get("oldest_pending"),
                "is_fetching_xml": is_fetching_xml(supplier, total),
            }

    fetching_candidates = (
        (
            await db.execute(
                select(Supplier).where(Supplier.status.notin_(BLOCKED_SUPPLIER_STATUSES))
            )
        )
        .scalars()
        .all()
    )
    fetch_ids = [
        int(s.id)
        for s in fetching_candidates
        if int(s.id) not in rows_by_id and _supplier_is_approved(s) and _has_valid_yml(s)
    ]
    product_totals: Dict[int, int] = {}
    if fetch_ids:
        count_rows = (
            await db.execute(
                select(Product.supplier_id, func.count(Product.id))
                .where(
                    Product.supplier_id.in_(fetch_ids),
                    Product.status != ProductStatus.deleted,
                    Product.ai_status != ProductAIStatus.cancelled,
                )
                .group_by(Product.supplier_id)
            )
        ).all()
        product_totals = {int(sid): int(cnt) for sid, cnt in count_rows}

    for supplier in fetching_candidates:
        sid = int(supplier.id)
        if sid not in set(fetch_ids):
            continue
        if product_totals.get(sid, 0) != 0:
            continue
        rows_by_id[sid] = {
            "supplier_id": sid,
            "shop_name": _shop_name_of(supplier),
            "pending_count": 0,
            "processed": 0,
            "total": 0,
            "created_at": getattr(supplier, "created_at", None),
            "oldest_pending": None,
            "is_fetching_xml": True,
        }

    ordered = sorted(
        rows_by_id.values(),
        key=lambda row: _created_sort_key(row.get("created_at"), row["supplier_id"]),
    )
    pending_rows = [row for row in ordered if not row.get("is_fetching_xml")]
    fetching_rows = [row for row in ordered if row.get("is_fetching_xml")]
    display_rows = pending_rows + fetching_rows

    result: List[Dict[str, Any]] = []
    items_ahead = 0
    for index, row in enumerate(display_rows):
        pending = int(row["pending_count"] or 0)
        fetching = bool(row.get("is_fetching_xml"))
        estimated = estimate_queue_minutes(
            items_ahead=items_ahead,
            pending_items=0 if fetching else pending,
            fetching_xml=fetching,
        )
        result.append(
            {
                "supplier_id": int(row["supplier_id"]),
                "shop_name": str(row["shop_name"]),
                "pending_count": pending,
                "queue_position": index,
                "processed": int(row.get("processed") or 0),
                "total": int(row.get("total") or 0),
                "items_ahead": items_ahead,
                "estimated_minutes": estimated,
                "remaining_minutes": estimated,
                "wait_minutes": minutes_for_items(items_ahead),
                "created_at": row.get("created_at"),
                "oldest_pending": row.get("oldest_pending"),
                "is_processing": index == 0 and not fetching,
                "is_fetching_xml": fetching,
                "status": "fetching_xml" if fetching else ("processing" if index == 0 else "waiting"),
            }
        )
        items_ahead += pending
    return result


def _get_processor() -> ProductAIProcessor:
    global _processor
    if _processor is None:
        _processor = ProductAIProcessor()
    return _processor


async def _reclaim_stale_processing(db) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=STALE_PROCESSING_MINUTES)
    result = await db.execute(
        update(Product)
        .where(
            Product.ai_status == ProductAIStatus.processing,
            or_(Product.updated_at.is_(None), Product.updated_at < cutoff),
        )
        .values(ai_status=ProductAIStatus.pending)
    )
    if result.rowcount:
        await db.commit()
        logger.warning(
            "AI-черга: повернуто %s завислих processing → pending.",
            result.rowcount,
        )


async def process_next_pending_product() -> None:
    """Бере РІВНО один pending-товар, обробляє, комітить. Без паралелі."""
    if AsyncSessionLocal is None:
        return

    processor = _get_processor()
    if not processor.is_ready:
        logger.warning("AI-черга: GEMINI_API_KEYS немає — крок пропущено.")
        return

    async with AsyncSessionLocal() as db:
        try:
            await _reclaim_stale_processing(db)

            queue = await fetch_strict_supplier_queue(db)
            if not queue:
                return
            active_supplier_id = int(queue[0]["supplier_id"])

            stmt = (
                select(Product)
                .where(
                    Product.supplier_id == int(active_supplier_id),
                    *_PENDING_PRODUCT,
                )
                .order_by(Product.created_at.asc(), Product.id.asc())
                .limit(1)
            )
            if engine is not None and engine.dialect.name == "postgresql":
                stmt = stmt.with_for_update(skip_locked=True)
            product = (await db.execute(stmt)).scalars().first()

            if not product:
                return

            supplier = await db.get(Supplier, product.supplier_id)
            supplier_status = (
                supplier.status.value if supplier and hasattr(supplier.status, "value") else (
                    str(supplier.status) if supplier else ""
                )
            )
            if supplier_status in (
                SupplierStatus.deletion_requested.value,
                SupplierStatus.deleted.value,
                SupplierStatus.banned.value,
            ):
                product.ai_status = ProductAIStatus.cancelled
                await db.commit()
                logger.info(
                    "AI-черга: товар #%s cancelled (магазин #%s статус=%s).",
                    product.id,
                    product.supplier_id,
                    supplier_status,
                )
                return

            product_id = product.id
            product.ai_status = ProductAIStatus.processing
            await db.commit()
            await db.refresh(product)
            logger.info(
                "AI-черга: магазин #%s, товар #%s (строга черга).",
                product.supplier_id,
                product_id,
            )
        except Exception as e:
            logger.error("AI-черга: не вдалося взяти pending-товар: %s", e, exc_info=True)
            await db.rollback()
            return

        try:
            ok = await processor.process_product(product, db)
            if ok:
                product.ai_status = ProductAIStatus.completed
                product.is_ai_processed = True
                await db.commit()
                logger.info("AI-черга: товар #%s completed.", product_id)
                return

            product.ai_status = ProductAIStatus.failed
            await db.commit()
            logger.warning("AI-черга: товар #%s failed (невалідна відповідь Gemini).", product_id)
        except GeminiCapacityError as e:
            await db.rollback()
            await db.execute(
                update(Product)
                .where(Product.id == product_id)
                .values(ai_status=ProductAIStatus.pending)
            )
            await db.commit()
            logger.warning(
                "AI-черга: Gemini %s на товар #%s — повернуто в pending.",
                e.status, product_id,
            )
        except Exception as e:
            await db.rollback()
            await db.execute(
                update(Product)
                .where(Product.id == product_id)
                .values(ai_status=ProductAIStatus.failed)
            )
            await db.commit()
            logger.error("AI-черга: товар #%s failed: %s", product_id, e, exc_info=True)


async def start_ai_product_queue() -> None:
    """Запускає інтервал 15с. Повторний виклик у тому ж процесі — no-op."""
    await ensure_product_ai_status_column()
    if _scheduler.get_job(JOB_ID):
        return
    _scheduler.add_job(
        process_next_pending_product,
        "interval",
        seconds=AI_QUEUE_INTERVAL_SECONDS,
        id=JOB_ID,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=30,
    )
    if not _scheduler.running:
        _scheduler.start()
    logger.info(
        "AI-черга запущена: 1 товар / %sс (~4 на хвилину), без паралельних Gemini-запитів.",
        AI_QUEUE_INTERVAL_SECONDS,
    )
