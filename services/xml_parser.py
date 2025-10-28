# services/xml_parser.py
import logging
import xml.etree.ElementTree as ET
from decimal import Decimal, ROUND_HALF_UP, ROUND_UP
import aiohttp
import asyncio
from typing import Dict, Any, List
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from config_reader import config

logger = logging.getLogger(__name__)

_suppliers_caches: Dict[str, Dict[str, Dict[str, Any]]] = {}
_scheduler = AsyncIOScheduler(timezone="Europe/Kiev")

def _aggressive_rounding(price: Decimal) -> int:
    price_int = int(price.to_integral_value(rounding=ROUND_UP))
    if price_int < 100:
        remainder = price_int % 5
        return price_int + (5 - remainder) if remainder != 0 else price_int
    remainder = price_int % 10
    if remainder == 0: return price_int
    return price_int + (10 - remainder)

def calculate_final_price(base_price_str: str | None) -> int:
    if base_price_str is None: return 0
    try:
        cleaned_price_str = base_price_str.strip().replace(' ', '').replace(',', '.')
        if not cleaned_price_str: return 0
        base_price = Decimal(cleaned_price_str)
        if base_price <= 0: return 0
        final_price = base_price * Decimal('1.33')
        return _aggressive_rounding(final_price)
    except (ValueError, TypeError, AttributeError) as e:
        logger.warning(f"Помилка розрахунку ціни для '{base_price_str}': {e}")
        return 0

async def load_and_parse_xml_data(supplier_id: str = "landliz", xml_url: str | None = None):
    """Завантажує та парсить XML для КОНКРЕТНОГО постачальника."""
    global _suppliers_caches
    url_to_load = xml_url or config.mydrop_export_url
    if not url_to_load:
        logger.error(f"URL для '{supplier_id}' не вказано.")
        return
    logger.info(f"Оновлення кешу '{supplier_id}' з {url_to_load[:50]}...")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url_to_load, timeout=60) as response:
                response.raise_for_status()
                xml_content = await response.read()
    except asyncio.TimeoutError: logger.error(f"Таймаут завантаження XML {supplier_id}"); return
    except aiohttp.ClientError as e: logger.error(f"Помилка завантаження XML {supplier_id}: {e}"); return
    except Exception as e: logger.error(f"Неочікувана помилка завантаження XML {supplier_id}: {e}"); return

    temp_cache: Dict[str, Dict[str, Any]] = {}
    try:
        root = ET.fromstring(xml_content.decode('utf-8'))
        offers = root.findall('.//offer')
        logger.info(f"'{supplier_id}': Знайдено {len(offers)} offers.")
        parsed_count = 0; skipped_offers = 0
        for offer in offers:
            vendor_code_el = offer.find('vendorCode'); price_el = offer.find('price'); name_el = offer.find('name')
            if not all(el is not None and el.text is not None for el in [vendor_code_el, price_el, name_el]):
                skipped_offers += 1; continue
            vendor_code = vendor_code_el.text.strip(); price_text = price_el.text.strip(); name_text = name_el.text.strip()
            if not vendor_code or not price_text or not name_text:
                skipped_offers += 1; continue
            normalized_sku_key = vendor_code.lower()
            if normalized_sku_key not in temp_cache:
                calculated_final_price = calculate_final_price(price_text)
                if calculated_final_price <= 0: skipped_offers += 1; continue # Пропускаємо товари з нульовою ціною
                description_el = offer.find('description')
                description = description_el.text.strip() if description_el is not None and description_el.text else ""
                pictures = [pic.text for pic in offer.findall('picture') if pic.text]
                temp_cache[normalized_sku_key] = {
                    'supplier_id': supplier_id, 'name': name_text, 'description': description,
                    'pictures': pictures, 'sku': vendor_code, 'base_price': price_text,
                    'final_price': calculated_final_price, 'offers': []
                }
                parsed_count += 1
            if normalized_sku_key not in temp_cache: # Перевірка, чи товар не був пропущений через ціну
                skipped_offers += 1; continue
            param_el = offer.find(".//param[@name='Размер']"); size = param_el.text.strip() if param_el is not None and param_el.text else "N/A"
        quantity_el = offer.find('quantity_in_stock'); 
        quantity = 0
        if quantity_el is not None and quantity_el.text: 
            try: 
                quantity = int(quantity_el.text) 
            except ValueError: 
                quantity = 0
            is_available_attr = offer.attrib.get('available') == 'true'
            temp_cache[normalized_sku_key]['offers'].append({
                'offer_id': offer.attrib.get('id'), 'size': size,
                'available': is_available_attr and quantity > 0, 'quantity': quantity
            })
        _suppliers_caches[supplier_id] = temp_cache
        logger.info(f"Кеш '{supplier_id}' оновлено. Додано {parsed_count} SKU (пропущено {skipped_offers} offers).")
    except ET.ParseError as e: logger.error(f"Помилка парсингу XML {supplier_id}: {e}")
    except Exception as e: logger.error(f"Неочікувана помилка обробки XML {supplier_id}: {e}", exc_info=True)

async def get_combined_cache() -> Dict[str, Dict[str, Any]]:
    if "landliz" not in _suppliers_caches or not _suppliers_caches["landliz"]:
         logger.info("Кеш 'landliz' порожній, завантажую..."); await load_and_parse_xml_data()
    # TODO: Додати завантаження інших постачальників
    combined: Dict[str, Dict[str, Any]] = {}
    for supplier_id, supplier_cache in _suppliers_caches.items():
        for sku_key, product_data in supplier_cache.items():
            final_sku_key = sku_key
            if sku_key in combined and combined[sku_key]['supplier_id'] != supplier_id:
                final_sku_key = f"{sku_key}_{supplier_id}"
                logger.warning(f"Конфлікт SKU '{sku_key}'. Ключ '{final_sku_key}' для '{supplier_id}'.")
                product_data_copy = product_data.copy()
                product_data_copy['original_sku_for_conflict'] = product_data_copy['sku']
                product_data_copy['sku'] = final_sku_key
                combined[final_sku_key] = product_data_copy
            elif sku_key not in combined: combined[sku_key] = product_data
    return combined

async def force_reload_products():
    logger.info("Примусове оновлення кешів..."); global _suppliers_caches; _suppliers_caches = {}
    await load_and_parse_xml_data(); # TODO: Додати інших
    logger.info("Примусове оновлення завершено.")

async def get_product_by_sku(sku: str) -> dict | None:
    if not sku: return None
    cache = await get_combined_cache(); normalized_sku_key = sku.strip().lower()
    product = cache.get(normalized_sku_key)
    if not product and normalized_sku_key.isdigit(): product = cache.get(str(int(normalized_sku_key)))
    if not product: # Пошук за модифікованим ключем
        for supplier_id in _suppliers_caches.keys():
             modified_key = f"{normalized_sku_key}_{supplier_id}"
             product = cache.get(modified_key);
             if product: return product
    if not product: # Пошук за оригінальним SKU всередині
        for product_data in cache.values():
             original_sku = product_data.get('sku', '').strip().lower()
             conflict_sku = product_data.get('original_sku_for_conflict', '').strip().lower()
             if original_sku == normalized_sku_key or conflict_sku == normalized_sku_key: return product_data
    return product # Може бути None

async def search_products(query: str) -> List[Dict[str, Any]]:
    cache = await get_combined_cache(); query_lower = query.lower().strip(); results: List[Dict[str, Any]] = []
    exact_match = await get_product_by_sku(query)
    if exact_match: return [exact_match]
    for product_data in cache.values():
        name_lower = product_data.get('name', '').lower()
        sku_field_lower = product_data.get('sku', '').lower()
        original_conflict_sku = product_data.get('original_sku_for_conflict', '').lower()
        if query_lower in name_lower or query_lower in sku_field_lower or (original_conflict_sku and query_lower in original_conflict_sku):
            results.append(product_data)
    return results

def start_xml_parsing_scheduler():
    try:
        if not _scheduler.running:
            _scheduler.add_job(load_and_parse_xml_data, 'interval', minutes=5, args=["landliz", config.mydrop_export_url], id='xml_update_landliz', misfire_grace_time=60)
            # TODO: Додати jobs для інших
            _scheduler.start(); logger.info("✅ Планувальник XML-кешу запущено.")
    except Exception as e: logger.error(f"❌ Помилка запуску планувальника XML: {e}")

start_xml_parsing_scheduler()
