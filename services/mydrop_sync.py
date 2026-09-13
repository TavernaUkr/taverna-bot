# services/mydrop_sync.py
"""
"Smart Sync" — розкладання JSON-каталогу постачальника (MyDrop REST API)
у наші SQLAlchemy моделі: Product, ProductVariant, ProductOption,
ProductOptionValue.

Тут НЕМАЄ AI-логіки (дублі/категорії тощо) — лише чисте, стійке до помилок
підключення до API + запис у БД. AI-аналіз буде окремим кроком пізніше.
"""
import logging
import re
from collections import defaultdict
from typing import Any, Dict, List, Set, Tuple

from sqlalchemy import select, delete, insert
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from database.models import (
    Product, ProductVariant, ProductOption, ProductOptionValue,
    product_variant_option_values, ProductStatus,
)
from services.mydrop_api import MyDropAPIClient, MyDropAPIError
# Перевикористовуємо вже наявну (production) логіку націнки з PriceRule,
# щоб товари з API і товари зі старого XML рахувались за ОДНАКОВИМИ
# правилами. services/product_service.py не залежить від джерела даних
# (XML чи MyDrop JSON) — це чистий DB-read/pricing модуль.
from services.product_service import calculate_final_price

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
    supplier_id: int, api_key: str, db_session: AsyncSession
) -> Dict[str, int]:
    """
    Синхронізує весь каталог постачальника з MyDrop REST API у нашу БД.

    1. Тягне JSON через MyDropAPIClient.get_products(api_key).
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

    Повертає статистику: {"products": N, "variants": M, "errors": K}.
    Не кидає виняток назовні при мережевих помилках MyDrop — повертає
    нульову статистику і пише детальний лог (щоб фонова синхронізація
    одного постачальника не зносила весь job).
    """
    stats = {"products": 0, "variants": 0, "errors": 0}

    # --- Крок 1: Отримання даних з MyDrop (мережа) ---
    client = MyDropAPIClient()
    try:
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

    # --- Крок 2-3: Запис у БД (товар за товаром, стійко до помилок) ---
    for raw_product in products:
        try:
            if not isinstance(raw_product, dict):
                stats["errors"] += 1
                continue

            sku = str(raw_product.get("sku") or raw_product.get("id") or "").strip()
            title = str(raw_product.get("title") or "").strip()
            if not sku or not title:
                logger.warning(
                    "sync_supplier_products: товар без sku/title пропущено (supplier #%s, id=%s).",
                    supplier_id, raw_product.get("id"),
                )
                stats["errors"] += 1
                continue

            description = str(raw_product.get("description") or "")
            images = raw_product.get("images") or []
            pictures = [
                img.get("url") for img in images
                if isinstance(img, dict) and img.get("url")
            ][:5]
            category_id = raw_product.get("category_id")
            category_tag = str(category_id) if category_id is not None else None
            drop_price = raw_product.get("drop_price")

            # --- Product upsert (за supplier_id + supplier_sku, як в XML-парсері) ---
            product_stmt = (
                pg_insert(Product)
                .values(
                    supplier_id=supplier_id,
                    supplier_sku=sku,
                    name=title,
                    description=description,
                    pictures=pictures,
                    category=category_tag,
                    status=ProductStatus.active,
                )
                .on_conflict_do_update(
                    index_elements=["supplier_id", "supplier_sku"],
                    set_={
                        "name": title,
                        "description": description,
                        "pictures": pictures,
                        "category": category_tag,
                        "updated_at": func.now(),
                    },
                )
                .returning(Product.id)
            )
            product_id = (await db_session.execute(product_stmt)).scalar_one()
            stats["products"] += 1

            # --- Збір опцій (Розмір/Колір/інше) з усіх sizes + product-level params ---
            sizes = raw_product.get("sizes") or []
            if not sizes:
                # Товар без варіацій розміру (sizes_available == False) —
                # створюємо ОДИН "порожній" розмір, щоб мати рівно 1 варіант.
                sizes = [{"id": None, "title": None, "amount": raw_product.get("amount", 0)}]

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
                offer_id = (
                    f"mydrop_{supplier_id}_{sku}_{size_id}" if size_id is not None
                    else f"mydrop_{supplier_id}_{sku}"
                )

                base_price_raw = size.get("drop_price", drop_price)
                try:
                    base_price = float(base_price_raw or 0)
                except (TypeError, ValueError):
                    base_price = 0.0

                final_price = await calculate_final_price(str(base_price), category_tag, supplier_id)

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

        except Exception as e:
            stats["errors"] += 1
            logger.error(
                "sync_supplier_products: помилка обробки товару (supplier #%s, raw_id=%s): %s",
                supplier_id, raw_product.get("id") if isinstance(raw_product, dict) else "?", e,
                exc_info=True,
            )
            continue

    # --- Крок 5: Commit (одна транзакція на весь каталог постачальника) ---
    try:
        await db_session.commit()
        logger.info(
            "sync_supplier_products: постачальник #%s синхронізовано. products=%s, variants=%s, errors=%s",
            supplier_id, stats["products"], stats["variants"], stats["errors"],
        )
    except SQLAlchemyError as e:
        await db_session.rollback()
        logger.error(
            "sync_supplier_products: помилка commit БД (supplier #%s): %s", supplier_id, e, exc_info=True,
        )
        stats["errors"] += 1

    return stats
