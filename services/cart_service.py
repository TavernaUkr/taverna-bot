# services/cart_service.py
import logging
import json
import redis.asyncio as aioredis
from typing import List, Dict, Any, Tuple, Optional
from datetime import timedelta
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from config_reader import config
from services import xml_parser 
from database.models import ProductVariant, ProductOptionValue, ProductOption
from database.db import AsyncSessionLocal

logger = logging.getLogger(__name__)

CART_TTL_SECONDS = int(timedelta(minutes=20).total_seconds())

try:
    redis_client = aioredis.from_url(
        str(config.redis_url), 
        encoding="utf-8", 
        decode_responses=True
    )
    logger.info("Підключено до Redis для сервісу кошика.")
except Exception as e:
    logger.error(f"Не вдалося підключитися до Redis: {e}")
    redis_client = None

def _get_cart_key(user_id: int) -> str:
    return f"cart:{user_id}"

async def add_item_to_cart(user_id: int, variant_offer_id: str, quantity: int) -> Tuple[bool, dict]:
    """
    (Оновлено для Фази 4.3)
    Додає товар, supplier_id та drop_price у кошик.
    """
    if not redis_client:
        return False, {"message": "Redis connection error"}
        
    key = _get_cart_key(user_id)
    
    # 1. Отримуємо актуальні дані про товар з БД (включаючи продукт та постачальника)
    variant: Optional[ProductVariant] = await xml_parser.get_variant_by_offer_id(variant_offer_id)
    
    if not variant or not variant.product or not variant.product.supplier:
        logger.warning(f"Не вдалося додати в кошик: варіант {variant_offer_id} не знайдено в БД.")
        return False, {"message": "Variant not found"}
        
    if not variant.is_available:
        return False, {"message": "Товар не в наявності"}
    
    # 2. Отримуємо існуючий кошик
    current_quantity_in_cart = 0
    if await redis_client.hexists(key, variant_offer_id):
        try:
            item_data_raw = await redis_client.hget(key, variant_offer_id)
            current_quantity_in_cart = json.loads(item_data_raw).get("quantity", 0)
        except Exception:
            pass 

    new_quantity = current_quantity_in_cart + quantity
    
    if new_quantity > variant.quantity:
        return False, {"message": f"Недостатньо товару (макс: {variant.quantity})"}

    # 3. Формуємо гнучкий опис опцій
    full_variant: Optional[ProductVariant] = await xml_parser.get_variant_with_options(variant.id)
    options_text = "N/A"
    if full_variant and full_variant.option_values:
        options_text = ", ".join(
            f"{ov.option.name}: {ov.value}" for ov in full_variant.option_values
        )
    
    # 4. Готуємо дані для збереження в Redis (з ДОДАНИМИ полями)
    item_data = {
        "quantity": new_quantity,
        "variant_offer_id": variant_offer_id,
        "variant_db_id": variant.id, # <-- НОВЕ (Для зв'язку в БД)
        "product_id": variant.product_id,
        "supplier_id": variant.product.supplier_id, # <-- НОВЕ (Для "Spooler-а")
        "name": variant.product.name,
        "sku": variant.product.sku,
        "options_text": options_text,
        "price": variant.final_price, # Ціна клієнта (+33%)
        "drop_price": int(variant.base_price), # <-- НОВЕ (Дроп-ціна для "Spooler-а")
        "image_url": variant.product.pictures[0] if variant.product.pictures else None,
        "max_quantity": variant.quantity # Зберігаємо макс. кількість
    }
    
    try:
        await redis_client.hset(key, variant_offer_id, json.dumps(item_data))
        await redis_client.expire(key, CART_TTL_SECONDS)
        
        logger.info(f"Користувач {user_id}: додано/оновлено товар {variant_offer_id}")
        
        cart_items, total_price = await get_cart_contents(user_id)
        return True, {
            "success": True, 
            "message": "Item added", 
            "cart": {"items": cart_items, "total_price": total_price}
        }
        
    except Exception as e:
        logger.error(f"Помилка Redis (hset/expire) для user {user_id}: {e}", exc_info=True)
        return False, {"message": f"Redis error: {e}"}

# ... (решта файлу: get_cart_contents, update_item_quantity, remove_item_from_cart, clear_cart) ...
# ... (вони вже готові і будуть працювати з новими даними в JSON) ...
async def get_cart_contents(user_id: int) -> Tuple[List[Dict[str, Any]], int]:
    if not redis_client: return [], 0
    key = _get_cart_key(user_id)
    cart_items = []
    total_price = 0
    try:
        cart_data_raw = await redis_client.hgetall(key)
        for item_json in cart_data_raw.values():
            try:
                item = json.loads(item_json)
                item_quantity = int(item.get("quantity", 0))
                item_price = int(item.get("price", 0))
                item["total_item_price"] = item_price * item_quantity
                cart_items.append(item)
                total_price += item["total_item_price"]
            except (json.JSONDecodeError, TypeError, ValueError):
                logger.warning(f"Не вдалося розпарсити дані кошика для user {user_id}: {item_json}")
        return cart_items, total_price
    except Exception as e:
        logger.error(f"Помилка Redis (hgetall) для user {user_id}: {e}", exc_info=True)
        return [], 0

async def update_item_quantity(user_id: int, variant_offer_id: str, new_quantity: int) -> Tuple[bool, dict]:
    if not redis_client: return False, {"message": "Redis error"}
    key = _get_cart_key(user_id)
    if new_quantity <= 0:
        return await remove_item_from_cart(user_id, variant_offer_id)
    try:
        item_data_raw = await redis_client.hget(key, variant_offer_id)
        if not item_data_raw:
            return False, {"message": "Item not in cart"}
        item_data = json.loads(item_data_raw)
        
        max_quantity = item_data.get("max_quantity", 0) 
        if new_quantity > max_quantity:
            return False, {"message": f"Not enough stock (max: {max_quantity})"}
            
        item_data["quantity"] = new_quantity
        
        await redis_client.hset(key, variant_offer_id, json.dumps(item_data))
        await redis_client.expire(key, CART_TTL_SECONDS)
        
        cart_items, total_price = await get_cart_contents(user_id)
        return True, {
            "success": True, 
            "message": "Quantity updated", 
            "cart": {"items": cart_items, "total_price": total_price}
        }
    except Exception as e:
        logger.error(f"Помилка Redis (update_item_quantity) для user {user_id}: {e}", exc_info=True)
        return False, {"message": f"Redis error: {e}"}

async def remove_item_from_cart(user_id: int, variant_offer_id: str) -> Tuple[bool, dict]:
    if not redis_client: return False, {"message": "Redis error"}
    key = _get_cart_key(user_id)
    try:
        await redis_client.hdel(key, variant_offer_id)
        logger.info(f"Користувач {user_id}: видалено товар {variant_offer_id} з кошика.")
        cart_items, total_price = await get_cart_contents(user_id)
        return True, {
            "success": True, 
            "message": "Item removed", 
            "cart": {"items": cart_items, "total_price": total_price}
        }
    except Exception as e:
        logger.error(f"Помилка Redis (hdel) для user {user_id}: {e}", exc_info=True)
        return False, {"message": f"Redis error: {e}"}

async def clear_cart(user_id: int) -> bool:
    if not redis_client: return False
    key = _get_cart_key(user_id)
    try:
        await redis_client.delete(key)
        logger.info(f"Користувач {user_id}: кошик очищено.")
        return True
    except Exception as e:
        logger.error(f"Помилка Redis (delete) для user {user_id}: {e}", exc_info=True)
        return False