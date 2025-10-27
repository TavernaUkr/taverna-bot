# services/mydrop_service.py
import logging
import aiohttp
import random
import asyncio
from typing import Dict, Any, List
from collections import defaultdict

from config_reader import config
from services.order_service import SUPPLIER_NAMES

logger = logging.getLogger(__name__)

async def create_order(order_data: Dict[str, Any]) -> Dict[str, Any]:
    """Формує та відправляє замовлення на API MyDrop для КОЖНОГО постачальника."""
    # TODO: Завантажувати API конфіг з БД/конфігу
    SUPPLIER_API_CONFIG = {
        "landliz": {"api_key": config.mydrop_api_key, "orders_url": config.mydrop_orders_url}
    }

    cart = order_data.get('cart', {}); cart_items = cart.get("items", [])
    if not cart_items: return {"success": False, "message": "Кошик порожній."}

    items_by_supplier = defaultdict(list)
    for item in cart_items: items_by_supplier[item.get('supplier_id', 'unknown')].append(item)

    results: Dict[str, Dict[str, Any]] = {}
    all_ttns: Dict[str, str | None] = {} # Змінено тип значення

    async with aiohttp.ClientSession() as session:
        tasks = []
        for supplier_id, supplier_items in items_by_supplier.items():
            tasks.append(asyncio.create_task(
                _send_order_to_supplier(session, supplier_id, supplier_items, order_data, SUPPLIER_API_CONFIG)
            ))
        supplier_results = await asyncio.gather(*tasks)
        for res in supplier_results:
            if res:
                sup_id = res.get("supplier_id")
                results[sup_id] = res
                if res.get("ttn"): all_ttns[sup_id] = res["ttn"]
                else: all_ttns[sup_id] = None # Явно вказуємо, що ТТН немає

    final_success = all(res.get("success") for res in results.values())
    # Повертаємо словник ТТН, а не тільки перший
    return {"success": final_success, "message": "Обробка завершена.", "ttn": all_ttns, "details": results}

async def _send_order_to_supplier(
    session: aiohttp.ClientSession, supplier_id: str, supplier_items: List[Dict[str, Any]],
    order_data: Dict[str, Any], api_config: Dict[str, Dict[str, str | None]]
) -> Dict[str, Any] | None:
    """Внутрішня функція для відправки замовлення ОДНОМУ постачальнику."""
    supplier_config = api_config.get(supplier_id)
    supplier_name = SUPPLIER_NAMES.get(supplier_id, supplier_id)

    if not supplier_config or not supplier_config.get('api_key') or not supplier_config.get('orders_url'):
        logger.error(f"MyDrop API не налаштовано для {supplier_name} ({supplier_id})")
        return {"supplier_id": supplier_id, "success": False, "message": "API не налаштовано"}

    current_api_key = supplier_config['api_key']; current_orders_url = supplier_config['orders_url']
    products_payload = [{"offer_id": item.get("offer_id"), "amount": item.get("quantity")} for item in supplier_items]
    # Формуємо shipping_address більш надійно
    shipping_address_parts = [
        order_data.get('delivery_city_name', ''),
        order_data.get('delivery_warehouse', '').replace("Кур'єр: ", "") # Прибираємо префікс
    ]
    shipping_address = ", ".join(filter(None, shipping_address_parts)) # Об'єднуємо тільки не порожні частини

    payload = {
        "name": order_data.get("customer_name"), "phone": order_data.get("customer_phone"),
        "products": products_payload, "shipping_address": shipping_address,
        "shipping_service": order_data.get('delivery_service'),
        "description": order_data.get('notes', ''),
        "client_order_id": order_data.get("order_id")
        # TODO: Додати payment_type (cod, full_prepayment, partial_prepayment)
    }
    headers = {"X-API-KEY": current_api_key, "Content-Type": "application/json"}

    # --- РЕЖИМ СИМУЛЯЦІЇ ---
    logger.info(f"--- СИМУЛЯЦІЯ MYDROP для {supplier_name} ---"); logger.info(f"Payload: {payload}")
    simulated_ttn = f"204510{random.randint(1000000, 9999999)}" if order_data.get('payment_method') == 'full' else None
    if simulated_ttn: logger.info(f"Імітація ТТН ({supplier_name}): {simulated_ttn}")
    return {"supplier_id": supplier_id, "success": True, "message": f"Створено (симуляція)", "ttn": simulated_ttn}
    # --- /РЕЖИМ СИМУЛЯЦІЇ ---

    # --- РЕАЛЬНИЙ КОД ---
    # try:
    #     async with session.post(current_orders_url, json=payload, headers=headers, timeout=30) as response:
    #         response_data = await response.json(); status = response.status
    #         if 200 <= status < 300:
    #             logger.info(f"MyDrop {supplier_name} ({supplier_id}): Замовлення створено: {response_data}")
    #             created_ttn = response_data.get("shipping_ref") # Уточнити поле
    #             return {"supplier_id": supplier_id, "success": True, "data": response_data, "ttn": created_ttn}
    #         else:
    #             logger.error(f"Помилка MyDrop {supplier_name} ({status}): {response_data}")
    #             return {"supplier_id": supplier_id, "success": False, "message": response_data.get('message')}
    # except asyncio.TimeoutError: logger.error(f"Таймаут MyDrop {supplier_name}"); return {"supplier_id": supplier_id, "success": False, "message": "Таймаут"}
    # except Exception as e: logger.error(f"Помилка MyDrop {supplier_name}: {e}"); return {"supplier_id": supplier_id, "success": False, "message": "Помилка сервера"}