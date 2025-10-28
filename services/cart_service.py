# services/cart_service.py
import logging
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
import uuid
from typing import Dict, Any, List

from config_reader import config
from services import xml_parser

logger = logging.getLogger(__name__)

CART_TTL_MINUTES = 20
CARTS_DIR = Path(config.orders_dir) / "user_carts"
CARTS_DIR.mkdir(parents=True, exist_ok=True)

# --- Приватні функції (без змін) ---
def _get_cart_filepath(user_id: int) -> Path: return CARTS_DIR / f"cart_{user_id}.json"

def _read_cart_file(user_id: int) -> dict | None:
    filepath = _get_cart_filepath(user_id)
    if not filepath.exists(): return None
    try:
        with open(filepath, 'r', encoding='utf-8') as f: cart_data = json.load(f)
        last_modified_str = cart_data.get("last_modified")
        if not last_modified_str:
             logger.warning(f"Кошик {user_id} без дати. Видаляю."); clear_cart(user_id); return None
        last_modified = datetime.fromisoformat(last_modified_str)
        if datetime.now() - last_modified > timedelta(minutes=CART_TTL_MINUTES):
            logger.info(f"Кошик {user_id} застарів. Видаляю."); clear_cart(user_id); return None
        if "items" not in cart_data or not isinstance(cart_data["items"], list): cart_data["items"] = []
        return cart_data
    except (json.JSONDecodeError, ValueError, IOError) as e:
         logger.error(f"Помилка читання/парсингу кошика {user_id}: {e}"); return None

def _write_cart_file(user_id: int, cart_data: Dict[str, Any]):
    filepath = _get_cart_filepath(user_id); cart_data["last_modified"] = datetime.now().isoformat()
    try:
        with open(filepath, 'w', encoding='utf-8') as f: json.dump(cart_data, f, ensure_ascii=False, indent=4)
    except IOError as e: logger.error(f"Помилка запису кошика {user_id}: {e}")

# --- Публічні функції (ОНОВЛЕНО add_item, update_item) ---

async def add_item(user_id: int, sku: str, offer_id: str, quantity: int) -> dict | None:
    """Додає товарну позицію до кошика, зберігаючи supplier_id."""
    cart_data = _read_cart_file(user_id) or {"items": []}
    product = await xml_parser.get_product_by_sku(sku)
    if not product: logger.warning(f"Кошик {user_id}: Не знайдено SKU {sku}"); return None
    offer_info = next((o for o in product.get('offers', []) if o.get('offer_id') == offer_id), None)
    if not offer_info: logger.warning(f"Кошик {user_id}: Не знайдено offer {offer_id} для SKU {sku}"); return None
    # Перевіряємо наявність перед додаванням
    if not offer_info.get('available'):
         logger.warning(f"Кошик {user_id}: Спроба додати недоступний offer {offer_id} (SKU: {sku})")
         # Можна повертати помилку або спеціальний статус
         return {"error": "not_available", "message": "Цей розмір наразі недоступний."}

    item_id = str(uuid.uuid4())
    cart_data["items"].append({
        'item_id': item_id, 'sku': product.get('sku'), 'original_sku': sku,
        'offer_id': offer_id, 'quantity': quantity, 'name': product.get('name', '?'),
        'size': offer_info.get('size', 'N/A'), 'final_price': product.get('final_price', 0),
        'supplier_id': product.get('supplier_id', 'unknown')
    })
    _write_cart_file(user_id, cart_data)
    logger.info(f"Кошик {user_id}: Додано {product.get('sku')} ({product.get('supplier_id')})")
    return cart_data

async def get_cart(user_id: int) -> Dict[str, List[Dict[str, Any]]]:
    data = _read_cart_file(user_id)
    return data if data and "items" in data and isinstance(data["items"], list) else {"items": []}

def clear_cart(user_id: int):
    filepath = _get_cart_filepath(user_id)
    if filepath.exists(): 
        try: 
            os.remove(filepath); 
            logger.info(f"Кошик {user_id} очищено.") 
        except OSError as e: 
            logger.error(f"Помилка видалення кошика {user_id}: {e}")

def remove_item(user_id: int, item_id: str):
    cart_data = _read_cart_file(user_id)
    if not cart_data or "items" not in cart_data: return
    original_len = len(cart_data["items"])
    cart_data["items"] = [item for item in cart_data["items"] if item.get('item_id') != item_id]
    if len(cart_data["items"]) < original_len:
        _write_cart_file(user_id, cart_data); logger.info(f"Кошик {user_id}: Видалено {item_id}.")
    else: logger.warning(f"Кошик {user_id}: Не знайдено {item_id} для видалення.")

async def update_item(user_id: int, item_id: str, new_quantity: int | None = None, new_offer_id: str | None = None) -> dict | None:
    cart_data = _read_cart_file(user_id)
    if not cart_data or "items" not in cart_data: return None
    item_found_and_updated = False
    for item in cart_data["items"]:
        if item.get('item_id') == item_id:
            updated_locally = False
            if new_quantity is not None and new_quantity > 0:
                item['quantity'] = new_quantity; logger.info(f"Кошик {user_id}: Оновлено к-сть {item_id} -> {new_quantity}."); updated_locally = True
            if new_offer_id is not None and new_offer_id != item.get('offer_id'):
                product_sku = item.get('sku')
                product = await xml_parser.get_product_by_sku(product_sku)
                if product:
                    new_offer = next((o for o in product.get('offers', []) if o.get('offer_id') == new_offer_id), None)
                    if new_offer and new_offer.get('available'):
                        item['offer_id'] = new_offer_id; item['size'] = new_offer.get('size', 'N/A')
                        item['supplier_id'] = product.get('supplier_id', item.get('supplier_id'))
                        item['sku'] = product.get('sku', item.get('sku'))
                        logger.info(f"Кошик {user_id}: Оновлено розмір {item_id} -> {new_offer.get('size')}.")
                        updated_locally = True
                    elif new_offer: logger.warning(f"Кошик {user_id}: Новий offer {new_offer_id} для {item_id} НЕ доступний.")
                    else: logger.warning(f"Кошик {user_id}: Не знайдено новий offer {new_offer_id} для {item_id}.")
                else: logger.warning(f"Кошик {user_id}: Не знайдено продукт {product_sku} для оновлення offer.")
            if updated_locally: item_found_and_updated = True; break
    if item_found_and_updated: _write_cart_file(user_id, cart_data); return cart_data
    else: logger.warning(f"Кошик {user_id}: Не знайдено/оновлено {item_id}."); return None