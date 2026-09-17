# services/telegram_sync.py
"""Harvester: імпорт товарів з Telegram-каналу постачальника в AI-чергу."""
import asyncio
import logging
import re
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import AsyncSessionLocal
from database.models import (
    Product,
    ProductAIStatus,
    ProductStatus,
    ProductVariant,
    Supplier,
    SupplierStatus,
)
from services.product_service import calculate_final_price
from services.telegram_parser import (
    TelegramChannelParseError,
    get_recent_channel_posts,
    parse_telegram_posts_to_products,
)

logger = logging.getLogger(__name__)

_PRICE_RE = re.compile(r"[^\d.,]")


def _parse_price(raw: Any) -> float:
    if isinstance(raw, (int, float)):
        value = float(raw)
        return value if value >= 0 else 0.0
    cleaned = _PRICE_RE.sub("", str(raw or "")).replace(" ", "").replace(",", ".")
    if cleaned.count(".") > 1:
        parts = cleaned.split(".")
        cleaned = "".join(parts[:-1]) + "." + parts[-1]
    try:
        value = float(cleaned) if cleaned else 0.0
        return value if value >= 0 else 0.0
    except ValueError:
        return 0.0


def _channel_link(supplier: Supplier) -> str:
    return (
        (getattr(supplier, "telegram_channel_link", None) or "")
        or (getattr(supplier, "channel_link", None) or "")
        or (getattr(supplier, "telegram_channel", None) or "")
    ).strip()


def live_message_sku(supplier_id: int, message_id: int, index: int = 1) -> str:
    if index <= 1:
        return f"tg-{supplier_id}-msg-{message_id}"
    return f"tg-{supplier_id}-msg-{message_id}-{index}"


def _source_url_for_message(
    username: Optional[str],
    chat_id: Optional[int],
    message_id: int,
) -> str:
    if username:
        return f"https://t.me/{str(username).lstrip('@')}/{message_id}"
    if chat_id:
        return f"tg://channel/{chat_id}/{message_id}"
    return f"tg://message/{message_id}"


async def _find_live_product(
    db: AsyncSession,
    supplier_id: int,
    sku: str,
    message_id: int,
    source_url: str,
) -> Optional[Product]:
    by_sku = (
        await db.execute(
            select(Product).where(
                Product.supplier_id == supplier_id,
                Product.supplier_sku == sku,
            )
        )
    ).scalar_one_or_none()
    if by_sku:
        return by_sku

    rows = (
        await db.execute(
            select(Product).where(Product.supplier_id == supplier_id)
        )
    ).scalars().all()
    needle = str(message_id)
    for product in rows:
        attrs = product.attributes if isinstance(product.attributes, dict) else {}
        if str(attrs.get("telegram_message_id") or "") == needle:
            return product
        url = str(attrs.get("source_url") or "")
        if needle and (url.endswith(f"/{needle}") or (source_url and url == source_url)):
            return product
    return None


async def upsert_parsed_telegram_items(
    db: AsyncSession,
    *,
    supplier_id: int,
    parsed_items: list[dict],
    message_id: int,
    source_url: str,
    is_edit: bool = False,
) -> int:
    """
    Новий пост → Product ai_status=pending (черга AI).
    Редагування → оновлює description і ціну варіанту, ai_status не чіпає.
    У products немає колонки price: ціна в ProductVariant.
    """
    saved = 0
    for index, item in enumerate(parsed_items, start=1):
        name = str(item.get("name") or "").strip()[:512]
        if not name:
            continue
        description = str(item.get("description") or "").strip() or None
        base_price = _parse_price(item.get("price"))
        try:
            final_price = await calculate_final_price(
                str(base_price),
                supplier_id=supplier_id,
                db=db,
            )
        except Exception as e:
            logger.warning("upsert_parsed_telegram_items: націнка %s: %s", name, e)
            final_price = int(round(base_price)) if base_price else 0
        if final_price <= 0 and base_price > 0:
            final_price = max(1, int(round(base_price)))

        sku = live_message_sku(supplier_id, message_id, index)
        gemini_vendor = str(item.get("vendor_code") or "").strip()
        attrs = {
            "source": "telegram",
            "source_url": source_url,
            "telegram_message_id": message_id,
            "vendor_code": gemini_vendor or sku,
        }
        existing = await _find_live_product(db, supplier_id, sku, message_id, source_url)
        try:
            if existing:
                existing.description = description
                if not existing.is_ai_processed:
                    existing.name = name
                attrs_old = existing.attributes if isinstance(existing.attributes, dict) else {}
                attrs_old.update(attrs)
                existing.attributes = attrs_old
                variant = (
                    await db.execute(
                        select(ProductVariant).where(ProductVariant.product_id == existing.id)
                    )
                ).scalars().first()
                if variant:
                    variant.base_price = base_price
                    variant.final_price = final_price
                else:
                    db.add(
                        ProductVariant(
                            product_id=existing.id,
                            supplier_offer_id=sku,
                            base_price=base_price,
                            final_price=final_price,
                            quantity=1,
                            is_available=False,
                        )
                    )
                await db.commit()
                saved += 1
                continue

            if is_edit:
                logger.info(
                    "upsert_parsed_telegram_items: товар для msg %s не знайдено — створюю новий.",
                    message_id,
                )
            product = Product(
                supplier_id=supplier_id,
                supplier_sku=sku,
                name=name,
                description=description,
                pictures=[],
                attributes=attrs,
                ai_status=ProductAIStatus.pending,
                status=ProductStatus.inactive,
                is_ai_processed=False,
            )
            db.add(product)
            await db.flush()
            db.add(
                ProductVariant(
                    product_id=product.id,
                    supplier_offer_id=sku,
                    base_price=base_price,
                    final_price=final_price,
                    quantity=1,
                    is_available=False,
                )
            )
            await db.commit()
            saved += 1
        except Exception as e:
            await db.rollback()
            logger.error(
                "upsert_parsed_telegram_items: не збережено %s (supplier #%s, msg %s): %s",
                sku, supplier_id, message_id, e, exc_info=True,
            )
    return saved


async def run_telegram_import(supplier_id: int, db: AsyncSession) -> int:
    """
    Читає 20 постів каналу → Gemini → Product зі статусом inactive
    і ai_status=pending (потрапляють в існуючу AI-чергу).

    У таблиці products немає колонок price / vendor_code / source_url:
    ціна → ProductVariant, артикул → supplier_sku, лінк каналу → attributes.source_url.
    Помилки Telethon/Gemini логуються, бекенд не падає.
    """
    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        logger.error("run_telegram_import: постачальника #%s не знайдено.", supplier_id)
        return 0

    status_value = supplier.status.value if hasattr(supplier.status, "value") else str(supplier.status)
    if status_value in (
        SupplierStatus.deletion_requested.value,
        SupplierStatus.deleted.value,
        SupplierStatus.banned.value,
    ):
        logger.warning(
            "run_telegram_import: пропущено #%s (статус=%s).",
            supplier_id, status_value,
        )
        return 0

    channel_link = _channel_link(supplier)
    if not channel_link:
        logger.error(
            "run_telegram_import: у постачальника #%s немає telegram_channel_link.",
            supplier_id,
        )
        return 0

    try:
        posts_text = await get_recent_channel_posts(channel_link, limit=20)
    except TelegramChannelParseError as e:
        logger.error("run_telegram_import: канал #%s (%s): %s", supplier_id, channel_link, e)
        return 0
    except Exception as e:
        logger.error(
            "run_telegram_import: збій Telethon #%s (%s): %s",
            supplier_id, channel_link, e, exc_info=True,
        )
        return 0

    try:
        parsed_products = await parse_telegram_posts_to_products(posts_text)
    except Exception as e:
        logger.error(
            "run_telegram_import: Gemini не розпарсив пости #%s: %s",
            supplier_id, e, exc_info=True,
        )
        return 0

    if not parsed_products:
        logger.warning(
            "run_telegram_import: для #%s Gemini не знайшов товарів у каналі %s.",
            supplier_id, channel_link,
        )
        return 0

    existing_map = {
        str(row.supplier_sku): row
        for row in (
            await db.execute(
                select(Product).where(Product.supplier_id == supplier_id)
            )
        ).scalars().all()
        if row.supplier_sku
    }

    created = 0
    updated = 0
    for index, item in enumerate(parsed_products, start=1):
        sku = f"tg-{supplier_id}-{index}"
        name = str(item.get("name") or "").strip()[:512]
        if not name:
            continue
        description = str(item.get("description") or "").strip() or None
        base_price = _parse_price(item.get("price"))
        try:
            final_price = await calculate_final_price(
                str(base_price),
                supplier_id=supplier_id,
                db=db,
            )
        except Exception as e:
            logger.warning("run_telegram_import: націнка для %s: %s", sku, e)
            final_price = int(round(base_price)) if base_price else 0
        if final_price <= 0 and base_price > 0:
            final_price = max(1, int(round(base_price)))

        existing = existing_map.get(sku)
        if existing:
            try:
                existing.description = description
                if not existing.is_ai_processed:
                    existing.name = name
                variant = (
                    await db.execute(
                        select(ProductVariant).where(ProductVariant.product_id == existing.id)
                    )
                ).scalars().first()
                if variant:
                    variant.base_price = base_price
                    variant.final_price = final_price
                await db.commit()
                updated += 1
            except Exception as e:
                await db.rollback()
                logger.error(
                    "run_telegram_import: не оновлено товар %s для #%s: %s",
                    sku, supplier_id, e, exc_info=True,
                )
            continue

        gemini_vendor = str(item.get("vendor_code") or "").strip()
        product = Product(
            supplier_id=supplier_id,
            supplier_sku=sku,
            name=name,
            description=description,
            pictures=[],
            attributes={
                "source": "telegram",
                "source_url": channel_link,
                "vendor_code": gemini_vendor or sku,
            },
            ai_status=ProductAIStatus.pending,
            status=ProductStatus.inactive,
            is_ai_processed=False,
        )
        try:
            db.add(product)
            await db.flush()
            db.add(
                ProductVariant(
                    product_id=product.id,
                    supplier_offer_id=sku,
                    base_price=base_price,
                    final_price=final_price,
                    quantity=1,
                    is_available=False,
                )
            )
            await db.commit()
            existing_map[sku] = product
            created += 1
        except Exception as e:
            await db.rollback()
            logger.error(
                "run_telegram_import: не збережено товар %s для #%s: %s",
                sku, supplier_id, e, exc_info=True,
            )

    logger.info(
        "run_telegram_import: постачальник #%s, канал %s, created=%s updated=%s.",
        supplier_id, channel_link, created, updated,
    )
    return created


async def run_telegram_import_job(supplier_id: int) -> None:
    """Фон: власна сесія БД (request-сесія після відповіді вже закрита)."""
    try:
        async with AsyncSessionLocal() as db:
            await run_telegram_import(supplier_id, db)
    except Exception as e:
        logger.error(
            "Фоновий Telegram-імпорт постачальника #%s впав: %s",
            supplier_id, e, exc_info=True,
        )


def schedule_telegram_import(supplier_id: int) -> None:
    """Неблокуючий запуск Harvester (той самий прийом, що XML-імпорт)."""
    task = asyncio.create_task(run_telegram_import_job(supplier_id))

    def _log_task_result(done):
        try:
            exc = done.exception()
        except asyncio.CancelledError:
            return
        if exc:
            logger.error(
                "Фоновий Telegram-імпорт постачальника #%s впав: %s",
                supplier_id, exc, exc_info=exc,
            )

    task.add_done_callback(_log_task_result)
