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
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.dialects.postgresql import insert as pg_insert

from config_reader import config
from database.db import AsyncSessionLocal
from database.models import (
    Supplier, Product, ProductVariant, 
    ProductOption, ProductOptionValue, ProductVariantOptionValue,
    PriceRule, PriceRuleType # <-- НОВИЙ ІМПОРТ
)

logger = logging.getLogger(__name__)
_scheduler = AsyncIOScheduler(timezone="Europe/Kiev")

# --- Глобальний Кеш для Правил Націнки (План 27G) ---
# (Ми не хочемо питати БД про 100 правил на кожний з 1000 товарів)
_price_rules_cache: List[PriceRule] = []
_rules_cache_updated_at = None

async def _load_price_rules() -> List[PriceRule]:
    """
    (Фаза 5.4.4 / План 27G)
    Завантажує та кешує правила націнки з БД.
    """
    global _price_rules_cache, _rules_cache_updated_at
    
    # Кешуємо на 1 хвилину
    if _price_rules_cache and _rules_cache_updated_at and \
       (datetime.now(timezone.utc) - _rules_cache_updated_at < timedelta(minutes=1)):
        return _price_rules_cache
        
    logger.info("Оновлюю кеш правил націнок (PriceRules) з БД...")
    async with AsyncSessionLocal() as db:
        stmt = select(PriceRule).where(
            PriceRule.is_active == True
        ).order_by(PriceRule.priority.asc())
        
        result = await db.execute(stmt)
        _price_rules_cache = result.scalars().all()
        _rules_cache_updated_at = datetime.now(timezone.utc)
        
        if not _price_rules_cache:
            logger.warning("Не знайдено ЖОДНОГО 'PriceRule'. Буде використано націнку +33% за замовчуванням.")
            
        return _price_rules_cache

def _aggressive_rounding(price: Decimal) -> int:
    # ... (код без змін) ...
    try:
        price_int = int(price.to_integral_value(rounding=ROUND_UP))
        if price_int < 100:
            remainder = price_int % 5
            return price_int + (5 - remainder) if remainder != 0 else price_int
        remainder = price_int % 10
        if remainder == 0: return price_int
        return price_int + (10 - remainder)
    except Exception:
        logger.error(f"Помилка агресивного округлення для ціни {price}", exc_info=True)
        return 0

# ---
# [ОНОВЛЕНО - ФАЗА 5.4.4] (План 23/27 "God Mode")
# ---
async def calculate_final_price(
    base_price_str: str | None,
    category_tag: Optional[str] = None,
    supplier_id: Optional[int] = None
) -> int:
    """
    (План 27G) "Розумний" калькулятор ціни.
    Бере дроп-ціну та шукає у `PriceRule` (з БД)
    правильну націнку (33% vs 30%...).
    """
    if base_price_str is None: return 0
    try:
        cleaned_price_str = base_price_str.strip().replace(' ', '').replace(',', '.')
        if not cleaned_price_str: return 0
        base_price = Decimal(cleaned_price_str)
        if base_price <= 0: return 0
        
        # 1. Завантажуємо правила
        rules = await _load_price_rules()
        
        final_price = None
        
        # 2. Шукаємо перше правило, що підходить
        for rule in rules:
            # Перевірка "ЯКЩО"
            if rule.min_price is not None and base_price < rule.min_price:
                continue # (Ціна нижча за мінімальну)
            if rule.max_price is not None and base_price > rule.max_price:
                continue # (Ціна вища за максимальну)
            if rule.category_tag is not None and rule.category_tag != category_tag:
                continue # (Інша категорія)
            if rule.supplier_id is not None and rule.supplier_id != supplier_id:
                continue # (Інший постачальник)
                
            # Успіх! Ми знайшли правило. Застосовуємо "ТОДІ"
            if rule.rule_type == PriceRuleType.percentage:
                # (План 23: 30%)
                final_price = base_price * (Decimal('1.0') + (Decimal(rule.value) / Decimal('100.0')))
            elif rule.rule_type == PriceRuleType.fixed_amount:
                final_price = base_price + Decimal(rule.value)
            
            break # Зупиняємось на першому ж правилі (бо вони по пріоритету)

        # 3. Якщо ЖОДНЕ правило не підійшло - ставимо +33% (План 23)
        if final_price is None:
            final_price = base_price * Decimal('1.33') # Націнка за замовчуванням
        
        # 4. Агресивне Округлення
        return _aggressive_rounding(final_price)

    except (InvalidOperation, ValueError, TypeError, AttributeError) as e:
        logger.warning(f"Помилка розрахунку ціни для '{base_price_str}': {e}")
        return 0
    except Exception as e:
        logger.error(f"Неочікувана помилка розрахунку ціни для '{base_price_str}': {e}", exc_info=True)
        return 0

# --- "Розумний" аналізатор назв (для кольорів) ---
def _find_common_prefix(names: List[str]) -> str:
    """Знаходить спільний префікс у списку назв."""
    if not names: return ""
    min_name, max_name = min(names), max(names)
    for i, char in enumerate(min_name):
        if char != max_name[i]:
            # Повертаємо префікс до останнього пробілу (щоб не різати слова)
            last_space = min_name[:i].rfind(' ')
            if last_space != -1:
                return min_name[:last_space].strip()
            return min_name[:i].strip()
    return min_name.strip()

async def _get_or_create_supplier(session: AsyncSessionLocal, supplier_key: str, xml_url: str) -> int:
    """Отримує або створює ID постачальника."""
    stmt = select(Supplier.id).where(Supplier.key == supplier_key)
    result = await session.execute(stmt)
    supplier_id = result.scalar_one_or_none()
    
    if supplier_id:
        return supplier_id
        
    # Створюємо нового
    insert_stmt = pg_insert(Supplier).values(
        key=supplier_key,
        name=config.supplier_name, # Беремо з .env
        type=SupplierType.mydrop,
        xml_url=xml_url,
        is_active=True # Активуємо одразу
    ).on_conflict_do_nothing(index_elements=['key']).returning(Supplier.id)
    
    result = await session.execute(insert_stmt)
    supplier_id = result.scalar_one_or_none()
    if not supplier_id: # Якщо on_conflict_do_nothing спрацював
        result = await session.execute(stmt)
        supplier_id = result.scalar_one()
        
    await session.commit()
    return supplier_id

async def _get_or_create_options(
    session: AsyncSessionLocal, 
    product_id: int, 
    options_map: Dict[str, Set[str]]
) -> Dict[Tuple[str, str], int]:
    """
    Створює ProductOption та ProductOptionValue в БД.
    Повертає map: {('Розмір', 'S'): 123, ('Колір', 'Мультикам'): 124, ...}
    """
    db_value_map = {}
    for option_name, values_set in options_map.items():
        if not values_set: continue
        
        # 1. Get-or-create ProductOption (напр. "Розмір")
        opt_stmt = pg_insert(ProductOption).values(
            product_id=product_id,
            name=option_name
        ).on_conflict_do_update(
            index_elements=['product_id', 'name'],
            set_={'name': option_name} # Оновлюємо на випадок зміни регістру
        ).returning(ProductOption.id)
        
        option_id = (await session.execute(opt_stmt)).scalar_one()
        
        # 2. Get-or-create ProductOptionValue (напр. "S", "M", "L")
        for value_str in values_set:
            if not value_str: continue
            val_stmt = pg_insert(ProductOptionValue).values(
                option_id=option_id,
                value=value_str
            ).on_conflict_do_nothing(
                index_elements=['option_id', 'value']
            ).returning(ProductOptionValue.id)
            
            value_id = (await session.execute(val_stmt)).scalar_one_or_none()
            if not value_id: # Якщо on_conflict спрацював
                s = select(ProductOptionValue.id).where(
                    (ProductOptionValue.option_id == option_id) & (ProductOptionValue.value == value_str)
                )
                value_id = (await session.execute(s)).scalar_one()
                
            db_value_map[(option_name, value_str)] = value_id
            
    return db_value_map


# ---
# ГОЛОВНИЙ НОВИЙ ПАРСЕР (ФАЗА 2.5.3)
# ---
async def load_and_parse_xml_data(supplier_key: str = "landliz", xml_url: str | None = None):
    """
    Завантажує XML, "розумно" парсить його у ГНУЧКУ СХЕМУ (з опціями/варіантами)
    та оновлює дані в БД.
    """
    url_to_load = xml_url or str(config.mydrop_export_url)
    if not url_to_load:
        logger.error(f"URL для '{supplier_key}' не вказано."); return
    logger.info(f"Оновлення ГНУЧКОЇ БД для '{supplier_key}' з {url_to_load[:50]}...")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url_to_load, timeout=120) as response:
                response.raise_for_status()
                xml_content = await response.read()
    except Exception as e:
        logger.error(f"Помилка завантаження XML {supplier_key}: {e}"); return

    # 1. Попередній аналіз: групуємо <offer> за `group_id` або `vendorCode`
    # (Саме так, як ти проаналізував XML!)
    products_to_process = defaultdict(list)
    try:
        root = ET.fromstring(xml_content.decode('utf-8'))
        offers = root.findall('.//offer')
        logger.info(f"'{supplier_key}': Знайдено {len(offers)} offers для парсингу.")
        
        for offer in offers:
            group_id = offer.attrib.get('group_id')
            vendor_code_el = offer.find('vendorCode')
            vendor_code = vendor_code_el.text.strip() if vendor_code_el is not None and vendor_code_el.text else None
            
            # Ключ групування = group_id. Якщо його нема, використовуємо vendorCode.
            group_key = group_id or vendor_code
            if not group_key:
                continue # Не можемо згрупувати товар
                
            products_to_process[group_key].append(offer)
            
    except ET.ParseError as e:
        logger.error(f"Помилка парсингу XML {supplier_key}: {e}"); return
    except Exception as e:
        logger.error(f"Неочікувана помилка обробки XML {supplier_key}: {e}", exc_info=True); return
        
    if not products_to_process:
        logger.warning(f"Не знайдено продуктів для '{supplier_key}'. Оновлення БД не відбувається.")
        return

    # 2. Обробка та запис у БД
    async with AsyncSessionLocal() as session:
        try:
            # Отримуємо ID постачальника
            supplier_id = await _get_or_create_supplier(session, supplier_key, url_to_load)
            
            processed_products = 0
            processed_variants = 0
            
            # Позначаємо всі товари/варіанти цього постачальника як "недоступні"
            # Новий парсинг оновить ті, що є в наявності.
            await session.execute(
                update(ProductVariant).join(Product)
                .where(Product.supplier_id == supplier_id)
                .values(is_available=False, quantity=0)
            )

            for group_key, offer_list in products_to_process.items():
                first_offer = offer_list[0]
                
                # --- A. Визначаємо базові дані Product ---
                sku = (first_offer.find('vendorCode').text or group_key).strip()
                all_names = [o.find('name').text.strip() for o in offer_list if o.find('name') is not None and o.find('name').text]
                base_name = _find_common_prefix(all_names) or all_names[0] # "Тактична сорочка (убакс)"
                description_el = first_offer.find('description')
                description = description_el.text.strip() if description_el is not None and description_el.text else ""
                pictures = [pic.text for pic in first_offer.findall('picture') if pic.text]
                category_id = first_offer.find('categoryId').text if first_offer.find('categoryId') is not None else None
                
                # --- B. "Розумний" аналіз Опцій (Твоя ідея!) ---
                options_map = defaultdict(set)
                name_options_values = set()
                
                for offer in offer_list:
                    # B.1: Аналіз <param>
                    for param in offer.findall('param'):
                        param_name = param.attrib.get('name')
                        param_value = param.text
                        if param_name and param_value:
                            options_map[param_name.strip()].add(param_value.strip())
                            
                    # B.2: Аналіз кольору (захованого в назві)
                    name_el = offer.find('name')
                    if name_el is not None and name_el.text:
                        name_variant = name_el.text.strip().replace(base_name, "").strip()
                        if name_variant:
                            name_options_values.add(name_variant)

                # Якщо ми знайшли варіації в назві (напр. "мультикам", "койот"), додаємо їх
                if len(name_options_values) > 1:
                    options_map["Колір"] = name_options_values # "Колір" - це наша "розумна" опція
                
                # --- C. Запис Product в БД ---
                product_stmt = pg_insert(Product).values(
                    supplier_id=supplier_id,
                    sku=sku,
                    name=base_name,
                    description=description,
                    pictures=pictures,
                    category_tag=category_id,
                    attributes={} # TODO: Заповнити атрибути для фільтрів (Бренд, Рік...)
                ).on_conflict_do_update(
                    index_elements=['supplier_id', 'sku'],
                    set_={
                        'name': base_name, 'description': description, 'pictures': pictures,
                        'category_tag': category_id, 'last_updated': func.now()
                    }
                ).returning(Product.id)
                
                product_id = (await session.execute(product_stmt)).scalar_one()
                
                # --- D. Запис Опцій (Розмір, Колір) в БД ---
                # value_db_map = {('Розмір', 'S'): 123, ('Колір', 'Мультикам'): 124}
                value_db_map = await _get_or_create_options(session, product_id, options_map)

                # --- E. Запис/Оновлення Варіантів (ProductVariant) ---
                for offer in offer_list:
                    offer_id = offer.attrib.get('id')
                    price_el = offer.find('price')
                    if not offer_id or price_el is None or not price_el.text:
                        continue # Пропускаємо невалідний offer

                # Викликаємо "розумний" калькулятор
                    final_price_int = await calculate_final_price(
                        base_price_str=price_el.text,
                        category_tag=category_id, # <-- Передаємо Категорію
                        supplier_id=supplier_id  # <-- Передаємо Постачальника
                    )

                    try:
                        base_price_decimal = Decimal(price_el.text.strip().replace(' ', '').replace(',', '.'))
                    except (InvalidOperation, ValueError, TypeError):
                        base_price_decimal = Decimal(0) # Якщо ціна некоректна, все одно запишемо 0

                    quantity_el = offer.find('quantity_in_stock')
                    quantity = 0
                    if quantity_el is not None and quantity_el.text:
                         try: quantity = int(quantity_el.text)
                         except (ValueError, TypeError): quantity = 0
                    
                    is_available = offer.attrib.get('available') == 'true' and quantity > 0
                    
                    var_stmt = pg_insert(ProductVariant).values(
                        product_id=product_id,
                        supplier_offer_id=offer_id,
                        base_price=base_price_decimal,
                        final_price=final_price_int,
                        quantity=quantity,
                        is_available=is_available,
                        last_updated=func.now()
                    ).on_conflict_do_update(
                        index_elements=['supplier_offer_id'],
                        set_={
                            'base_price': base_price_decimal, 'final_price': final_price_int,
                            'quantity': quantity, 'is_available': is_available,
                            'last_updated': func.now()
                        }
                    ).returning(ProductVariant.id)
                    
                    variant_id = (await session.execute(var_stmt)).scalar_one()
                    processed_variants += 1
                    
                    # --- F. Зв'язування Варіанту з Опціями (Найважливіший крок) ---
                    # 1. Знаходимо ID опцій для *цього* offer
                    value_ids_to_link = []
                    # З <param>
                    for param in offer.findall('param'):
                        key = (param.attrib.get('name', '').strip(), param.text.strip())
                        if key in value_db_map:
                            value_ids_to_link.append(value_db_map[key])
                    # З <name> (Колір)
                    if len(name_options_values) > 1:
                        name_el = offer.find('name')
                        if name_el is not None and name_el.text:
                            name_variant = name_el.text.strip().replace(base_name, "").strip()
                            key = ("Колір", name_variant)
                            if key in value_db_map:
                                value_ids_to_link.append(value_db_map[key])
                    
                    # 2. Видаляємо старі зв'язки для цього variant_id
                    await session.execute(
                        delete(ProductVariantOptionValue).where(ProductVariantOptionValue.variant_id == variant_id)
                    )
                    
                    # 3. Вставляємо нові зв'язки
                    if value_ids_to_link:
                        link_values = [
                            {'variant_id': variant_id, 'value_id': val_id} 
                            for val_id in set(value_ids_to_link) # Унікальні ID
                        ]
                        await session.execute(insert(ProductVariantOptionValue).values(link_values))
                
                processed_products += 1

            # Коммітимо всі зміни в кінці
            await session.commit()
            logger.info(f"Оновлення БД для '{supplier_key}' успішно завершено.")
            logger.info(f"Оброблено {processed_products} продуктів (груп) та {processed_variants} варіантів.")
            
        except SQLAlchemyError as e:
            await session.rollback()
            logger.error(f"Помилка транзакції БД під час оновлення {supplier_key}: {e}", exc_info=True)
        except Exception as e:
            await session.rollback()
            logger.error(f"Неочікувана помилка під час транзакції БД {supplier_key}: {e}", exc_info=True)

# ---
# ОНОВЛЕНІ ФУНКЦІЇ ПОШУКУ (ДЛЯ ГНУЧКОЇ СХЕМИ)
# ---

async def force_reload_products():
    """Примусово перезавантажує дані з XML у БД."""
    logger.info("Примусове оновлення БД з XML...")
    await load_and_parse_xml_data(supplier_key="landliz", xml_url=str(config.mydrop_export_url))
    logger.info("Примусове оновлення БД завершено.")

async def get_product_by_sku(sku: str) -> Optional[Product]:
    """
    Шукає товар за SKU у БАЗІ ДАНИХ та повертає модель Product 
    з усіма завантаженими ОПЦІЯМИ та ВАРІАНТАМИ.
    """
    if not sku: return None
    normalized_sku = sku.strip().lower()
    
    async with AsyncSessionLocal() as session:
        try:
            stmt = select(Product).where(
                Product.sku.ilike(normalized_sku)
            ).options(
                # Завантажуємо ВСІ пов'язані гнучкі дані
                selectinload(Product.options).selectinload(ProductOption.values),
                selectinload(Product.variants).selectinload(ProductVariant.option_values)
            )
            
            result = await session.execute(stmt)
            product = result.scalar_one_or_none()
            return product
            
        except Exception as e:
            logger.error(f"Неочікувана помилка get_product_by_sku: {e}", exc_info=True)
            return None

async def search_products(query: str, category_tag: Optional[str] = None) -> List[Product]:
    """
    Шукає товари у БД за входженням у назву/SKU, 
    з можливістю фільтрації по КАТЕГОРІЇ (для MiniApp).
    """
    if not query: return []
    search_query = f"%{query.lower().strip()}%"
    
    async with AsyncSessionLocal() as session:
        try:
            stmt = select(Product).where(
                (Product.name.ilike(search_query)) |
                (Product.sku.ilike(search_query))
            ).options(
                # Важливо: завантажуємо варіанти, щоб показати ціну в каталозі
                selectinload(Product.variants)
            )
            
            # --- Гнучкий Фільтр Категорій (з Глобального Плану 12) ---
            if category_tag:
                stmt = stmt.where(Product.category_tag == category_tag)
                
            stmt = stmt.limit(20) # Обмежуємо кількість результатів
            
            result = await session.execute(stmt)
            products = result.scalars().unique().all() # .unique() для уникнення дублів
            return list(products)
            
        except Exception as e:
            logger.error(f"Неочікувана помилка search_products: {e}", exc_info=True)
            return []

async def get_variant_by_offer_id(offer_id: str) -> Optional[ProductVariant]:
    """
    Знаходить конкретний ProductVariant за його унікальним supplier_offer_id.
    Також завантажує пов'язаний Product (для назви, sku, pictures).
    """
    if not offer_id: return None
    async with AsyncSessionLocal() as session:
        try:
            stmt = select(ProductVariant).where(
                ProductVariant.supplier_offer_id == offer_id
            ).options(
                joinedload(ProductVariant.product) # Використовуємо joinedload для 1 запиту
            )
            result = await session.execute(stmt)
            variant = result.scalar_one_or_none()
            return variant
        except Exception as e:
            logger.error(f"Помилка пошуку в БД за offer_id '{offer_id}': {e}", exc_info=True)
            return None

def start_xml_parsing_scheduler():
    """Запускає APScheduler для регулярного оновлення БД з XML."""
    try:
        if _scheduler.get_job('db_update_landliz'):
            logger.info("Планувальник XML->БД вже запущено.")
            return

        _scheduler.add_job(
            load_and_parse_xml_data, 
            'interval', 
            minutes=config.xml_cache_ttl_min,
            args=["landliz", str(config.mydrop_export_url)], 
            id='db_update_landliz', 
            misfire_grace_time=120
        )
        
        if not _scheduler.running:
            _scheduler.start()
            logger.info("✅ ГНУЧКИЙ Планувальник XML->БД запущено.")
            
    except Exception as e:
        logger.error(f"❌ Помилка запуску гнучкого планувальника XML->БД: {e}", exc_info=True)

# Запускаємо планувальник при імпорті файлу
start_xml_parsing_scheduler()

# --- ДОДАЙ ЦЮ НОВУ ФУНКЦІЮ В КІНЕЦЬ ФАЙЛУ ---

async def get_variant_with_options(variant_id: int) -> Optional[ProductVariant]:
    """
    Знаходить ProductVariant за його ID (не offer_id) та підвантажує
    назви його опцій (напр. 'Розмір: L', 'Колір: Red').
    """
    if not variant_id: return None
    async with AsyncSessionLocal() as session:
        try:
            stmt = select(ProductVariant).where(
                ProductVariant.id == variant_id
            ).options(
                # Завантажуємо ProductOptionValue -> ProductOption (щоб отримати ім'я "Розмір")
                selectinload(ProductVariant.option_values).selectinload(ProductOptionValue.option)
            )
            result = await session.execute(stmt)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Помилка get_variant_with_options для ID {variant_id}: {e}", exc_info=True)
            return None