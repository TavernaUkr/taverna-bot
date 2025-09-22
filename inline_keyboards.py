# keyboards/inline_keyboards.py
from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram.filters.callback_data import CallbackData
from typing import List
from config_reader import config

# --- Фабрики CallbackData ---
# Створюємо "шаблони" для даних, що будуть зашиті в кнопки.
# Це набагато безпечніше і зручніше, ніж просто рядки.

class AddToCartCallback(CallbackData, prefix="add_cart"):
    sku: str
    offer_id: str
    quantity: int

class RemoveFromCartCallback(CallbackData, prefix="rem_cart"):
    sku: str # Видаляємо весь товар за артикулом, незалежно від розміру

# --- Функції для створення клавіатур ---

def get_main_menu_keyboard():
    builder = InlineKeyboardBuilder()
    # Тепер кнопка буде брати посилання з конфігурації
    builder.button(text="📜 Перейти до каталогу", url=config.main_channel_url)
    builder.button(text="🔎 Пошук за назвою/артикулом", callback_data="start_search")
    builder.button(text="🛒 Мій кошик", callback_data="show_cart")
    builder.adjust(1)
    return builder.as_markup()

def get_product_card_keyboard(product: dict):
    builder = InlineKeyboardBuilder()
    
    # Динамічно створюємо кнопки для розмірів
    row_buttons = []
    available_offers = [offer for offer in product['offers'] if offer['available']]
    
    for offer in available_offers:
        # Створюємо кнопку, використовуючи фабрику CallbackData
        callback_data = AddToCartCallback(
            sku=product['sku'], 
            offer_id=offer['offer_id'],
            quantity=1 # Початкова кількість
        ).pack()
        row_buttons.append(builder.button(text=offer['size'], callback_data=callback_data))
        
        # Розміщуємо кнопки по 3 в ряд, як ви і хотіли
        if len(row_buttons) == 3:
            builder.row(*row_buttons)
            row_buttons = []
    
    # Додаємо залишок кнопок, якщо вони є
    if row_buttons:
        builder.row(*row_buttons)

    builder.button(text="↩️ Повернутись до каталогу", callback_data="back_to_catalog")
    return builder.as_markup()

def get_cart_keyboard(cart_items: List[dict]):
    builder = InlineKeyboardBuilder()

    # Кнопки для кожного товару в кошику
    for item in cart_items:
        # TODO: Додати кнопки "Оформити тільки цей товар", "Змінити кількість"
        remove_callback = RemoveFromCartCallback(sku=item['sku']).pack()
        builder.button(text=f"❌ Видалити {item['name']}", callback_data=remove_callback)
    
    # Загальні кнопки
    if cart_items:
        builder.button(text="✅ Перейти до оформлення", callback_data="start_checkout")
        builder.button(text="🗑 Очистити кошик", callback_data="clear_cart")

    builder.button(text="🛍 Продовжити покупки", callback_data="back_to_catalog")
    builder.adjust(1) # Всі кнопки одна під одною
    return builder.as_markup()

def get_order_confirmation_keyboard():
    builder = InlineKeyboardBuilder()
    builder.button(text="✅ Все вірно, підтвердити", callback_data="confirm_order")
    builder.button(text="❌ Скасувати замовлення", callback_data="cancel_order")
    builder.adjust(1)
    return builder.as_markup()
