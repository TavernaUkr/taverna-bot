# services/mydrop_service.py
import logging
import aiohttp
import json
from typing import Dict, Any, List, Optional

from config_reader import config

logger = logging.getLogger(__name__)

async def send_order_to_mydrop(fsm_data: dict, cart_items: List[dict]) -> Optional[dict]:
    """
    Формує та відправляє замовлення в MyDrop API.
    Повертає відповідь від API (dict) у разі успіху, або None.
    """
    if not config.mydrop_api_key or not config.mydrop_orders_url:
        logger.error("MyDrop API key або URL не налаштовано. Відправка неможлива.")
        return None

    # 1. Форматуємо масив товарів (products)
    api_products = []
    for item in cart_items:
        api_products.append({
            "vendor_name": config.supplier_name, # Назва постачальника (з .env)
            "product_title": item.get("name"),
            "sku": item.get("sku"),
            "price": item.get("price"), # "ціна продажу" (final_price)
            "amount": item.get("quantity"),
            "size_title": item.get("size")
        })

    # 2. Форматуємо тіло запиту
    payload = {
        "name": fsm_data.get("pib"),
        "phone": fsm_data.get("phone"),
        "delivery_service": fsm_data.get("delivery_service"),
        "city": fsm_data.get("address"), # TODO: Потрібно розділити місто та відділення
        "warehouse_number": fsm_data.get("address"), # TODO: Потрібно розділити
        "description": fsm_data.get("note", ""),
        "products": api_products,
        "order_source": "Telegram Bot (Taverna)" # Джерело замовлення
    }
    
    # Додаємо тип оплати
    if fsm_data.get("payment_type") == "cod":
        # 'cod' = Накладений платіж
        pass # MyDrop за замовчуванням обробляє це як наложку
    elif fsm_data.get("payment_type") == "prepaid":
        # 'prepaid' = Передоплата
        # TODO: Додати логіку для передоплати, якщо API це вимагає
        payload["prepayAmount"] = fsm_data.get("total_price", 0) # Приклад

    headers = {
        "X-API-KEY": config.mydrop_api_key,
        "Content-Type": "application/json"
    }

    logger.debug(f"Відправка замовлення в MyDrop: {json.dumps(payload, ensure_ascii=False)}")

    # 3. Відправляємо запит
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                config.mydrop_orders_url, 
                json=payload, 
                headers=headers, 
                timeout=30
            ) as resp:
                
                response_text = await resp.text()
                
                if resp.status == 201 or resp.status == 200:
                    logger.info(f"Замовлення успішно створено в MyDrop. Відповідь: {response_text}")
                    return await resp.json()
                else:
                    logger.error(f"Помилка MyDrop API (Status: {resp.status}): {response_text}")
                    return None
                    
    except asyncio.TimeoutError:
        logger.error("Таймаут запиту до MyDrop API.")
        return None
    except aiohttp.ClientError as e:
        logger.error(f"Помилка клієнта aiohttp (MyDrop): {e}", exc_info=True)
        return None
    except Exception as e:
        logger.error(f"Неочікувана помилка (MyDrop): {e}", exc_info=True)
        return None