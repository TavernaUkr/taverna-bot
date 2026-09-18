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
    fetch_channel_posts_page,
    parse_telegram_posts_to_products,
)

logger = logging.getLogger(__name__)

_PRICE_RE = re.compile(r"[^\d.,]")
IMPORT_POST_LIMIT = 300
IMPORT_BATCH_SIZE = 10
IMPORT_BATCH_SLEEP_SEC = 4


def _item_pictures(item: dict) -> list[str]:
    raw = item.get("image_urls") if isinstance(item, dict) else None
    urls: list[str] = []
    if isinstance(raw, str):
        value = raw.strip()
        if value.startswith("http"):
            urls.append(value)
        return urls
    if isinstance(raw, list):
        for item_url in raw:
            value = str(item_url or "").strip()
            if value.startswith("http") and value not in urls:
                urls.append(value)
    return urls


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
        return f"tg-{message_id}"
    return f"tg-{message_id}-{index}"


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
        sku = str(product.supplier_sku or "")
        if sku in (f"tg-{message_id}", f"tg-{supplier_id}-msg-{message_id}"):
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
        pictures = _item_pictures(item)
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
                if pictures:
                    existing.pictures = pictures
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
                pictures=pictures,
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


def _status_value(supplier: Supplier) -> str:
    status = getattr(supplier, "status", None)
    return status.value if hasattr(status, "value") else str(status or "")


async def _set_supplier_import_status(db: AsyncSession, supplier: Supplier, status: SupplierStatus) -> None:
    supplier.status = status
    try:
        await db.commit()
        await db.refresh(supplier)
    except Exception as e:
        await db.rollback()
        logger.error(
            "run_telegram_import: не вдалося поставити статус %s для #%s: %s",
            status, supplier.id, e, exc_info=True,
        )


def _coerce_message_id(raw: Any) -> Optional[int]:
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw if raw > 0 else None
    text = str(raw).strip()
    if text.isdigit():
        value = int(text)
        return value if value > 0 else None
    match = re.search(r"(\d{1,12})", text)
    if not match:
        return None
    value = int(match.group(1))
    return value if value > 0 else None


def _assign_batch_message_ids(items: list[dict], batch: list[dict]) -> list[tuple[int, dict]]:
    known_ids = [int(post["message_id"]) for post in batch if post.get("message_id")]
    known_set = set(known_ids)
    assigned: list[tuple[int, dict]] = []
    leftover: list[dict] = []
    used: set[int] = set()

    for item in items:
        mid = _coerce_message_id(item.get("telegram_message_id") or item.get("message_id"))
        if mid in known_set:
            used.add(mid)
            assigned.append((mid, item))
            continue
        name = str(item.get("name") or "").strip().lower()
        matched = None
        if name:
            for post in batch:
                blob = f"{post.get('text') or ''} {post.get('formatted') or ''}".lower()
                if name and name in blob:
                    matched = int(post["message_id"])
                    break
        if matched:
            used.add(matched)
            assigned.append((matched, item))
        else:
            leftover.append(item)

    unused = [mid for mid in known_ids if mid not in used]
    for item, mid in zip(leftover, unused):
        assigned.append((mid, item))
    extra = leftover[len(unused):]
    fallback = known_ids[-1] if known_ids else None
    for item in extra:
        if fallback:
            assigned.append((fallback, item))
    return assigned


async def _save_batch_products(
    db: AsyncSession,
    *,
    supplier_id: int,
    batch: list[dict],
    parsed_items: list[dict],
) -> int:
    grouped: dict[int, list[dict]] = {}
    for message_id, item in _assign_batch_message_ids(parsed_items, batch):
        grouped.setdefault(message_id, []).append(item)

    meta_by_id = {int(post["message_id"]): post for post in batch if post.get("message_id")}
    saved = 0
    for message_id, items in grouped.items():
        meta = meta_by_id.get(message_id) or {}
        source_url = _source_url_for_message(
            meta.get("username"),
            meta.get("chat_id"),
            message_id,
        )
        saved += await upsert_parsed_telegram_items(
            db,
            supplier_id=supplier_id,
            parsed_items=items,
            message_id=message_id,
            source_url=source_url,
            is_edit=False,
        )
    return saved


async def run_telegram_import(supplier_id: int, db: AsyncSession) -> int:
    """
    Первинний імпорт каналу: до 300 постів, батчі по 10, пауза 4 с між Gemini.
    Upsert за supplier_sku = tg-{message_id}.
    Під час роботи status=parsing, після успіху — active.
    """
    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        logger.error("run_telegram_import: постачальника #%s не знайдено.", supplier_id)
        return 0

    status_value = _status_value(supplier)
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

    await _set_supplier_import_status(db, supplier, SupplierStatus.parsing)
    logger.info(
        "run_telegram_import: #%s статус=parsing, канал %s, ліміт %s постів.",
        supplier_id, channel_link, IMPORT_POST_LIMIT,
    )

    offset_id = 0
    scanned = 0
    total_saved = 0
    batch_index = 0
    import_ok = False
    try:
        while scanned < IMPORT_POST_LIMIT:
            take = min(IMPORT_BATCH_SIZE, IMPORT_POST_LIMIT - scanned)
            try:
                posts, next_offset, fetched, done = await fetch_channel_posts_page(
                    channel_link,
                    limit=take,
                    offset_id=offset_id,
                    upload_media=True,
                )
            except TelegramChannelParseError as e:
                logger.error("run_telegram_import: канал #%s (%s): %s", supplier_id, channel_link, e)
                break
            except Exception as e:
                logger.error(
                    "run_telegram_import: збій Telethon #%s (%s): %s",
                    supplier_id, channel_link, e, exc_info=True,
                )
                break

            scanned += int(fetched or 0)
            if fetched <= 0:
                if done:
                    import_ok = True
                    break
                await asyncio.sleep(IMPORT_BATCH_SLEEP_SEC)
                continue

            if posts:
                batch_index += 1
                blob = "\n\n".join(
                    f"{i}. {post['formatted']}" for i, post in enumerate(posts, 1)
                )
                logger.info(
                    "run_telegram_import: #%s батч %s, постів %s, прочитано %s/%s.",
                    supplier_id, batch_index, len(posts), scanned, IMPORT_POST_LIMIT,
                )
                try:
                    parsed_products = await parse_telegram_posts_to_products(blob)
                except Exception as e:
                    logger.error(
                        "run_telegram_import: Gemini батч %s для #%s: %s",
                        batch_index, supplier_id, e, exc_info=True,
                    )
                    parsed_products = []
                if parsed_products:
                    saved = await _save_batch_products(
                        db,
                        supplier_id=supplier_id,
                        batch=posts,
                        parsed_items=parsed_products,
                    )
                    total_saved += saved
                else:
                    logger.info(
                        "run_telegram_import: #%s батч %s без товарів — далі.",
                        supplier_id, batch_index,
                    )
                if not done and scanned < IMPORT_POST_LIMIT:
                    await asyncio.sleep(IMPORT_BATCH_SLEEP_SEC)

            if done:
                import_ok = True
                break
            if not next_offset or next_offset == offset_id:
                import_ok = True
                break
            offset_id = next_offset

        else:
            import_ok = True
    except Exception as e:
        logger.error(
            "run_telegram_import: імпорт #%s впав: %s",
            supplier_id, e, exc_info=True,
        )
        import_ok = False

    fresh = await db.get(Supplier, supplier_id)
    if fresh and _status_value(fresh) not in (
        SupplierStatus.deletion_requested.value,
        SupplierStatus.deleted.value,
        SupplierStatus.banned.value,
    ):
        await _set_supplier_import_status(db, fresh, SupplierStatus.active)
        if not import_ok:
            logger.warning(
                "run_telegram_import: #%s завершено з помилками, статус=active (товари з успішних батчів збережено).",
                supplier_id,
            )

    logger.info(
        "run_telegram_import: постачальник #%s, канал %s, scanned=%s saved=%s ok=%s.",
        supplier_id, channel_link, scanned, total_saved, import_ok,
    )
    return total_saved


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
