# services/ai_queue_worker.py
"""
Контрольована черга Gemini: 1 товар / 15 секунд (~4 на хвилину).
Без asyncio.gather. 429/503 → знову pending.
"""
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import or_, select, update

from database.db import AsyncSessionLocal, engine, ensure_product_ai_status_column
from database.models import Product, ProductAIStatus
from services.ai_processor import GeminiCapacityError, ProductAIProcessor

logger = logging.getLogger(__name__)

AI_QUEUE_INTERVAL_SECONDS = 15
STALE_PROCESSING_MINUTES = 10
JOB_ID = "ai_product_queue_job"

_scheduler = AsyncIOScheduler(timezone="Europe/Kiev")
_processor: ProductAIProcessor | None = None


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
        logger.warning("AI-черга: GEMINI_API_KEY немає — крок пропущено.")
        return

    async with AsyncSessionLocal() as db:
        try:
            await _reclaim_stale_processing(db)

            stmt = (
                select(Product)
                .where(Product.ai_status == ProductAIStatus.pending)
                .order_by(Product.id.asc())
                .limit(1)
            )
            if engine is not None and engine.dialect.name == "postgresql":
                stmt = stmt.with_for_update(skip_locked=True)
            product = (await db.execute(stmt)).scalars().first()

            if not product:
                return

            product_id = product.id
            product.ai_status = ProductAIStatus.processing
            await db.commit()
            await db.refresh(product)
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
