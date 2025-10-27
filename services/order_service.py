# services/order_service.py
import logging
from datetime import datetime
from typing import Dict, Any
from collections import defaultdict
import os
from pathlib import Path

logger = logging.getLogger(__name__)

from config_reader import config

COUNTER_FILE = Path(config.orders_dir) / "order_counter.txt"

# --- Лічильник замовлень (без змін) ---
def _load_counter() -> int:
    try:
        if COUNTER_FILE.exists(): return int(COUNTER_FILE.read_text().strip())
    except Exception as e: logger.warning(f"Не вдалося завантажити лічильник: {e}")
    return 1
def _save_counter(value: int):
    try:
        COUNTER_FILE.parent.mkdir(parents=True, exist_ok=True)
        COUNTER_FILE.write_text(str(value))
    except Exception as e: logger.error(f"Не вдалося зберегти лічильник: {e}")
_order_counter = _load_counter()

# --- Імена постачальників (без змін) ---
SUPPLIER_NAMES: Dict[str, str] = {
    "landliz": "Landliz Drop", "unknown": "Невідомий",
}

# --- Форматування даних (без змін у логіці, лише покращення) ---
def get_pib_initials(full_name: str | None) -> str:
    if not full_name: return "CLIENT"
    try:
        parts = full_name.strip().split()
        if len(parts) >= 1:
            surname = parts[0].upper(); name_initial = parts[1][0].upper() if len(parts) > 1 else ""
            patronymic_initial = parts[2][0].upper() if len(parts) > 2 else ""
            result = surname
            if name_initial: result += f".{name_initial}."
            if patronymic_initial: result += f"{patronymic_initial}."
            return result.rstrip('.')
    except Exception: pass
    return "CLIENT"

def generate_order_id() -> str:
    global _order_counter; order_id = f"tav{_order_counter}"; _order_counter += 1; _save_counter(_order_counter)
    return order_id

def generate_order_filename(order_id: str, customer_name: str | None) -> str:
    initials = get_pib_initials(customer_name); date_str = datetime.now().strftime('%Y%m%d')
    return f"{order_id}_{initials}_{date_str}.txt"

def format_order_to_txt(order_data: Dict[str, Any]) -> str:
    cart = order_data.get('cart', {}); cart_items = cart.get("items", [])
    total_sum = sum(item.get('final_price', 0) * item.get('quantity', 0) for item in cart_items)

    items_by_supplier = defaultdict(list)
    for item in cart_items: items_by_supplier[item.get('supplier_id', 'unknown')].append(item)

    all_items_text = ""; supplier_names_in_order = []
    for supplier_id, items in items_by_supplier.items():
        supplier_name = SUPPLIER_NAMES.get(supplier_id, supplier_id.capitalize())
        supplier_names_in_order.append(supplier_name)
        all_items_text += f"\n--- ПОСТАЧАЛЬНИК: {supplier_name} ---\n"
        for i, item in enumerate(items, 1):
            price = item.get('final_price', 0); qty = item.get('quantity', 0); item_sum = qty * price
            display_sku = item.get('original_sku') or item.get('sku','?') # Пріоритет оригінальному SKU
            all_items_text += (
                 f"  {i}. {item.get('name','?')} (Арт: {display_sku})\n"
                 f"     Розмір: {item.get('size','?')}\n"
                 f"     К-сть: {qty} шт. x {price} грн\n"
                 f"     Сума: {item_sum} грн\n"
             )

    ttn_data = order_data.get('ttn', {}); ttn_text = ""
    if isinstance(ttn_data, dict):
        for sup_id, ttn_val in ttn_data.items():
            if ttn_val: # Показуємо тільки якщо ТТН є
                sup_name = SUPPLIER_NAMES.get(sup_id, sup_id)
                ttn_text += f"  TTH ({sup_name}): {ttn_val}\n"
    elif isinstance(ttn_data, str): ttn_text = f"TTH: {ttn_data}\n"

    main_supplier_display = ", ".join(supplier_names_in_order) if supplier_names_in_order else "Не вказано"

    summary = f"""
========================================
ЗАМОВЛЕННЯ: {order_data.get('order_id', 'N/A')}
ДАТА: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
ПОСТАЧАЛЬНИКИ: {main_supplier_display}
========================================

КЛІЄНТ:
  ПІБ: {order_data.get('customer_name', 'N/A')}
  Телефон: {order_data.get('customer_phone', 'N/A')}

ДОСТАВКА:
  Служба: {order_data.get('delivery_service', 'N/A')}
  Місто: {order_data.get('delivery_city_name', 'N/A')}
  Відділення/Адреса: {order_data.get('delivery_warehouse', 'N/A')}
{ttn_text.strip()}

ОПЛАТА:
  Спосіб: {order_data.get('payment_display_name', 'N/A')}

ПРИМІТКА:
  {order_data.get('notes', 'немає')}

ТОВАРИ:
{all_items_text}
========================================
ЗАГАЛЬНА СУМА: {total_sum} грн
========================================
"""
    return summary.strip()