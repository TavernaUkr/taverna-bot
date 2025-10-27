# services/xml_parser.py
import logging
import xml.etree.ElementTree as ET
from decimal import Decimal, ROUND_HALF_UP, ROUND_UP # Додаємо ROUND_UP
import aiohttp
import asyncio
from typing import Dict, Any, List # Додаємо типи
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from config_reader import config

logger = logging.getLogger(__name__)

# Словник кешів: {supplier_id: {sku_key: product_data}}
_suppliers_caches: Dict[str, Dict[str, Dict[str, Any]]] = {}
_scheduler = AsyncIOScheduler()

# --- Функції цін (без змін) ---
def _aggressive_rounding(price: Decimal) -> int:
    price_int = int(price.to_integral_value(rounding=ROUND_UP)) # Змінено на ROUND_UP
    if price_int < 100:
        return int(5 * round(price_int / 5))
    last_digit = price_int % 10
    if last_digit in [1, 2, 6, 7]: return price_int - last_digit
    elif last_digit in [3, 4, 8, 9]: return price_int + (10 - last_digit)
    return price_int

def calculate_final_price(base_price_str: str | None) -> int:
    if base_price_str is None: return 0
    try:
        if not base_price_str.strip(): return 0
        base_price = Decimal(base_price_str.strip())
        final_price = base_price * Decimal('1.33')
        return _aggressive_rounding(final_price)
    except (ValueError, TypeError, AttributeError) as e:
        logger.warning(f"Помилка розрахунку ціни для '{base_price_str}': {e}")
        return 0

# --- Логіка завантаження та парсингу (ОНОВЛЕНО) ---

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
            # Додаємо таймаут до запиту
            async with session.get(url_to_load, timeout=60) as response: # Таймаут 60 секунд
                response.raise_for_status()
                xml_content = await response.read()
    except asyncio.TimeoutError: logger.error(f"Таймаут завантаження XML {supplier_id} з {url_to_load[:50]}"); return
    except aiohttp.ClientError as e: logger.error(f"Помилка завантаження XML {supplier_id}: {e}"); return
    except Exception as e: logger.error(f"Неочікувана помилка завантаження XML {supplier_id}: {e}"); return

    temp_cache: Dict[str, Dict[str, Any]] = {}
    try:
        root = ET.fromstring(xml_content)
        offers = root.findall('.//offer')
        logger.info(f"'{supplier_id}': Знайдено {len(offers)} offers.")

        parsed_count = 0
        skipped_offers = 0
        for offer in offers:
            vendor_code_el = offer.find('vendorCode')
            price_el = offer.find('price')
            name_el = offer.find('name')

            if vendor_code_el is None or vendor_code_el.text is None or \
               price_el is None or price_el.text is None or \
               name_el is None or name_el.text is None:
                skipped_offers += 1
                continue

            vendor_code = vendor_code_el.text.strip()
            price_text = price_el.text.strip()
            name_text = name_el.text.strip()

            if not vendor_code or not price_text or not name_text:
                skipped_offers += 1
                continue

            normalized_sku_key = vendor_code.lower()

            if normalized_sku_key not in temp_cache:
                description_el = offer.find('description')
                description = description_el.text.strip() if description_el is not None and description_el.text else ""
                pictures = [pic.text for pic in offer.findall('picture') if pic.text]

                temp_cache[normalized_sku_key] = {
                    'supplier_id': supplier_id,
                    'name': name_text,
                    'description': description,
                    'pictures': pictures,
                    'sku': vendor_code, # Оригінальний SKU
                    'base_price': price_text,
                    'final_price': calculate_final_price(price_text),
                    'offers': []
                }
                parsed_count += 1 # Рахуємо унікальні SKU

            param_el = offer.find(".//param[@name='Размер']")
            size = param_el.text.strip() if param_el is not None and param_el.text else "N/A"
            quantity_el = offer.find('quantity_in_stock')
            quantity = 0
            if quantity_el is not None and quantity_el.text:
                 try: quantity = int(quantity_el.text)
                 except ValueError: quantity = 0

            temp_cache[normalized_sku_key]['offers'].append({
                'offer_id': offer.attrib.get('id'),
                'size': size,
                'available': offer.attrib.get('available') == 'true' and quantity > 0,
                'quantity': quantity
            })

        _suppliers_caches[supplier_id] = temp_cache
        logger.info(f"Кеш '{supplier_id}' оновлено. Оброблено {parsed_count} унікальних SKU (пропущено {skipped_offers} offers).")
    except ET.ParseError as e: logger.error(f"Помилка парсингу XML {supplier_id}: {e}")
    except Exception as e: logger.error(f"Неочікувана помилка обробки XML {supplier_id}: {e}", exc_info=True)


async def get_combined_cache() -> Dict[str, Dict[str, Any]]:
    """Повертає ОБ'ЄДНАНИЙ кеш всіх постачальників."""
    if "landliz" not in _suppliers_caches or not _suppliers_caches["landliz"]:
         logger.info("Кеш 'landliz' порожній, спроба завантажити...")
         await load_and_parse_xml_data(supplier_id="landliz", xml_url=config.mydrop_export_url)

    combined: Dict[str, Dict[str, Any]] = {}
    for supplier_id, supplier_cache in _suppliers_caches.items():
        for sku_key, product_data in supplier_cache.items():
            final_sku_key = sku_key
            # Ускладнена логіка обробки конфліктів:
            # Якщо SKU вже є від іншого постачальника, використовуємо модифікований ключ
            if sku_key in combined and combined[sku_key]['supplier_id'] != supplier_id:
                final_sku_key = f"{sku_key}_{supplier_id}"
                logger.warning(f"Конфлікт SKU '{sku_key}'. Ключ '{final_sku_key}' для '{supplier_id}'.")
                product_data_copy = product_data.copy()
                # Зберігаємо оригінальний SKU всередині, а ключ робимо унікальним
                product_data_copy['original_sku_for_conflict'] = product_data_copy['sku']
                product_data_copy['sku'] = final_sku_key # Модифікуємо SKU для унікальності ключа
                combined[final_sku_key] = product_data_copy
            else:
                 # Якщо ключа нема або постачальник той самий, просто додаємо/оновлюємо
                 combined[sku_key] = product_data

    return combined

async def force_reload_products():
    """Примусово перезавантажує кеш для ВСІХ постачальників."""
    logger.info("Примусове оновлення кешів...")
    global _suppliers_caches
    _suppliers_caches = {}
    await load_and_parse_xml_data(supplier_id="landliz", xml_url=config.mydrop_export_url)
    # TODO: Додати перезавантаження для інших тут
    logger.info("Примусове оновлення кешів завершено.")

async def get_product_by_sku(sku: str) -> dict | None:
    """Шукає товар за SKU серед ВСІХ постачальників, враховуючи можливі конфлікти."""
    if not sku: return None
    cache = await get_combined_cache() # Працюємо з об'єднаним кешем
    normalized_sku_key = sku.strip().lower()

    # 1. Прямий пошук за нормалізованим ключем
    product = cache.get(normalized_sku_key)
    if product: return product

    # 2. Спроба без нулів (якщо цифри)
    if normalized_sku_key.isdigit():
        product = cache.get(str(int(normalized_sku_key)))
        if product: return product

    # 3. Пошук за модифікованим ключем (якщо є конфлікти)
    # Потрібно знати ID постачальників, щоб перебрати можливі ключі.
    # Це ускладнює пошук, можливо, краще змінити логіку об'єднання кешу.
    # Поки що пропускаємо цей крок.

    # 4. Пошук за оригінальним SKU всередині даних (повільніше)
    for product_data in cache.values():
         if product_data.get('sku', '').strip().lower() == normalized_sku_key:
              return product_data

    return None # Не знайдено


async def search_products(query: str) -> List[Dict[str, Any]]:
    """Шукає товари за запитом серед ВСІХ постачальників."""
    cache = await get_combined_cache()
    query_lower = query.lower().strip()
    results: List[Dict[str, Any]] = []

    # 1. Спробувати знайти точний SKU (використовуємо покращену функцію)
    exact_match = await get_product_by_sku(query)
    if exact_match:
        # Якщо знайдено точний SKU, повертаємо тільки його,
        # але переконуємось, що це не конфліктний ключ, якщо запит був числовий
        # Це складна логіка, поки що просто повертаємо знайдений
        return [exact_match]

    # 2. Пошук за входженням в назву або ОРИГІНАЛЬНИЙ SKU
    for product_data in cache.values(): # Ітеруємо по значеннях об'єднаного кешу
        name_lower = product_data.get('name', '').lower()
        # Шукаємо по полю 'sku', де зберігається оригінальний SKU (або модифікований при конфлікті)
        sku_field_lower = product_data.get('sku', '').lower()
        # Додатково шукаємо по 'original_sku_for_conflict', якщо він є
        original_conflict_sku = product_data.get('original_sku_for_conflict', '').lower()

        if query_lower in name_lower or query_lower in sku_field_lower or \
           (original_conflict_sku and query_lower in original_conflict_sku):
            results.append(product_data)

    return results

def start_xml_parsing_scheduler():
    """Запускає планувальник для періодичного оновлення кешу."""
    try:
        if not _scheduler.running:
            _scheduler.add_job(
                 load_and_parse_xml_data, 'interval', minutes=5,
                 args=["landliz", config.mydrop_export_url],
                 id='xml_update_landliz', misfire_grace_time=60
            )
            # TODO: Додати jobs для інших постачальників
            _scheduler.start()
            logger.info("✅ Планувальник XML-кешу запущено.")
    except Exception as e:
        logger.error(f"❌ Помилка запуску планувальника XML: {e}")

start_xml_parsing_scheduler()