# keyboards/inline_keyboards.py
import logging
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.utils.keyboard import InlineKeyboardBuilder
from typing import List, Optional, Dict, Any # <-- Ми додали Dict та Any
from aiogram.filters.callback_data import CallbackData

logger = logging.getLogger(__name__)

# --- [ФАЗА 2.8] CallbackData для навігації по каталогу ---
# (Залишаємо, може знадобитись)
class NavigationCallback(CallbackData, prefix="catalog_nav"):
    action: str  # "view_product", "change_page"
    sku: Optional[str] = None
    page: Optional[int] = None

# --- [НОВЕ - ФАЗА 4.4] CallbackData для Кошика ---
class CartCallback(CallbackData, prefix="cart"):
    action: str # 'clear', 'checkout', 'remove_item', 'close'
    item_id: Optional[str] = None # Будемо використовувати variant_offer_id

# ---
# [НОВА ФУНКЦІЯ - ФАЗА 4.4]
# ---
def build_cart_kb(cart_items: List[Dict[str, Any]], total_price: int) -> InlineKeyboardMarkup:
    """
    (План 25) Створює клавіатуру для /basket.
    """
    builder = InlineKeyboardBuilder()
    
    # (Ми не можемо видаляти товари звідси, бо це зламає `order_service`)
    # (Видалення - тільки в MiniApp)
    # for item in cart_items:
    #     builder.button(
    #         text=f"❌ Видалити {item['name'][:20]}...",
    #         callback_data=CartCallback(action="remove_item", item_id=item['variant_offer_id'])
    #     )

    # Додаємо головні кнопки
    if total_price > 0:
        builder.button(
            text=f"✅ Оформити замовлення ({total_price} грн)",
            callback_data="cart:checkout" # (Або web_app=...)
        )
        builder.button(
            text="🗑️ Очистити кошик",
            callback_data=CartCallback(action="clear")
        )
        
    builder.button(text="❌ Закрити", callback_data="cart:close")
    
    # Розмітка: кнопки "Оформити" та "Очистити" - в один ряд, "Закрити" - окремо
    if total_price > 0:
        builder.adjust(1, 2)
    else:
        builder.adjust(1)

    return builder.as_markup()

# --- (Стара функція, яку шукав `product_handlers`) ---
def format_product_card(product: Dict[str, Any]) -> str:
    """Заглушка для старої логіки (на випадок, якщо знадобиться)"""
    return f"Товар: {product.get('name')}"

def get_product_card_kb(sku: str) -> InlineKeyboardMarkup:
    """
    Клавіатура для картки товару (зараз не використовується,
    бо ми перейшли на MiniApp).
    """
    buttons = [
        [InlineKeyboardButton(text="🛒 Додати в кошик", callback_data=f"cart:add:{sku}")],
        [InlineKeyboardButton(text="⬅️ Назад до каталогу", callback_data="catalog:back")]
    ]
    return InlineKeyboardMarkup(inline_keyboard=buttons)