# services/xml_parser.py
import logging
import xml.etree.ElementTree as ET
from decimal import Decimal, ROUND_UP, InvalidOperation
import aiohttp
import asyncio
import re
from typing import Dict, Any, List, Optional, Set, Tuple
from collections import defaultdict
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.sql import func, delete, insert, update # <-- Переконайся, що ВСЕ це імпортовано
from datetime import datetime, timedelta, timezone

from config_reader import config
from database.db import AsyncSessionLocal, AsyncSession 
from database.models import (
    Supplier, Product, ProductVariant, 
    ProductOption, ProductOptionValue, 
    product_variant_option_values,
    PriceRule, PriceRuleType,
    SupplierType, SupplierStatus
)

logger = logging.getLogger(__name__)
_scheduler = AsyncIOScheduler(timezone="Europe/Kiev")

# --- Глобальний Кеш для Правил Націнки ---
_price_rules_cache: List[PriceRule] = []
_rules_cache_updated_at = None

async def _load_price_rules() -> List[PriceRule]:
    global _price_rules_cache, _rules_cache_updated_at
    if _price_rules_cache and _rules_cache_updated_at and \
       (datetime.now(timezone.utc) - _rules_cache_updated_at < timedelta(minutes=1)):
        return _price_rules_cache
    async with AsyncSessionLocal() as db:
        try:
            stmt = select(PriceRule).where(PriceRule.is_active == True).order_by(PriceRule.priority.asc())
            result = await db.execute(stmt)
            _price_rules_cache = result.scalars().all()
            _rules_cache_updated_at = datetime.now(timezone.utc)
        except Exception:
            _price_rules_cache = []
    return _price_rules_cache

def _aggressive_rounding(price: Decimal) -> int:
    try:
        price_int = int(price.to_integral_value(rounding=ROUND_UP))
        if price_int < 100: remainder = price_int % 5; return price_int + (5 - remainder) if remainder != 0 else price_int
        remainder = price_int % 10
        if remainder == 0: return price_int
        return price_int + (10 - remainder)
    except Exception: return 0

async def calculate_final_price(base_price_str: str | None, category_tag: Optional[str] = None, supplier_id: Optional[int] = None) -> int:
    if base_price_str is None: return 0
    try:
        cleaned_price_str = base_price_str.strip().replace(' ', '').replace(',', '.')
        if not cleaned_price_str: return 0
        base_price_decimal = Decimal(cleaned_price_str)
        if base_price_decimal <= 0: return 0
        rules = await _load_price_rules()
        final_price = None
        base_price_kopecks = int(base_price_decimal * 100)
        for rule in rules:
            if rule.min_price is not None and base_price_kopecks < rule.min_price: continue
            if rule.max_price is not None and base_price_kopecks > rule.max_price: continue
            if rule.category_tag is not None and rule.category_tag != category_tag: continue
            if rule.supplier_id is not None and rule.supplier_id != supplier_id: continue
            if rule.rule_type == PriceRuleType.percentage:
                final_price = base_price_decimal * (Decimal('1.0') + (Decimal(rule.value) / Decimal('100.0')))
            elif rule.rule_type == PriceRuleType.fixed_amount:
                final_price = base_price_decimal + Decimal(rule.value)
            break
        if final_price is None:
            final_price = base_price_decimal * Decimal('1.33')
        return _aggressive_rounding(final_price)
    except Exception:
        return 0

def _find_common_prefix(names: List[str]) -> str:
    if not names: return ""
    min_name, max_name = min(names), max(names)
    for i, char in enumerate(min_name):
        if char != max_name[i]:
            last_space = min_name[:i].rfind(' ')
            if last_space != -1: return min_name[:last_space].strip()
            return min_name[:i].strip()
    return min_name.strip()

# --- [ВИПРАВЛЕНО] ---
async def _get_or_create_supplier(session, key: str, xml_url: str) -> int:
    stmt = select(Supplier.id).where(Supplier.key == key)
    result = await session.execute(stmt)
    supplier_id = result.scalar_one_or_none()
    
    if not supplier_id:
        new_supplier = Supplier(
            key=key,
            name=f"Auto-Import: {key}",
            type=SupplierType.mydrop,
            xml_url=xml_url,
            status=SupplierStatus.active # <-- ВИПРАВЛЕНО (було is_active=True)
        )
        session.add(new_supplier)
        await session.flush()
        supplier_id = new_supplier.id
        logger.info(f"-> 7. Створено нового системного постачальника: {key}")
    return supplier_id
# ---

async def _get_or_create_options(session, product_id: int, options_map: Dict[str, Set[str]]) -> Dict[Tuple[str, str], int]:
    db_value_map = {}
    for option_name, values_set in options_map.items():
        if not values_set: continue
        opt_stmt = pg_insert(ProductOption).values(product_id=product_id, name=option_name).on_conflict_do_update(index_elements=['product_id', 'name'], set_={'name': option_name}).returning(ProductOption.id)
        option_id = (await session.execute(opt_stmt)).scalar_one()
        
        for value_str in values_set:
            if not value_str: continue
            val_stmt = pg_insert(ProductOptionValue).values(option_id=option_id, value=value_str).on_conflict_do_nothing(index_elements=['option_id', 'value']).returning(ProductOptionValue.id)
            value_id = (await session.execute(val_stmt)).scalar_one_or_none()
            if not value_id:
                s = select(ProductOptionValue.id).where((ProductOptionValue.option_id == option_id) & (ProductOptionValue.value == value_str))
                value_id = (await session.execute(s)).scalar_one()
            db_value_map[(option_name, value_str)] = value_id
    return db_value_map

# ---
# [ОНОВЛЕНО] ГОЛОВНИЙ ПАРСЕР v30 (З ТУРБО-РЕЖИМОМ)
# ---
async def load_and_parse_xml_data(supplier_key: str = "system_import", xml_url: str | None = None):
    url_to_load = xml_url or str(config.mydrop_export_url)
    if not url_to_load: return

    try:
        logger.info(f"-> 1. Завантажую XML... (Це може зайняти 1-5 хвилин, залежно від вашого інтернету)")
        async with aiohttp.ClientSession() as session:
            async with session.get(url_to_load, timeout=300) as response: # Тайм-аут 5 хвилин
                response.raise_for_status()
                xml_content = await response.read()
        logger.info(f"-> 2. XML Завантажено ({len(xml_content)} байт).")
        
        logger.info("-> 3. Парсинг XML (Перетворення в дерево)...")
        root = ET.fromstring(xml_content)
        logger.info("-> 4. XML розпарсено.")
        
    except Exception as e:
        logger.error(f"XML Error (Download/Parse): {e}")
        return

    products_to_process = defaultdict(list)
    offers = root.findall('.//offer')
    logger.info(f"-> 5. Знайдено {len(offers)} 'offer'. Групую...")
    
    # --- [ТУРБО-РЕЖИМ v3 - ПРАВИЛЬНИЙ] ---
    # Ми зупиняємо *групування* після 50, а не запис.
    grouped_count = 0
    for offer in offers:
        group_id_el = offer.attrib.get('group_id')
        vendor_code_el = offer.find('vendorCode')
        group_key = group_id_el or (vendor_code_el.text.strip() if vendor_code_el is not None and vendor_code_el.text else None)
        
        if not group_key: continue
            
        if group_key not in products_to_process:
            grouped_count += 1
            
        if grouped_count > 50: # <--- ЛІМІТ ТУТ
             logger.info("🛑 ТУРБО-РЕЖИМ: Досягнуто ліміту в 50 груп. Зупиняю групування.")
             break # Зупиняємо ЦЕЙ цикл
             
        products_to_process[group_key].append(offer)
    # ---------------------------------

    logger.info(f"-> 6. Запис в БД ({len(products_to_process)} груп)...")
    async with AsyncSessionLocal() as session:
        try:
            supplier_id = await _get_or_create_supplier(session, supplier_key, url_to_load)

            processed_products = 0
            processed_variants = 0
            
            for group_key, offer_list in products_to_process.items():
                first = offer_list[0]
                sku = (first.find('vendorCode').text or group_key).strip()
                all_names = [o.find('name').text.strip() for o in offer_list if o.find('name') is not None and o.find('name').text]
                base_name = _find_common_prefix(all_names) or all_names[0]
                desc = first.find('description').text if first.find('description') is not None else ""
                pics = [p.text for p in first.findall('picture') if p.text][:5]
                cat_id = first.find('categoryId').text if first.find('categoryId') is not None else None

                # Product Upsert
                product_stmt = pg_insert(Product).values(
                    supplier_id=supplier_id,
                    supplier_sku=sku,
                    name=base_name,
                    description=desc,
                    pictures=pics,
                    category=cat_id,
                    status='active'
                ).on_conflict_do_update(
                    index_elements=['supplier_id', 'supplier_sku'],
                    set_={'name': base_name, 'description': desc, 'pictures': pics, 'category': cat_id, 'updated_at': func.now()}
                ).returning(Product.id)
                product_id = (await session.execute(product_stmt)).scalar_one()

                # Options
                # [НАДІЙНІСТЬ] Ключі/значення тут ЗАВЖДИ .strip(), інакше нижче
                # (при лінкуванні варіанту до option_values) key = (name.strip(), value.strip())
                # не знайде збігу в val_ids_map, якщо в XML є зайві пробіли навколо
                # name="Размер " або тексту параметра " S " -> варіант лишиться
                # без опцій, і кнопки розміру/кольору на фронтенді не з'являться.
                options_map: Dict[str, Set[str]] = defaultdict(set)
                name_options = set()
                for offer in offer_list:
                    for param in offer.findall('param'):
                        p_name = (param.attrib.get('name') or '').strip()
                        p_value = (param.text or '').strip()
                        if p_name and p_value:
                            options_map[p_name].add(p_value)
                    name_el = offer.find('name')
                    if name_el is not None and name_el.text:
                        var_name = name_el.text.replace(base_name, "").strip()
                        if var_name:
                            name_options.add(var_name)

                # "Колір" з різниці в назвах offer'ів синтезуємо ЛИШЕ якщо
                # постачальник не віддав реальний параметр кольору (<param
                # name="Цвет"/"Колір"/"Color">) — інакше матимемо ДВІ окремі
                # опції кольору (з param і синтетичну), і на картці/сторінці
                # товару з'явиться дублюючий, зайвий селектор.
                has_real_color_param = any(
                    re.search(r"колір|цвет|color", name, re.IGNORECASE) for name in options_map
                )
                if len(name_options) > 1 and not has_real_color_param:
                    options_map["Колір"] = name_options

                val_ids_map = await _get_or_create_options(session, product_id, options_map)

                # Variants
                for offer in offer_list:
                    offer_id = offer.attrib.get('id')
                    price_str = offer.find('price').text
                    final_price = await calculate_final_price(price_str, cat_id, supplier_id)
                    base_price = float(price_str.replace(',','.')) if price_str else 0.0
                    qty_el = offer.find('quantity_in_stock')
                    qty = int(qty_el.text) if qty_el is not None and qty_el.text else 0
                    is_avail = offer.attrib.get('available') == 'true' and qty > 0

                    # --- ВИПРАВЛЕНИЙ БЛОК ---
                    var_stmt = pg_insert(ProductVariant).values(
                        product_id=product_id,
                        supplier_offer_id=offer_id,
                        base_price=base_price,
                        final_price=final_price,
                        quantity=qty,
                        is_available=is_avail,
                        last_updated=func.now()
                    ).on_conflict_do_update(
                        index_elements=['supplier_offer_id'],
                        set_={
                            'base_price': base_price,
                            'final_price': final_price,
                            'quantity': qty,
                            'is_available': is_avail,
                            'last_updated': func.now()
                        }
                    ).returning(ProductVariant.id)
                    # ------------------------
                    
                    variant_id = (await session.execute(var_stmt)).scalar_one()
                    processed_variants += 1

# Прогрес + періодичний commit, щоб не "висіло" без ознак життя
                    if processed_variants % 200 == 0:
                        logger.info(f"Прогрес: variants={processed_variants}, products={processed_products}")
                        await session.commit()
                    
                    # Links
                    value_ids_to_link = []
                    for param in offer.findall('param'):
                        key = ((param.attrib.get('name') or '').strip(), (param.text or "").strip())
                        if key in val_ids_map:
                            value_ids_to_link.append(val_ids_map[key])
                    if len(name_options) > 1 and not has_real_color_param:
                        name_el = offer.find('name')
                        if name_el is not None and name_el.text:
                            name_variant = name_el.text.replace(base_name, "").strip()
                            key = ("Колір", name_variant)
                            if key in val_ids_map:
                                value_ids_to_link.append(val_ids_map[key])
                    
                    if value_ids_to_link:
                        await session.execute(
                            delete(product_variant_option_values).where(
                                product_variant_option_values.c.variant_id == variant_id
                            )
                        )
                        link_values = [
                            {'variant_id': variant_id, 'option_value_id': val_id} 
                            for val_id in set(value_ids_to_link)
                        ]
                        if link_values:
                            await session.execute(insert(product_variant_option_values).values(link_values))
            
            await session.commit()
            logger.info(f"✅ Парсинг завершено! ({len(products_to_process)} груп оброблено)")

        except Exception as e:
            await session.rollback()
            logger.error(f"Помилка парсингу (БД): {e}", exc_info=True)

async def get_variant_with_options(variant_id: int) -> Optional[ProductVariant]:
    if not variant_id: return None
    async with AsyncSessionLocal() as session:
        stmt = select(ProductVariant).where(ProductVariant.id == variant_id).options(selectinload(ProductVariant.option_values).selectinload(ProductOptionValue.option))
        return (await session.execute(stmt)).scalar_one_or_none()

async def search_products(query: str, limit: int = 50):
    """
    Пошук продуктів для /api/v1/search.
    Критично: робимо eager-load зв’язків, щоб FastAPI не намагався lazy-load після закриття сесії.
    Повертаємо вже Pydantic-моделі ProductAPI.
    """
    q = (query or "").strip()
    if not q:
        return []

    async with AsyncSessionLocal() as session:
        stmt = (
            select(Product)
            .options(
                selectinload(Product.variants).selectinload(ProductVariant.option_values),
                selectinload(Product.options).selectinload(ProductOption.values),
            )
            .where(
                or_(
                    Product.name.ilike(f"%{q}%"),
                    Product.description.ilike(f"%{q}%"),
                    Product.category.ilike(f"%{q}%"),
                )
            )
            .limit(limit)
        )

        res = await session.execute(stmt)
        products = res.scalars().unique().all()

        # Добиваємо option_value_ids (бо в ORM це relationship option_values)
        for p in products:
            for v in p.variants:
                v.option_value_ids = [ov.id for ov in (v.option_values or [])]

        # Валідуємо в Pydantic поки сесія ще жива і зв’язки вже завантажені
        from api_models import ProductAPI
        return [ProductAPI.model_validate(p) for p in products]

async def get_variant_by_offer_id(offer_id: str) -> Optional[ProductVariant]:
    """
    Знаходить ProductVariant за supplier_offer_id.
    Підвантажує Product (назва/sku/pictures).
    """
    if not offer_id:
        return None

    async with AsyncSessionLocal() as session:
        try:
            stmt = select(ProductVariant).where(
                ProductVariant.supplier_offer_id == offer_id
            ).options(
                joinedload(ProductVariant.product)
            )

            result = await session.execute(stmt)
            return result.scalar_one_or_none()

        except Exception as e:
            logger.error(f"Помилка пошуку в БД за offer_id '{offer_id}': {e}", exc_info=True)
            return None


def start_xml_parsing_scheduler():
    """Запускає APScheduler для регулярного оновлення БД з XML."""
    try:
        if _scheduler.get_job('db_update_system_import'):
            logger.info("Планувальник XML->БД вже запущено.")
            return

        _scheduler.add_job(
            load_and_parse_xml_data,
            'interval',
            minutes=int(getattr(config, "xml_cache_ttl_min", 60)),
            args=["system_import", str(config.mydrop_export_url)],
            id='db_update_system_import',
            misfire_grace_time=120
        )

        if not _scheduler.running:
            _scheduler.start()
            logger.info("✅ Планувальник XML->БД запущено.")

    except Exception as e:
        logger.error(f"Помилка запуску планувальника XML->БД: {e}", exc_info=True)