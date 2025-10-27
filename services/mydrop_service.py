# services/mydrop_service.py
import logging
import aiohttp
import random
import asyncio # Додаємо asyncio
from typing import Dict, Any
from collections import defaultdict

from config_reader import config
from services.order_service import SUPPLIER_NAMES

logger = logging.getLogger(__name__)

async def create_order(order_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Формує та відправляє замовлення на API MyDrop для КОЖНОГО постачальника.
    """
    # TODO: Завантажувати налаштування API з БД/конфігу
    SUPPLIER_API_CONFIG = {
        "landliz": {
            "api_key": config.mydrop_api_key,
            "orders_url": config.mydrop_orders_url
        }
    }

    cart = order_data.get('cart', {}); cart_items = cart.get("items", [])
    if not cart_items: return {"success": False, "message": "Кошик порожній."}

    items_by_supplier = defaultdict(list)
    for item in cart_items: items_by_supplier[item.get('supplier_id', 'unknown')].append(item)

    results: Dict[str, Dict[str, Any]] = {}
    all_ttns: Dict[str, str] = {}

    async with aiohttp.ClientSession() as session:
        tasks = []
        for supplier_id, supplier_items in items_by_supplier.items():
             # Створюємо асинхронне завдання для кожного постачальника
            tasks.append(
                asyncio.create_task(
                    _send_order_to_supplier(
                        session, supplier_id, supplier_items, order_data, SUPPLIER_API_CONFIG
                    )
                )
            )
        # Очікуємо завершення всіх завдань
        supplier_results = await asyncio.gather(*tasks)

        # Збираємо результати
        for res in supplier_results:
            if res: # Якщо завдання не повернуло None (у разі помилки конфігурації)
                sup_id = res.get("supplier_id")
                results[sup_id] = res
                if res.get("ttn"): all_ttns[sup_id] = res["ttn"]

    final_success = all(res.get("success") for res in results.values())
    first_ttn = next(iter(all_ttns.values()), None) # Залишаємо для зворотної сумісності

    return {
        "success": final_success,
        "message": "Обробка завершена.",
        "ttn": all_ttns, # Повертаємо словник {supplier_id: ttn}
        "details": results
    }

async def _send_order_to_supplier(
    session: aiohttp.ClientSession,
    supplier_id: str,
    supplier_items: List[Dict[str, Any]],
    order_data: Dict[str, Any],
    api_config: Dict[str, Dict[str, str | None]]
) -> Dict[str, Any] | None:
    """Внутрішня функція для відправки замовлення ОДНОМУ постачальнику."""
    supplier_config = api_config.get(supplier_id)
    supplier_name = SUPPLIER_NAMES.get(supplier_id, supplier_id)

    if not supplier_config or not supplier_config.get('api_key') or not supplier_config.get('orders_url'):
        logger.error(f"MyDrop API не налаштовано для {supplier_name} ({supplier_id})")
        return {"supplier_id": supplier_id, "success": False, "message": f"API не налаштовано"}

    current_api_key = supplier_config['api_key']
    current_orders_url = supplier_config['orders_url']

    products_payload = [{"offer_id": item.get("offer_id"), "amount": item.get("quantity")} for item in supplier_items]
    payload = {
        "name": order_data.get("customer_name"),
        "phone": order_data.get("customer_phone"),
        "products": products_payload,
        "shipping_address": f"{order_data.get('delivery_city_name', '')}, {order_data.get('delivery_warehouse', '')}",
        "shipping_service": order_data.get('delivery_service'),
        "description": order_data.get('notes', ''),
        "client_order_id": order_data.get("order_id")
        # TODO: Додати тип оплати
    }
    headers = {"X-API-KEY": current_api_key, "Content-Type": "application/json"}

    # --- РЕЖИМ СИМУЛЯЦІЇ ---
    logger.info(f"--- СИМУЛЯЦІЯ MYDROP для {supplier_name} ---"); logger.info(f"Payload: {payload}")
    simulated_ttn = f"204510{random.randint(1000000, 9999999)}" if order_data.get('payment_method') == 'full' else None
    if simulated_ttn: logger.info(f"Імітація ТТН ({supplier_name}): {simulated_ttn}")
    return {"supplier_id": supplier_id, "success": True, "message": f"Створено (симуляція)", "ttn": simulated_ttn}
    # --- /РЕЖИМ СИМУЛЯЦІЇ ---

            # --- РЕАЛЬНИЙ КОД (закоментовано до запуску) ---
            # try:
            #     async with session.post(current_orders_url, json=payload, headers=headers, timeout=30) as response:
            #         response_data = await response.json()
            #         if 200 <= response.status < 300: # Успішне створення
            #             logger.info(f"Замовлення {supplier_name} ({supplier_id}) створено в MyDrop: {response_data}")
            #             # TODO: Отримати ТТН з response_data, якщо він там є
            #             created_ttn = response_data.get("shipping_ref") # Приклад, уточнити назву поля
            #             results[supplier_id] = {"success": True, "data": response_data, "ttn": created_ttn}
            #             if created_ttn: all_ttns[supplier_id] = created_ttn
            #         else:
            #             logger.error(f"Помилка MyDrop API {supplier_name} ({response.status}): {response_data}")
            #             results[supplier_id] = {"success": False, "message": response_data.get('message')}
            # except asyncio.TimeoutError:
            #      logger.error(f"Таймаут запиту до MyDrop API для {supplier_name}")
            #      results[supplier_id] = {"success": False, "message": "Таймаут запиту до MyDrop."}
            # except aiohttp.ClientError as e:
            #     logger.error(f"Помилка з'єднання з MyDrop API {supplier_name}: {e}")
            #     results[supplier_id] = {"success": False, "message": str(e)}
            # except Exception as e:
            #      logger.error(f"Неочікувана помилка MyDrop API {supplier_name}: {e}", exc_info=True)
            #      results[supplier_id] = {"success": False, "message": "Внутрішня помилка сервера."}
            # --- /РЕАЛЬНИЙ КОД ---

    # Повертаємо загальний результат та словник ТТН
    final_success = all(res.get("success") for res in results.values()) # Успіх, якщо ВСІ успішні

    return {
        "success": final_success,
        "message": "Обробка завершена.",
        "ttn": all_ttns, # Повертаємо словник {supplier_id: ttn}
        "details": results # Деталі по кожному постачальнику
    }