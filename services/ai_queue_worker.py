# services/ai_queue_worker.py
"""
Контрольована черга Gemini: 1 товар / 15 секунд (~4 на хвилину).
Строго по даті реєстрації постачальника: спочатку один магазин, потім наступний.
Якщо найстаріший ще парсить XML — чекаємо, наступних не чіпаємо.
Без asyncio.gather. 429/503 → знову pending.
"""
import asyncio
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


def _pending_exists_clause():
    return (
        select(Product.id)
        .where(
            Product.supplier_id == Supplier.id,
            *_PENDING_PRODUCT,
        )
        .correlate(Supplier)
        .exists()
    )


async def fetch_strict_supplier_queue(db) -> List[Dict[str, Any]]:
    """
    Черга магазинів за queue_joined_at ASC (відновлені — в кінці).
    У черзі: status=parsing АБО є pending-товари.
    """
    stmt = (
        select(Supplier)
        .where(
            Supplier.status.notin_(BLOCKED_SUPPLIER_STATUSES),
            or_(
                Supplier.status == SupplierStatus.parsing,
                _pending_exists_clause(),
            ),
        )
        .order_by(Supplier.queue_joined_at.asc().nulls_last(), Supplier.id.asc())
    )
    suppliers = (await db.execute(stmt)).scalars().all()
    if not suppliers:
        return []

    supplier_ids = [int(row.id) for row in suppliers]
    count_rows = (
        await db.execute(
            select(Product.supplier_id, func.count(Product.id))
            .where(
                Product.supplier_id.in_(supplier_ids),
                *_PENDING_PRODUCT,
            )
            .group_by(Product.supplier_id)
        )
    ).all()
    pending_map = {int(sid): int(cnt or 0) for sid, cnt in count_rows}

    return [
        {
            "supplier_id": int(row.id),
            "pending_count": pending_map.get(int(row.id), 0),
            "registered_at": getattr(row, "queue_joined_at", None) or row.created_at,
            "queue_joined_at": getattr(row, "queue_joined_at", None) or row.created_at,
            "is_parsing": _enum_str(row.status) == SupplierStatus.parsing.value,
            "shop_name": _shop_name_of(row),
        }
        for row in suppliers
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
    """True: магазин зараз парсить каталог і товарів у базі ще немає."""
    if supplier is None:
        return False
    if _enum_str(supplier.status) != SupplierStatus.parsing.value:
        return False
    return int(total or 0) == 0


async def build_ai_queue_view(db) -> List[Dict[str, Any]]:
    """
    Глобальна черга магазинів за queue_joined_at ASC.
    У списку всі parsing АБО з pending-товарами. Відновлені — в кінці.
    queue_position = реальне місце: 0 активний, далі 1, 2, 3...
    """
    queue = await fetch_strict_supplier_queue(db)
    if not queue:
        return []

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

    display_rows: List[Dict[str, Any]] = []
    for row in queue:
        sid = int(row["supplier_id"])
        supplier = supplier_map.get(sid)
        total = total_map.get(sid, 0)
        display_rows.append(
            {
                "supplier_id": sid,
                "shop_name": _shop_name_of(supplier) if supplier else str(row.get("shop_name") or f"Магазин #{sid}"),
                "pending_count": int(row["pending_count"] or 0),
                "processed": processed_map.get(sid, 0),
                "total": total,
                "created_at": getattr(supplier, "created_at", None) if supplier else row.get("registered_at"),
                "queue_joined_at": (
                    getattr(supplier, "queue_joined_at", None) if supplier else None
                ) or row.get("queue_joined_at") or row.get("registered_at"),
                "is_fetching_xml": is_fetching_xml(supplier, total) or bool(row.get("is_parsing") and int(row["pending_count"] or 0) == 0),
            }
        )

    display_rows.sort(
        key=lambda row: _created_sort_key(
            row.get("queue_joined_at") or row.get("created_at"),
            row["supplier_id"],
        ),
    )

    result: List[Dict[str, Any]] = []
    items_ahead = 0
    for index, row in enumerate(display_rows):
        pending = int(row["pending_count"] or 0)
        fetching = bool(row.get("is_fetching_xml")) and index == 0
        if index == 0:
            status = "fetching_xml" if fetching else "processing"
            is_processing = not fetching
        else:
            status = "waiting"
            is_processing = False
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
                "queue_joined_at": row.get("queue_joined_at"),
                "is_processing": is_processing,
                "is_fetching_xml": fetching if index == 0 else False,
                "status": status,
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

    wait_for_xml = False
    wait_supplier_id = 0
    product = None
    product_id = None

    async with AsyncSessionLocal() as db:
        try:
            await _reclaim_stale_processing(db)

            queue = await fetch_strict_supplier_queue(db)
            if not queue:
                return
            head = queue[0]
            active_supplier_id = int(head["supplier_id"])
            pending_count = int(head.get("pending_count") or 0)
            is_parsing = bool(head.get("is_parsing"))

            if is_parsing and pending_count <= 0:
                wait_for_xml = True
                wait_supplier_id = active_supplier_id
            elif pending_count > 0:
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

                if product:
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
                        "AI-черга: магазин #%s, товар #%s (строга черга за датою реєстрації).",
                        product.supplier_id,
                        product_id,
                    )
        except Exception as e:
            logger.error("AI-черга: не вдалося взяти pending-товар: %s", e, exc_info=True)
            await db.rollback()
            return

    if wait_for_xml:
        logger.info(
            "AI-черга: магазин #%s парсить XML, pending ще немає — чекаємо, наступних не чіпаємо.",
            wait_supplier_id,
        )
        await asyncio.sleep(AI_QUEUE_INTERVAL_SECONDS)
        return

    if product is None or product_id is None:
        return

    async with AsyncSessionLocal() as db:
        try:
            product = await db.get(Product, product_id)
            if product is None:
                return
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
