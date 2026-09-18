# services/mydrop_sync.py
"""
"Smart Sync" — розкладання каталогу постачальника (публічна YML/Prom-
вигрузка MyDrop, `MyDropAPIClient.get_products`) у наші SQLAlchemy моделі:
Product, ProductVariant, ProductOption, ProductOptionValue.

[13.09.2026] `MyDropAPIClient.get_products()` тепер читає ПУБЛІЧНУ
YML-вигрузку постачальника (`Supplier.mydrop_api_key` = публічний ключ
вигрузки, БЕЗ авторизації), а не приватний JSON-ендпоінт. Формат словників,
які повертає `get_products()`, залишився ТИМ САМИМ (product dict з
`sizes[]`) — тож увесь код нижче (групування опцій/варіантів) не змінився.

Тут НЕМАЄ внутрішньої AI-логіки — лише імпорт каталогу в БД.
Після імпорту нові товари віддаються в `services/ai_processor.py`
(`ProductAIProcessor.process_product`) без зміни його коду.
"""
import asyncio
import logging
import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy import literal, select, delete, insert, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from database.db import AsyncSessionLocal, ensure_product_ai_status_column
from database.models import (
    Product, ProductVariant, ProductOption, ProductOptionValue,
    product_variant_option_values, ProductStatus, ProductAIStatus, Supplier, SupplierStatus, SupplierType,
)
from services.mydrop_api import (
    InvalidMyDropYmlLinkError,
    extract_public_api_key,
    namespace_supplier_code,
    normalize_mydrop_yml_link,
)
# Перевикористовуємо вже наявну (production) логіку націнки з PriceRule,
# щоб товари з API і товари зі старого XML рахувались за ОДНАКОВИМИ
# правилами. services/product_service.py не залежить від джерела даних
# (XML чи MyDrop JSON) — це чистий DB-read/pricing модуль.
from services.product_service import _load_price_rules, calculate_final_price

logger = logging.getLogger(__name__)

_SIZE_RE = re.compile(r"розмір|размер|size", re.IGNORECASE)
_COLOR_RE = re.compile(r"колір|цвет|color", re.IGNORECASE)


def _canonical_option_name(raw_name: Any) -> str:
    """
    Нормалізує назву параметра від MyDrop у канонічну назву нашої опції.
    "розмір"/"размер"/"size"  -> "Розмір"
    "колір"/"цвет"/"color"    -> "Колір"
    інше                      -> залишаємо як прислав MyDrop (обрізане).
    """
    name = str(raw_name or "").strip()
    if not name:
        return ""
    if _SIZE_RE.search(name):
        return "Розмір"
    if _COLOR_RE.search(name):
        return "Колір"
    return name


def _extract_params(container: Dict[str, Any]) -> List[Tuple[str, str]]:
    """Дістає (назва, значення) з масиву `params` товару або розміру MyDrop."""
    result = []
    for param in (container.get("params") or []):
        if not isinstance(param, dict):
            continue
        name = _canonical_option_name(param.get("title") or param.get("name"))
        value = str(param.get("value") or "").strip()
        if name and value:
            result.append((name, value))
    return result


async def _get_or_create_options(
    session: AsyncSession, product_id: int, options_map: Dict[str, Set[str]]
) -> Dict[Tuple[str, str], int]:
    """
    Upsert ProductOption + ProductOptionValue (той самий підхід, що
    раніше використовувався в services/xml_parser.py для XML-товарів).
    """
    value_ids: Dict[Tuple[str, str], int] = {}
    for option_name, values in options_map.items():
        if not values:
            continue

        opt_stmt = (
            pg_insert(ProductOption)
            .values(product_id=product_id, name=option_name)
            .on_conflict_do_update(
                index_elements=["product_id", "name"], set_={"name": option_name}
            )
            .returning(ProductOption.id)
        )
        option_id = (await session.execute(opt_stmt)).scalar_one()

        for value in values:
            if not value:
                continue
            val_stmt = (
                pg_insert(ProductOptionValue)
                .values(option_id=option_id, value=value)
                .on_conflict_do_nothing(index_elements=["option_id", "value"])
                .returning(ProductOptionValue.id)
            )
            value_id = (await session.execute(val_stmt)).scalar_one_or_none()
            if not value_id:
                value_id = (
                    await session.execute(
                        select(ProductOptionValue.id).where(
                            (ProductOptionValue.option_id == option_id)
                            & (ProductOptionValue.value == value)
                        )
                    )
                ).scalar_one()
            value_ids[(option_name, value)] = value_id
    return value_ids


async def sync_supplier_products(
    supplier_id: int,
    api_key: str,
    db_session: AsyncSession,
    yml_url: Optional[str] = None,
) -> Dict[str, int]:
    """
    Синхронізує весь каталог постачальника з MyDrop REST API у нашу БД.

    1. Тягне каталог через MyDropAPIClient.get_products(api_key) — тепер це
       публічна YML-вигрузка постачальника (`api_key` = публічний ключ
       вигрузки з `Supplier.mydrop_api_key`, НЕ приватний X-API-KEY).
    2. Кожен товар з MyDrop уже сам містить свої варіації в `sizes[]`
       (на відміну від XML, де варіації доводилось групувати по
       group_id/vendorCode вручну) — тому товар -> Product одразу,
       без окремого кроку групування.
    3. Кожен `size` -> ProductVariant. Розмір (`size.title`) і будь-які
       характеристики (`params` товару чи розміру) класифікуються як
       опція "Розмір" / "Колір" / інша — за назвою параметра.
    4. Помилка в ОДНОМУ товарі не зупиняє синхронізацію решти каталогу
       (try/except навколо кожного товару) — це відповідає вимозі
       "стійкий до помилок" код.

    Повертає статистику: products / created / updated / inactivated / variants / errors.
    Існуючі товари оновлюються (ціна, опис, наявність), ai_status і категорії
    не чіпаємо. Нові — ai_status=pending.
    """
    stats = {
        "products": 0,
        "created": 0,
        "updated": 0,
        "inactivated": 0,
        "variants": 0,
        "errors": 0,
    }

    # --- Крок 1: Отримання даних з MyDrop / прямого YML (мережа) ---
    client = MyDropAPIClient()
    try:
        if yml_url:
            products = await client.get_products_from_yml_url(yml_url)
        else:
            products = await client.get_products(api_key)
    except MyDropAPIError as e:
        logger.error(
            "sync_supplier_products: не вдалося отримати каталог постачальника #%s з MyDrop: %s",
            supplier_id, e,
        )
        return stats
    except Exception as e:
        logger.error(
            "sync_supplier_products: неочікувана помилка виклику MyDrop API (supplier #%s): %s",
            supplier_id, e, exc_info=True,
        )
        return stats

    if not products:
        logger.info(
            "sync_supplier_products: постачальник #%s — MyDrop повернув порожній каталог "
            "(можливо, не увімкнена вигрузка товарів у кабінеті постачальника).",
            supplier_id,
        )
        return stats

    # Один SELECT правил цін у ЦІЙ ЖЕ сесії, ДО будь-якого запису.
    # Далі calculate_final_price бере правила з кешу (5 хв) — без
    # другого конекта і без 1149 зайвих SELECT у price_rules.
    await _load_price_rules(db_session)

    ns_prefix = f"sup{supplier_id}-"
    await db_session.execute(
        update(Product)
        .where(
            Product.supplier_id == supplier_id,
            ~Product.supplier_sku.startswith(ns_prefix),
        )
        .values(supplier_sku=literal(ns_prefix) + Product.supplier_sku)
    )

    # --- Крок 2-3: Запис у БД (СТРОГО послідовно, товар за товаром).
    # SQLite не вміє конкурентний запис — жодного asyncio.gather тут немає
    # і не повинно з'явитись. commit — пакетами по _COMMIT_EVERY товарів,
    # щоб не тримати write-lock на весь каталог і не смикати диск на кожному.
    _COMMIT_EVERY = 100
    pending_in_batch = 0
    seen_skus: Set[str] = set()

    for raw_product in products:
        try:
            if not isinstance(raw_product, dict):
                stats["errors"] += 1
                continue

            original_sku = str(raw_product.get("sku") or raw_product.get("id") or "").strip()
            original_id = str(raw_product.get("id") or "").strip()
            title = str(raw_product.get("title") or "").strip()
            if not original_sku or not title:
                logger.warning(
                    "sync_supplier_products: товар без sku/title пропущено (supplier #%s, id=%s).",
                    supplier_id, raw_product.get("id"),
                )
                stats["errors"] += 1
                continue

            sku = namespace_supplier_code(supplier_id, original_sku)

            description = str(raw_product.get("description") or "")
            images = raw_product.get("images") or []
            pictures = [
                img.get("url") for img in images
                if isinstance(img, dict) and img.get("url")
            ][:5]
            category_id = raw_product.get("category_id")
            category_tag = str(category_id) if category_id is not None else None
            drop_price = raw_product.get("drop_price")

            # --- Збір sizes до запису Product: від цього залежить active/inactive ---
            sizes = raw_product.get("sizes") or []
            if not sizes:
                sizes = [{"id": None, "title": None, "amount": raw_product.get("amount", 0)}]

            any_available = False
            for size in sizes:
                if not isinstance(size, dict):
                    continue
                try:
                    qty_probe = int(size.get("amount", 0) or 0)
                except (TypeError, ValueError):
                    qty_probe = 0
                if qty_probe > 0:
                    any_available = True
            product_status = ProductStatus.active if any_available else ProductStatus.inactive

            # Upsert за (supplier_id, supplier_sku): без дублікатів, без скидання AI.
            existing = (
                await db_session.execute(
                    select(Product).where(
                        Product.supplier_id == supplier_id,
                        Product.supplier_sku == sku,
                    )
                )
            ).scalar_one_or_none()

            if existing:
                existing.description = description
                existing.status = product_status
                existing.pictures = pictures
                if not existing.is_ai_processed:
                    existing.name = title
                await db_session.flush()
                product_id = existing.id
                stats["updated"] += 1
            else:
                new_product = Product(
                    supplier_id=supplier_id,
                    supplier_sku=sku,
                    name=title,
                    description=description,
                    pictures=pictures,
                    category=category_tag,
                    status=product_status,
                    ai_status=ProductAIStatus.pending,
                    is_ai_processed=False,
                )
                db_session.add(new_product)
                await db_session.flush()
                product_id = new_product.id
                stats["created"] += 1

            stats["products"] += 1
            seen_skus.add(sku)

            # --- Збір опцій (Розмір/Колір/інше) з усіх sizes + product-level params ---

            options_map: Dict[str, Set[str]] = defaultdict(set)
            product_level_params = _extract_params(raw_product)
            for p_name, p_value in product_level_params:
                options_map[p_name].add(p_value)

            for size in sizes:
                if not isinstance(size, dict):
                    continue
                if size.get("title"):
                    options_map["Розмір"].add(str(size["title"]).strip())
                for p_name, p_value in _extract_params(size):
                    options_map[p_name].add(p_value)

            value_ids_map = await _get_or_create_options(db_session, product_id, options_map)

            # --- Крок 4: Variants (один на кожен size) ---
            for size in sizes:
                if not isinstance(size, dict):
                    continue

                size_id = size.get("id")
                original_offer = (
                    str(size_id).strip() if size_id is not None and str(size_id).strip()
                    else (original_id or original_sku)
                )
                offer_id = namespace_supplier_code(supplier_id, original_offer)
                old_offer_id = (
                    f"mydrop_{supplier_id}_{original_sku}_{size_id}"
                    if size_id is not None
                    else f"mydrop_{supplier_id}_{original_sku}"
                )
                if old_offer_id != offer_id:
                    already = (
                        await db_session.execute(
                            select(ProductVariant.id).where(
                                ProductVariant.supplier_offer_id == offer_id
                            )
                        )
                    ).scalar_one_or_none()
                    if already is None:
                        await db_session.execute(
                            update(ProductVariant)
                            .where(ProductVariant.supplier_offer_id == old_offer_id)
                            .values(supplier_offer_id=offer_id)
                        )

                base_price_raw = size.get("drop_price", drop_price)
                try:
                    base_price = float(base_price_raw or 0)
                except (TypeError, ValueError):
                    base_price = 0.0

                final_price = await calculate_final_price(
                    str(base_price), category_tag, supplier_id, db=db_session
                )

                try:
                    qty = int(size.get("amount", 0) or 0)
                except (TypeError, ValueError):
                    qty = 0
                is_available = qty > 0

                variant_stmt = (
                    pg_insert(ProductVariant)
                    .values(
                        product_id=product_id,
                        supplier_offer_id=offer_id,
                        base_price=base_price,
                        final_price=final_price,
                        quantity=qty,
                        is_available=is_available,
                        last_updated=func.now(),
                    )
                    .on_conflict_do_update(
                        index_elements=["supplier_offer_id"],
                        set_={
                            "base_price": base_price,
                            "final_price": final_price,
                            "quantity": qty,
                            "is_available": is_available,
                            "last_updated": func.now(),
                        },
                    )
                    .returning(ProductVariant.id)
                )
                variant_id = (await db_session.execute(variant_stmt)).scalar_one()
                stats["variants"] += 1

                # --- Лінкуємо варіант з опціями (Розмір цього size + його params) ---
                value_ids_to_link = []
                if size.get("title"):
                    key = ("Розмір", str(size["title"]).strip())
                    if key in value_ids_map:
                        value_ids_to_link.append(value_ids_map[key])
                for p_name, p_value in _extract_params(size):
                    key = (p_name, p_value)
                    if key in value_ids_map:
                        value_ids_to_link.append(value_ids_map[key])
                for p_name, p_value in product_level_params:
                    key = (p_name, p_value)
                    if key in value_ids_map:
                        value_ids_to_link.append(value_ids_map[key])

                if value_ids_to_link:
                    await db_session.execute(
                        delete(product_variant_option_values).where(
                            product_variant_option_values.c.variant_id == variant_id
                        )
                    )
                    await db_session.execute(
                        insert(product_variant_option_values).values(
                            [
                                {"variant_id": variant_id, "option_value_id": vid}
                                for vid in set(value_ids_to_link)
                            ]
                        )
                    )

            pending_in_batch += 1
            if pending_in_batch >= _COMMIT_EVERY:
                await db_session.commit()
                logger.info(
                    "sync_supplier_products: проміжний commit (supplier #%s) — %s товарів записано.",
                    supplier_id, stats["products"],
                )
                pending_in_batch = 0

        except Exception as e:
            stats["errors"] += 1
            logger.error(
                "sync_supplier_products: помилка обробки товару (supplier #%s, raw_id=%s): %s",
                supplier_id, raw_product.get("id") if isinstance(raw_product, dict) else "?", e,
                exc_info=True,
            )
            continue

    if seen_skus:
        inactivated = await db_session.execute(
            update(Product)
            .where(
                Product.supplier_id == supplier_id,
                ~Product.supplier_sku.in_(list(seen_skus)),
                Product.status == ProductStatus.active,
            )
            .values(status=ProductStatus.inactive)
        )
        stats["inactivated"] = int(inactivated.rowcount or 0)

    # --- Крок 5: Фінальний commit хвоста пакета (менше 100 товарів) ---
    try:
        if pending_in_batch or stats["inactivated"]:
            await db_session.commit()
        logger.info(
            "sync_supplier_products: постачальник #%s. created=%s updated=%s inactivated=%s variants=%s errors=%s",
            supplier_id,
            stats["created"], stats["updated"], stats["inactivated"],
            stats["variants"], stats["errors"],
        )
    except SQLAlchemyError as e:
        await db_session.rollback()
        logger.error(
            "sync_supplier_products: помилка commit БД (supplier #%s): %s", supplier_id, e, exc_info=True,
        )
        stats["errors"] += 1

    return stats


def _resolve_catalog_source(supplier: Supplier) -> Tuple[str, Optional[str]]:
    """
    Повертає (api_key, yml_url).
    Пріоритет: yml_link / xml_url (лінка заявки), потім mydrop_api_key.
    """
    yml = (supplier.yml_link or supplier.xml_url or "").strip()
    stored_key = (supplier.mydrop_api_key or "").strip()
    extracted = extract_public_api_key(yml) if yml else None
    is_http = yml.lower().startswith(("http://", "https://"))

    if extracted:
        return extracted, None
    if is_http:
        return stored_key, yml
    if stored_key:
        return stored_key, None
    if yml:
        return yml, None
    return "", None


async def import_supplier_catalog_and_process_ai(supplier_id: int) -> Dict[str, int]:
    """
    Окрема сесія БД (request-сесія вже закрита):
    1) завантажити XML по yml_link / MyDrop-ключу;
    2) записати товари з supplier_id (ai_status=pending);
    3) Gemini обробляє їх окремою чергою по 1 товару / 15с.
    """
    result = {
        "products": 0,
        "created": 0,
        "updated": 0,
        "inactivated": 0,
        "variants": 0,
        "errors": 0,
        "ai_queued": 0,
    }
    if AsyncSessionLocal is None:
        logger.error("import_supplier_catalog: AsyncSessionLocal не ініціалізовано.")
        return result

    await ensure_product_ai_status_column()

    async with AsyncSessionLocal() as db:
        supplier = await db.get(Supplier, supplier_id)
        if not supplier:
            logger.error("import_supplier_catalog: постачальника #%s не знайдено.", supplier_id)
            return result

        status_value = supplier.status.value if hasattr(supplier.status, "value") else str(supplier.status)
        if status_value in (
            SupplierStatus.deletion_requested.value,
            SupplierStatus.deleted.value,
            SupplierStatus.banned.value,
        ):
            logger.warning(
                "import_supplier_catalog: пропущено #%s (статус=%s, Kill Switch).",
                supplier_id,
                status_value,
            )
            return result

        try:
            canonical_yml, extracted = normalize_mydrop_yml_link(
                supplier.yml_link or supplier.xml_url or supplier.mydrop_api_key or ""
            )
        except InvalidMyDropYmlLinkError:
            extracted = extract_public_api_key(supplier.yml_link or supplier.xml_url or "")
            canonical_yml = None
        if extracted:
            if canonical_yml:
                supplier.yml_link = canonical_yml
                supplier.xml_url = canonical_yml
            supplier.mydrop_api_key = extracted
            supplier.type = SupplierType.mydrop

        api_key, yml_url = _resolve_catalog_source(supplier)
        await db.commit()
        if not api_key and not yml_url:
            logger.warning(
                "import_supplier_catalog: у постачальника #%s немає yml_link / mydrop_api_key — імпорт пропущено.",
                supplier_id,
            )
            return result

        existing_count = int(
            (
                await db.execute(
                    select(func.count(Product.id)).where(
                        Product.supplier_id == supplier_id,
                        Product.status != ProductStatus.deleted,
                    )
                )
            ).scalar()
            or 0
        )
        first_xml_pull = existing_count == 0 or status_value == SupplierStatus.parsing.value
        if first_xml_pull:
            supplier.status = SupplierStatus.parsing
            await db.commit()
            logger.info("import_supplier_catalog: #%s статус=parsing, XML ще не в БД.", supplier_id)

        try:
            stats = await sync_supplier_products(
                supplier_id,
                api_key or "",
                db,
                yml_url=yml_url,
            )
            result.update(stats)

            queued = int(
                (
                    await db.execute(
                        select(func.count())
                        .select_from(Product)
                        .where(
                            Product.supplier_id == supplier_id,
                            Product.ai_status == ProductAIStatus.pending,
                        )
                    )
                ).scalar_one()
                or 0
            )
            result["ai_queued"] = queued
            logger.info(
                "Імпорт #%s: товари в AI-черзі (pending)=%s. Gemini обробить їх по 1 / 15с.",
                supplier_id, queued,
            )
            if first_xml_pull:
                fresh = await db.get(Supplier, supplier_id)
                if fresh is not None:
                    fresh_status = (
                        fresh.status.value if hasattr(fresh.status, "value") else str(fresh.status)
                    )
                    if fresh_status == SupplierStatus.parsing.value:
                        fresh.status = SupplierStatus.active
                        await db.commit()
                        logger.info(
                            "import_supplier_catalog: #%s parsing→active після збереження pending=%s.",
                            supplier_id, queued,
                        )
        except Exception:
            if first_xml_pull:
                logger.error(
                    "import_supplier_catalog: #%s XML не збережено — статус лишається parsing, AI чекає.",
                    supplier_id,
                    exc_info=True,
                )
            raise

    logger.info(
        "import_supplier_catalog #%s завершено: created=%s updated=%s inactivated=%s variants=%s errors=%s ai_queued=%s",
        supplier_id,
        result.get("created", 0), result.get("updated", 0), result.get("inactivated", 0),
        result["variants"], result["errors"],
        result.get("ai_queued", 0),
    )
    return result


def schedule_supplier_catalog_import(supplier_id: int) -> None:
    """Неблокуючий запуск імпорту XML + AI після схвалення / direct-create."""
    task = asyncio.create_task(import_supplier_catalog_and_process_ai(supplier_id))

    def _log_task_result(done):
        try:
            exc = done.exception()
        except asyncio.CancelledError:
            return
        if exc:
            logger.error(
                "Фоновий імпорт каталогу постачальника #%s впав: %s",
                supplier_id, exc, exc_info=exc,
            )

    task.add_done_callback(_log_task_result)
