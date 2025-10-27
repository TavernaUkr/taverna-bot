# keyboards/inline_keyboards.py
import re
from typing import List
from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram.filters.callback_data import CallbackData
from aiogram.types import InlineKeyboardMarkup

# Імпортуємо FSM, щоб кнопка "Назад" знала, куди повертатись
from fsm import order_states
from config_reader import config

# --- Фабрики CallbackData ---
class ProductCallback(CallbackData, prefix="prod"):
    action: str
    sku: str
    offer_id: str

class CartCallback(CallbackData, prefix="cart"):
    action: str
    item_id: str | None = None

class NavigationCallback(CallbackData, prefix="nav"):
    action: str

class OrderCallback(CallbackData, prefix="order"):
    action: str
    order_id: str | None = None

class PaymentCallback(CallbackData, prefix="payment"):
    method: str

# НОВА Фабрика для кнопки "Назад"
class BackCallback(CallbackData, prefix="back"):
    to: str # Назва стану FSM або спец. маркер ('main_menu', 'previous_delivery_step')

# --- Клавіатури ---

def get_main_menu_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="🛍️ Вибрати товар на каналі", url=config.main_channel_url)
    builder.button(text="🔎 Знайти товар по назві/артикулу", callback_data=NavigationCallback(action="start_search").pack())
    builder.button(text="🛒 Мій кошик", callback_data=CartCallback(action="show").pack())
    builder.adjust(1)
    return builder.as_markup()

def get_product_card_keyboard(product: dict) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    available_offers = [offer for offer in product.get('offers', []) if offer.get('available')]
    numeric_sizes, text_sizes = [], []
    for offer in available_offers:
        size = offer.get('size', 'N/A')
        numeric_part_match = re.match(r'^(\d+)', size)
        if numeric_part_match:
            numeric_sizes.append((int(numeric_part_match.group(1)), size, offer.get('offer_id')))
        else:
            text_sizes.append((size, offer.get('offer_id')))
    numeric_sizes.sort(); text_sizes.sort()
    sorted_offers = [(size, offer_id) for _, size, offer_id in numeric_sizes] + text_sizes
    for size, offer_id in sorted_offers:
        callback_data = ProductCallback(action='select_size', sku=product['sku'], offer_id=offer_id).pack()
        builder.button(text=size, callback_data=callback_data)
    builder.adjust(3)
    # ЗМІНЕНО: Кнопка Назад веде в головне меню
    builder.row(builder.button(text="⬅️ До головного меню", callback_data=BackCallback(to='main_menu').pack()))
    return builder.as_markup()


def get_cart_view_keyboard(cart_items: List[dict]) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    total_sum = sum(item.get('final_price', 0) * item.get('quantity', 1) for item in cart_items)
    if cart_items:
        for item in cart_items:
            item_id = item.get('item_id'); item_text = f"⚙️ {item.get('name')} ({item.get('size')})"
            builder.button(text=item_text, callback_data="do_nothing") # Placeholder
            builder.row(
                builder.button(text="💳 Оформити", callback_data=f"checkout_item:{item_id}"), # Placeholder
                builder.button(text="✏️ Змінити", callback_data=CartCallback(action='edit_item', item_id=item_id).pack()),
                builder.button(text="❌ Видалити", callback_data=CartCallback(action='remove_item', item_id=item_id).pack())
            )
    if cart_items:
        builder.row(builder.button(text=f"✅ Оформити все ({total_sum} грн)", callback_data=CartCallback(action="checkout").pack()))
        builder.row(builder.button(text="🗑 Очистити кошик", callback_data=CartCallback(action="clear").pack()))
    # ЗМІНЕНО: Кнопка веде в головне меню
    builder.row(builder.button(text="🛍️ До головного меню", callback_data=BackCallback(to='main_menu').pack()))
    return builder.as_markup()

def get_floating_cart_keyboard(user_id: int, total_sum: int, is_checkout: bool = False, checkout_sum: int = 0) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder(); text = f"🛒 Ваш кошик - Загальна сума: {total_sum} грн"
    if is_checkout and checkout_sum > 0: text += f" | Оформлення: {checkout_sum} грн"
    builder.button(text=text, callback_data=CartCallback(action='show').pack())
    return builder.as_markup()

# --- Клавіатури для оформлення замовлення (ОНОВЛЕНО з кнопкою "Назад") ---

def get_delivery_type_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="🚚 Відправка на відділення", callback_data="delivery_type:branch")
    builder.button(text="🏠 Доставка кур'єром", callback_data="delivery_type:courier")
    builder.button(text="🏢 Самовивіз (по ТТН)", callback_data="delivery_type:pickup")
    # Назад до стану введення телефону
    builder.button(text="⬅️ Назад", callback_data=BackCallback(to=order_states.OrderFSM.awaiting_phone.state).pack())
    builder.adjust(1)
    return builder.as_markup()

def get_delivery_service_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="<Нова Пошта>", callback_data="delivery_service:np")
    builder.button(text="<Укрпошта>", callback_data="delivery_service:ukrpost")
    # TODO: Додати інші служби
    # Назад до вибору типу доставки
    builder.button(text="⬅️ Назад", callback_data=BackCallback(to=order_states.OrderFSM.awaiting_delivery_choice.state).pack())
    builder.adjust(2, 1)
    return builder.as_markup()

def get_payment_method_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="💵 Накладений платіж", callback_data=PaymentCallback(method='cod').pack())
    builder.button(text="💳 Повна передоплата", callback_data=PaymentCallback(method='full').pack())
    builder.button(text="💸 Часткова передоплата (33%)", callback_data=PaymentCallback(method='partial').pack())
    # Назад до попереднього кроку доставки (спеціальний маркер)
    builder.button(text="⬅️ Назад", callback_data=BackCallback(to='previous_delivery_step').pack())
    builder.adjust(1)
    return builder.as_markup()

def get_payment_url_keyboard(payment_url: str, order_id: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="👉 Перейти до оплати 👈", url=payment_url)
    builder.button(text="✅ Я оплатив(-ла)", callback_data=OrderCallback(action='check_payment', order_id=order_id).pack())
    # Назад до вибору способу оплати
    builder.button(text="⬅️ Назад", callback_data=BackCallback(to=order_states.OrderFSM.awaiting_payment_choice.state).pack())
    builder.adjust(1)
    return builder.as_markup()

def get_skip_notes_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="➡️ Пропустити", callback_data="notes:skip")
    # Назад до вибору оплати
    builder.button(text="⬅️ Назад", callback_data=BackCallback(to=order_states.OrderFSM.awaiting_payment_choice.state).pack())
    builder.adjust(1)
    return builder.as_markup()

def get_final_confirmation_keyboard(order_id: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="✅ Все вірно, підтвердити", callback_data=OrderCallback(action='confirm', order_id=order_id).pack())
    # Назад до приміток
    builder.button(text="⬅️ Назад", callback_data=BackCallback(to=order_states.OrderFSM.awaiting_notes.state).pack())
    builder.button(text="❌ Скасувати замовлення", callback_data=OrderCallback(action='cancel').pack())
    builder.adjust(1)
    return builder.as_markup()