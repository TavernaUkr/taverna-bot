# services/telegram_sync.py
"""Harvester: імпорт товарів з Telegram-каналу постачальника в AI-чергу."""
import asyncio
import logging
import re
from typing import Any, Optional

from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import AsyncSessionLocal
from database.models import (
    Product,
    ProductAIStatus,
    ProductOption,
    ProductOptionValue,
    ProductStatus,
    ProductVariant,
    Supplier,
    SupplierStatus,
)
from services.product_service import calculate_final_price
from services.telegram_parser import (
    AlbumStitchContext,
    TelegramChannelParseError,
    fetch_channel_posts_page,
    parse_telegram_posts_to_products,
    _normalize_characteristics,
    _normalize_search_tags,
    hydrate_posts_media,
)

logger = logging.getLogger(__name__)

_PRICE_RE = re.compile(r"[^\d.,]")
_REPLY_PRICE_RE = re.compile(
    r"(?:ціна|price)\s*[:\-–]?\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:грн|uah)\b",
    re.IGNORECASE,
)
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


async def _find_product_by_vendor_or_name(
    db: AsyncSession,
    supplier_id: int,
    *,
    vendor_code: str,
    name: str,
) -> Optional[Product]:
    """Той самий товар: supplier_id + (артикул АБО точна назва)."""
    vendor = (vendor_code or "").strip()
    title = (name or "").strip()
    filters = []
    if vendor:
        vendor_json = Product.attributes["vendor_code"].as_string()
        filters.append(Product.supplier_sku == vendor)
        filters.append(func.lower(vendor_json) == vendor.casefold())
    if title:
        filters.append(func.lower(Product.name) == title.casefold())
    if not filters:
        return None
    stmt = (
        select(Product)
        .where(
            Product.supplier_id == supplier_id,
            Product.status.notin_((ProductStatus.deleted, ProductStatus.archived)),
            or_(*filters),
        )
        .order_by(Product.id.asc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalars().first()


_ATTR_META_KEYS = {
    "source",
    "source_url",
    "telegram_message_id",
    "vendor_code",
    "sizes",
    "media_urls",
    "characteristics",
    "search_tags",
    "base_model_name",
    "color",
}


def _product_attributes_from_item(
    item: dict,
    *,
    source_url: str,
    message_id: int,
    vendor_code: str,
) -> dict:
    pairs = _normalize_characteristics(
        item.get("characteristics")
        if item.get("characteristics") is not None
        else item.get("attributes")
    )
    attrs = {
        "source": "telegram",
        "source_url": source_url,
        "telegram_message_id": message_id,
        "vendor_code": vendor_code,
        "characteristics": pairs,
    }
    model_name = str(item.get("base_model_name") or "").strip()[:200]
    if model_name:
        attrs["base_model_name"] = model_name
    shade = str(item.get("color") or "").strip()[:80]
    if not shade:
        for pair in pairs:
            name = str(pair.get("name") or "").strip().casefold()
            if name in {"колір", "цвет", "color", "забарвлення"}:
                shade = str(pair.get("value") or "").strip()[:80]
                if shade:
                    break
    if shade:
        attrs["color"] = shade
    if not model_name:
        title = str(item.get("name") or "").strip()
        if title and shade and title.casefold().endswith(shade.casefold()):
            title = title[: len(title) - len(shade)].rstrip(" -,/()")
        if title:
            attrs["base_model_name"] = title[:200]
    tags = _normalize_search_tags(item.get("search_tags"))
    if tags:
        attrs["search_tags"] = tags
    for pair in pairs:
        name = str(pair.get("name") or "").strip()
        text = str(pair.get("value") or "").strip()
        if not name or not text or name.lower() in _ATTR_META_KEYS:
            continue
        attrs[name] = text
    sizes = item.get("sizes") if isinstance(item.get("sizes"), list) else []
    clean_sizes = [str(size).strip() for size in sizes if str(size).strip()]
    if clean_sizes:
        attrs["sizes"] = clean_sizes
    return attrs


async def _upsert_size_option(db: AsyncSession, product_id: int, sizes: list[str]) -> None:
    """Розміри Telegram-товару → ProductOption «Розмір» + ProductOptionValue."""
    values = []
    seen = set()
    for raw in sizes or []:
        value = str(raw or "").strip()[:100]
        if not value:
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        values.append(value)
    if not values:
        return

    option = (
        await db.execute(
            select(ProductOption).where(
                ProductOption.product_id == product_id,
                ProductOption.name == "Розмір",
            )
        )
    ).scalar_one_or_none()
    if option is None:
        option = ProductOption(product_id=product_id, name="Розмір")
        db.add(option)
        await db.flush()

    existing_rows = (
        await db.execute(
            select(ProductOptionValue).where(ProductOptionValue.option_id == option.id)
        )
    ).scalars().all()
    existing = {str(row.value).casefold() for row in existing_rows}
    for value in values:
        if value.casefold() in existing:
            continue
        db.add(ProductOptionValue(option_id=option.id, value=value))
        existing.add(value.casefold())


def _merge_picture_urls(existing, extra: list[str]) -> list[str]:
    merged: list[str] = []
    for raw in list(existing or []) + list(extra or []):
        url = str(raw or "").strip()
        if url.startswith("http") and url not in merged:
            merged.append(url)
    return merged


async def attach_telegram_album_media(
    db: AsyncSession,
    *,
    supplier_id: int,
    attachments: list,
) -> int:
    """Додає фото альбому в pictures / attributes.media_urls уже існуючого товару."""
    updated = 0
    for parent_message_id, urls in attachments or []:
        clean_urls = [str(url).strip() for url in (urls or []) if str(url).strip().startswith("http")]
        if not parent_message_id or not clean_urls:
            continue
        sku = live_message_sku(supplier_id, int(parent_message_id), 1)
        source_url = _source_url_for_message(None, None, int(parent_message_id))
        product = await _find_live_product(
            db, supplier_id, sku, int(parent_message_id), source_url
        )
        if product is None:
            logger.info(
                "attach_telegram_album_media: товар для поста #%s ще немає — фото відкладено.",
                parent_message_id,
            )
            continue
        product.pictures = _merge_picture_urls(product.pictures, clean_urls)
        attrs = product.attributes if isinstance(product.attributes, dict) else {}
        attrs["media_urls"] = _merge_picture_urls(attrs.get("media_urls"), product.pictures)
        product.attributes = attrs
        updated += 1
    if updated:
        await db.commit()
        logger.info(
            "attach_telegram_album_media: оновлено %s товар(ів) постачальника #%s.",
            updated, supplier_id,
        )
    return updated


def _reply_price_from_text(text: str) -> float:
    """Ціна з відповіді лише якщо явно вказана (ціна / грн) — не з розмірів."""
    match = _REPLY_PRICE_RE.search(text or "")
    if not match:
        return 0.0
    raw = match.group(1) or match.group(2) or ""
    return _parse_price(raw)


async def _apply_reply_to_existing_product(
    db: AsyncSession,
    *,
    product: Product,
    post: dict,
    supplier_id: int,
) -> None:
    """Дописує медіа відповіді в існуючий товар; за наявності — опис і ціну."""
    urls = post.get("image_urls") if isinstance(post.get("image_urls"), list) else []
    if urls:
        product.pictures = _merge_picture_urls(product.pictures, urls)
        attrs = product.attributes if isinstance(product.attributes, dict) else {}
        attrs["media_urls"] = _merge_picture_urls(attrs.get("media_urls"), product.pictures)
        product.attributes = attrs

    text = str(post.get("text") or "").strip()
    if len(text) >= 10:
        product.description = text[:4000]

    base_price = _reply_price_from_text(text)
    if base_price > 0:
        try:
            final_price = await calculate_final_price(
                str(base_price),
                supplier_id=supplier_id,
                db=db,
            )
        except Exception as e:
            logger.warning(
                "apply_telegram_reply_updates: націнка для товару #%s: %s",
                product.id, e,
            )
            final_price = max(1, int(round(base_price)))
        if final_price <= 0:
            final_price = max(1, int(round(base_price)))
        variant = (
            await db.execute(
                select(ProductVariant).where(ProductVariant.product_id == product.id)
            )
        ).scalars().first()
        if variant:
            variant.base_price = base_price
            variant.final_price = final_price


async def apply_telegram_reply_updates(
    db: AsyncSession,
    *,
    supplier_id: int,
    posts: list[dict],
) -> list[dict]:
    """
    Відповідь (Reply) на старий пост = оновлення існуючого товару,
    а не новий лот. Шукає supplier_sku == tg-{reply_to_msg_id}.

    Повертає пости, які треба обробляти як нові (без reply або батька немає).
    Знайдені відповіді в Gemini не йдуть.
    """
    remaining: list[dict] = []
    updated = 0
    for post in posts or []:
        reply_to = int(post.get("reply_to_msg_id") or 0)
        if not reply_to:
            remaining.append(post)
            continue
        sku = live_message_sku(supplier_id, reply_to, 1)
        source_url = _source_url_for_message(
            post.get("username"),
            post.get("chat_id"),
            reply_to,
        )
        parent = await _find_live_product(db, supplier_id, sku, reply_to, source_url)
        status = getattr(parent, "status", None) if parent is not None else None
        if parent is None or status in (ProductStatus.deleted, ProductStatus.archived):
            remaining.append(post)
            continue
        await _apply_reply_to_existing_product(
            db, product=parent, post=post, supplier_id=supplier_id,
        )
        updated += 1
        logger.info(
            "telegram_sync: reply поста #%s додано до товару sku=tg-%s (id=%s), фото=%s.",
            post.get("message_id"), reply_to, parent.id,
            len(post.get("image_urls") or []),
        )
    if updated:
        await db.commit()
    return remaining


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
        attrs = _product_attributes_from_item(
            item,
            source_url=source_url,
            message_id=message_id,
            vendor_code=gemini_vendor or sku,
        )
        if pictures:
            attrs["media_urls"] = pictures
        sizes = item.get("sizes") if isinstance(item.get("sizes"), list) else []
        niche = str(item.get("niche") or "").strip()[:100] or None
        season = str(item.get("season") or "").strip()[:50] or None
        existing = await _find_live_product(db, supplier_id, sku, message_id, source_url)
        if existing is None:
            existing = await _find_product_by_vendor_or_name(
                db,
                supplier_id,
                vendor_code=gemini_vendor,
                name=name,
            )
        try:
            if existing:
                existing.description = description
                if not existing.is_ai_processed:
                    existing.name = name
                    if niche:
                        existing.target_niche = niche
                    if season:
                        existing.season = season
                if pictures:
                    existing.pictures = _merge_picture_urls(existing.pictures, pictures)
                attrs_old = existing.attributes if isinstance(existing.attributes, dict) else {}
                merged_media = _merge_picture_urls(
                    attrs_old.get("media_urls"),
                    existing.pictures if isinstance(existing.pictures, list) else pictures,
                )
                if merged_media:
                    attrs["media_urls"] = merged_media
                old_pairs = attrs_old.get("characteristics")
                if not attrs.get("characteristics") and isinstance(old_pairs, list) and old_pairs:
                    attrs["characteristics"] = old_pairs
                    for pair in old_pairs:
                        if not isinstance(pair, dict):
                            continue
                        key = str(pair.get("name") or "").strip()
                        val = str(pair.get("value") or "").strip()
                        if key and val and key.lower() not in _ATTR_META_KEYS and key not in attrs:
                            attrs[key] = val
                if not attrs.get("base_model_name") and attrs_old.get("base_model_name"):
                    attrs["base_model_name"] = attrs_old.get("base_model_name")
                if not attrs.get("color") and attrs_old.get("color"):
                    attrs["color"] = attrs_old.get("color")
                existing.attributes = attrs
                variant = (
                    await db.execute(
                        select(ProductVariant).where(ProductVariant.product_id == existing.id)
                    )
                ).scalars().first()
                if variant:
                    variant.base_price = base_price
                    variant.final_price = final_price
                    blob = f"{name} {description or ''}".lower()
                    if any(mark in blob for mark in ("немає в наявності", "продано", "sold out")):
                        variant.quantity = 0
                        variant.is_available = False
                    else:
                        variant.quantity = max(int(variant.quantity or 0), 1)
                        variant.is_available = True
                else:
                    db.add(
                        ProductVariant(
                            product_id=existing.id,
                            supplier_offer_id=sku,
                            base_price=base_price,
                            final_price=final_price,
                            quantity=1,
                            is_available=True if is_edit else False,
                        )
                    )
                await _upsert_size_option(db, existing.id, sizes)
                await db.commit()
                saved += 1
                logger.info(
                    "upsert_parsed_telegram_items: оновлено товар #%s (артикул/назва), нові фото в кінець.",
                    existing.id,
                )
                continue

            if is_edit:
                logger.info(
                    "upsert_parsed_telegram_items: редагування поста #%s — товар не знайдено, новий НЕ створюємо.",
                    message_id,
                )
                continue
            product = Product(
                supplier_id=supplier_id,
                supplier_sku=sku,
                name=name,
                description=description,
                pictures=pictures,
                attributes=attrs,
                target_niche=niche,
                season=season,
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
            await _upsert_size_option(db, product.id, sizes)
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
    batch = list(batch or [])
    replies = [post for post in batch if int(post.get("reply_to_msg_id") or 0)]
    regular = [post for post in batch if not int(post.get("reply_to_msg_id") or 0)]
    reply_ids = {int(post["message_id"]) for post in replies if post.get("message_id")}

    def _items_for(posts: list[dict]) -> list[dict]:
        known = {int(post["message_id"]) for post in posts if post.get("message_id")}
        picked: list[dict] = []
        for item in parsed_items or []:
            mid = _coerce_message_id(item.get("telegram_message_id") or item.get("message_id"))
            if mid and mid in reply_ids and mid not in known:
                continue
            if mid and known and mid not in known:
                continue
            picked.append(item)
        return picked if posts else []

    saved = 0
    if regular:
        saved += await _upsert_assigned_batch(
            db,
            supplier_id=supplier_id,
            batch=regular,
            parsed_items=_items_for(regular),
        )

    leftover_replies = await apply_telegram_reply_updates(
        db, supplier_id=supplier_id, posts=replies,
    )
    if leftover_replies:
        saved += await _upsert_assigned_batch(
            db,
            supplier_id=supplier_id,
            batch=leftover_replies,
            parsed_items=_items_for(leftover_replies),
        )
    return saved


async def _upsert_assigned_batch(
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
        post_urls = meta.get("image_urls") if isinstance(meta.get("image_urls"), list) else []
        if post_urls:
            for item in items:
                item["image_urls"] = _merge_picture_urls(item.get("image_urls"), post_urls)
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
    stitch_ctx = AlbumStitchContext()
    try:
        while scanned < IMPORT_POST_LIMIT:
            take = min(IMPORT_BATCH_SIZE, IMPORT_POST_LIMIT - scanned)
            try:
                posts, next_offset, fetched, done = await fetch_channel_posts_page(
                    channel_link,
                    limit=take,
                    offset_id=offset_id,
                    upload_media=False,
                    supplier_name=getattr(supplier, "name", "") or "",
                    supplier_id=int(supplier.id),
                    stitch_ctx=stitch_ctx,
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
            leftover_media = stitch_ctx.take_attachments()
            if leftover_media:
                await attach_telegram_album_media(
                    db,
                    supplier_id=supplier_id,
                    attachments=leftover_media,
                )
            if fetched <= 0:
                if done:
                    import_ok = True
                    break
                await asyncio.sleep(IMPORT_BATCH_SLEEP_SEC)
                continue

            if posts:
                posts = await apply_telegram_reply_updates(
                    db, supplier_id=supplier_id, posts=posts,
                )
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
                album_ids = stitch_ctx.take_album_ids()
                keep_ids = {
                    int(message_id)
                    for message_id, _item in _assign_batch_message_ids(parsed_products, posts)
                } if parsed_products else set()
                orphan_extras: dict[int, list[int]] = {}
                for parent_id, extra_id in album_ids:
                    parent = int(parent_id)
                    extra = int(extra_id)
                    if parent in keep_ids:
                        for post in posts:
                            if int(post.get("message_id") or 0) == parent:
                                post.setdefault("album_message_ids", []).append(extra)
                                break
                    else:
                        orphan_extras.setdefault(parent, []).append(extra)
                if parsed_products:
                    try:
                        await hydrate_posts_media(
                            channel_link,
                            posts,
                            keep_ids,
                            supplier_name=getattr(supplier, "name", "") or "",
                            supplier_id=int(supplier.id),
                        )
                    except Exception as e:
                        logger.warning(
                            "run_telegram_import: не вдалося довантажити фото батча %s: %s",
                            batch_index, e,
                        )
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
                if orphan_extras:
                    fake_posts = [
                        {
                            "message_id": parent_id,
                            "album_message_ids": extra_ids,
                            "image_urls": [],
                            "formatted": "",
                        }
                        for parent_id, extra_ids in orphan_extras.items()
                    ]
                    try:
                        await hydrate_posts_media(
                            channel_link,
                            fake_posts,
                            set(orphan_extras.keys()),
                            supplier_name=getattr(supplier, "name", "") or "",
                            supplier_id=int(supplier.id),
                        )
                        await attach_telegram_album_media(
                            db,
                            supplier_id=supplier_id,
                            attachments=[
                                (post["message_id"], post.get("image_urls") or [])
                                for post in fake_posts
                            ],
                        )
                    except Exception as e:
                        logger.warning(
                            "run_telegram_import: альбомні фото попереднього товару не додано: %s",
                            e,
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
