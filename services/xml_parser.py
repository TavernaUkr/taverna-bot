import logging
import xml.etree.ElementTree as ET
from decimal import Decimal, ROUND_HALF_UP
import aiohttp

# Імпортуємо наш централізований конфіг
from config_reader import config

# Налаштовуємо логер
logger = logging.getLogger(__name__)

# Створюємо "приватний" кеш на рівні модуля.
_products_cache = {}

# ‼️ ВИДАЛЕНО НЕПОТРІБНИЙ РЯДОК, ЩО ВИКЛИКАВ ПОМИЛКУ ‼️

# --- Функції для роботи з цінами (перенесено з вашого коду) ---

def _aggressive_rounding(price: Decimal) -> int:
    """Агресивне округлення ціни до найближчого числа, кратного 5 або 10."""
    if price < 100:
        return int(5 * round(price / 5))
    last_digit = int(price % 10)
    if last_digit in [1, 2, 6, 7]:
        return int(price - last_digit)
    elif last_digit in [3, 4, 8, 9]:
        return int(price + (10 - last_digit))
    return int(price)

def calculate_final_price(base_price_str: str) -> int:
    """Розраховує фінальну ціну з націнкою +33% та агресивним округленням."""
    try:
        base_price = Decimal(base_price_str)
        final_price = base_price * Decimal('1.33')
        return _aggressive_rounding(final_price)
    except (ValueError, TypeError):
        return 0

# --- Основна логіка завантаження та парсингу ---

async def load_and_parse_xml_data():
    """
    Асинхронно завантажує XML-файл, парсить його та заповнює кеш товарів.
    """
    global _products_cache
    if not config.mydrop_export_url:
        logger.error("URL для експорту товарів (MYDROP_EXPORT_URL) не вказано.")
        return

    logger.info("Починаю завантаження та парсинг XML-файлу з товарами...")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(config.mydrop_export_url) as response:
                response.raise_for_status() # Перевірка на помилки HTTP (4xx, 5xx)
                xml_content = await response.read()
                
    except aiohttp.ClientError as e:
        logger.error(f"Помилка завантаження XML-файлу: {e}")
        return

    temp_cache = {}
    root = ET.fromstring(xml_content)
    offers = root.findall('.//offer')
    logger.info(f"Знайдено {len(offers)} пропозицій (offers) у файлі.")

    for offer in offers:
        vendor_code_element = offer.find('vendorCode')
        if vendor_code_element is None or not vendor_code_element.text:
            continue
        vendor_code = vendor_code_element.text.strip()

        # Якщо товару з таким артикулом ще немає, створюємо для нього запис
        if vendor_code not in temp_cache:
            temp_cache[vendor_code] = {
                'name': offer.find('name').text.strip(),
                'description': offer.find('description').text.strip() if offer.find('description') is not None and offer.find('description').text is not None else "",
                'pictures': [pic.text for pic in offer.findall('picture')],
                'sku': vendor_code,
                'base_price': offer.find('price').text.strip(),
                'final_price': calculate_final_price(offer.find('price').text.strip()),
                'offers': [] # Список для розмірів/кольорів
            }
        
        # Додаємо унікальну пропозицію (розмір/колір) до товару
        param_name_element = offer.find(".//param[@name='Размер']")
        param_name = param_name_element.text.strip() if param_name_element is not None and param_name_element.text is not None else "N/A"
        
        temp_cache[vendor_code]['offers'].append({
            'offer_id': offer.attrib['id'],
            'size': param_name,
            'available': offer.attrib.get('available') == 'true'
        })
    
    _products_cache = temp_cache
    logger.info(f"Кеш успішно оновлено. Завантажено {len(_products_cache)} унікальних товарів.")

# --- Публічні функції для доступу до даних (API модуля) ---

async def get_products_cache() -> dict:
    """
    "Ліниво" завантажує кеш, якщо він порожній, і повертає його.
    Це основна функція для доступу до даних.
    """
    if not _products_cache:
        await load_and_parse_xml_data()
    return _products_cache

async def force_reload_products():
    """Примусово очищує та перезавантажує кеш товарів."""
    logger.info("Примусове оновлення кешу товарів...")
    global _products_cache
    _products_cache = {}
    await load_and_parse_xml_data()

async def get_product_by_sku(sku: str) -> dict | None:
    """
    Знаходить та повертає один товар за його артикулом (SKU).
    """
    cache = await get_products_cache()
    return cache.get(sku)

async def search_products(query: str) -> list[dict]:
    """
    Шукає товари, назва або артикул яких містить пошуковий запит.
    """
    cache = await get_products_cache()
    query = query.lower().strip()
    
    # Спочатку шукаємо точне співпадіння по артикулу
    if query in cache:
        return [cache[query]]

    # Потім шукаємо по частині назви або артикула
    results = []
    for product in cache.values():
        if query in product['name'].lower() or query in product['sku'].lower():
            results.append(product)
    
    return results
