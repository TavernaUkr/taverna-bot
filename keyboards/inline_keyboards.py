# keyboards/inline_keyboards.py
import logging
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.utils.keyboard import InlineKeyboardBuilder
from typing import Optional, List
from database.models import Product, ProductVariant
from config_reader import config

logger = logging.getLogger(__name__)

def format_product_card(product: Product) -> str:
    """
    Формує текстову картку товару з моделі Product.
    """
    # Знаходимо діапазон цін
    active_variants = [v for v in product.variants if v.is_available and v.final_price > 0]
    price_text = "<b>Ціну уточнюйте</b>"
    if active_variants:
        min_price = min(v.final_price for v in active_variants)
        max_price = max(v.final_price for v in active_variants)
        if min_price == max_price:
            price_text = f"<b>💰 Ціна: {min_price} грн</b>"
        else:
            price_text = f"<b>💰 Ціна: від {min_price} до {max_price} грн</b>"
    
    # Отримуємо опис, обрізаємо до 600 символів
    description = (product.description or "Опис відсутній.")
    if len(description) > 600:
        description = description[:600] + "..."

    text_parts = [
        f"<b>{product.name}</b>\n",
        f"<b>Артикул:</b> <code>{product.sku}</code>\n",
        price_text,
        "\n" + "—" * 20 + "\n",
        f"<b>Опис:</b>\n{description}"
    ]
    return "\n".join(text_parts)

def build_product_details_kb(product: Product, back_url: Optional[str] = None) -> InlineKeyboardMarkup:
    """
    Створює клавіатуру з вибором розмірів на основі product.variants.
    """
    builder = InlineKeyboardBuilder()
    
    # Сортуємо варіанти
    # TODO: Додати краще сортування (напр. 42, 44, S, M, L)
    try:
        sorted_variants = sorted(
            [v for v in product.variants if v.is_available], 
            key=lambda v: (
                float(v.size) if v.size.replace('.', '', 1).isdigit() else float('inf'), 
                v.size
            )
        )
    except Exception:
        # Fallback на просте сортування, якщо конвертація в float не вдалася
        sorted_variants = sorted(
            [v for v in product.variants if v.is_available], 
            key=lambda v: v.size
        )

    if not sorted_variants:
        # Якщо немає доступних варіантів
        builder.row(
            InlineKeyboardButton(text="❌ Немає в наявності", callback_data="product:unavailable")
        )
    else:
        # Додаємо кнопки розмірів (3 в ряд)
        for variant in sorted_variants:
            # Використовуємо supplier_offer_id, бо він 100% унікальний
            builder.add(
                InlineKeyboardButton(
                    text=f"{variant.size} ({variant.final_price} грн)",
                    callback_data=f"select_size:{variant.supplier_offer_id}"
                )
            )
        # Налаштовуємо по 3 кнопки в ряд
        builder.adjust(3)

    # Додаємо кнопки навігації
    nav_buttons = []
    if back_url:
        nav_buttons.append(InlineKeyboardButton(text="↩️ На канал", url=back_url))
    
    # Кнопка "Скасувати", яка веде на /start
    nav_buttons.append(InlineKeyboardButton(text="❌ Скасувати", callback_data="cancel_action"))
    builder.row(*nav_buttons)
    
    return builder.as_markup()

def build_start_kb() -> InlineKeyboardMarkup:
    """
    Клавіатура для /start (ОНОВЛЕНО З MINIAPP)
    """
    builder = InlineKeyboardBuilder()
    
    # --- 1. Кнопка MiniApp ---
    # Перевіряємо, чи URL взагалі встановлено в .env
    if config.webapp_url:
        logger.debug(f"Додаю кнопку WebApp з URL: {config.webapp_url}")
        builder.row(
            InlineKeyboardButton(
                text="🛒 Відкрити Каталог (MiniApp)",
                # WebAppInfo вказує Telegram, що ця кнопка запускає MiniApp
                web_app=WebAppInfo(url=config.webapp_url)
            )
        )
    else:
        logger.warning("WEBAPP_URL не вказано в .env! Кнопка MiniApp не буде додана.")

    # --- 2. Інші кнопки ---
    builder.row(
        InlineKeyboardButton(
            text="🔎 Пошук товару (в боті)", 
            callback_data="start_search"
        )
    )
    builder.row(
        InlineKeyboardButton(
            text="🛍️ Наш канал (Taverna Army)", 
            url=config.main_channel_url # Використовуємо URL з .env
        )
    )
    return builder.as_markup()

def build_ask_quantity_kb(variant_offer_id: str) -> InlineKeyboardMarkup:
    """
    Клавіатура для вибору кількості (після вибору розміру).
    """
    builder = InlineKeyboardBuilder()
    qty_buttons = [
        InlineKeyboardButton(text=f"{i} шт.", callback_data=f"select_qty:{variant_offer_id}:{i}")
        for i in [1, 2, 3, 5, 10]
    ]
    builder.row(*qty_buttons)
    builder.row(
        InlineKeyboardButton(text="⬅️ Назад (до вибору розміру)", callback_data="back_to_sizes"),
        InlineKeyboardButton(text="❌ Скасувати", callback_data="cancel_action")
    )
    return builder.as_markup()

def build_cart_kb(cart_items: List[Dict[str, Any]], total_price: int) -> InlineKeyboardMarkup:
    """
    Створює клавіатуру для повідомлення про вміст кошика.
    (ВЕРСІЯ БЕЗ КНОПКИ 'CHECKOUT')
    """
    builder = InlineKeyboardBuilder()
    
    for item in cart_items:
        offer_id = item.get('variant_offer_id')
        name = item.get('name', 'Товар')
        size = item.get('size', '-')
        builder.row(
            InlineKeyboardButton(
                text=f"🗑️ Видалити: {name} ({size})",
                callback_data=f"cart:remove:{offer_id}"
            )
        )
    
    if cart_items:
        builder.row(
            InlineKeyboardButton(
                text="🧹 Очистити кошик",
                callback_data="cart:clear"
            )
        )
        
    # Кнопка "Продовжити покупки" (повертає на пошук в боті)
    builder.row(
        InlineKeyboardButton(
            text="➕ Продовжити покупки (в боті)",
            callback_data="start_search" # Та ж, що і в /start
        )
    )
    # Кнопка "Оформити" видалена. Оформлення - тільки через MiniApp.
    
    return builder.as_markup()

# ЗАМІНИ ЦЮ ФУНКЦІЮ:
def build_cart_added_kb(total_price: int) -> InlineKeyboardMarkup:
    """
    Коротка клавіатура, яка з'являється після додавання товару.
    (ВЕРСІЯ БЕЗ КНОПКИ 'CHECKOUT')
    """
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(
            text=f"🛒 Переглянути кошик ({total_price} грн)",
            callback_data="cart:open"
        )
    )
    builder.row(
        InlineKeyboardButton(
            text="➕ Продовжити покупки (в боті)",
            callback_data="start_search"
        )
    )
    # Кнопка "Оформити" видалена.
    return builder.as_markup()

def build_delivery_kb() -> InlineKeyboardMarkup:
    """
    Клавіатура вибору служби доставки.
    """
    builder = InlineKeyboardBuilder()
    # TODO: Додати інші служби (UkrPoshta), коли буде готова логіка
    builder.row(
        InlineKeyboardButton(
            text="🚚 Нова Пошта",
            callback_data="delivery:nova_poshta"
        )
    )
    # builder.row(
    #     InlineKeyboardButton(
    #         text="📮 Укрпошта",
    #         callback_data="delivery:ukr_poshta"
    #     )
    # )
    builder.row(
        InlineKeyboardButton(
            text="❌ Скасувати оформлення",
            callback_data="order:cancel"
        )
    )
    return builder.as_markup()


def build_payment_kb() -> InlineKeyboardMarkup:
    """
    Клавіатура вибору типу оплати.
    """
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(
            text="💵 Накладений платіж",
            callback_data="payment:cod" # Cash on Delivery
        )
    )
    builder.row(
        InlineKeyboardButton(
            text="💳 Повна передоплата (LiqPay/Monobank)",
            callback_data="payment:prepaid"
        )
    )
    builder.row(
        InlineKeyboardButton(
            text="⬅️ Назад (до вибору адреси)",
            callback_data="back_to:address"
        )
    )
    return builder.as_markup()


def build_skip_kb(step_key: str) -> InlineKeyboardMarkup:
    """
    Клавіатура з кнопкою "Пропустити" та "Назад".
    step_key: (напр. 'note') куди повернутись
    """
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(
            text="⏭️ Пропустити",
            callback_data=f"skip:{step_key}"
        )
    )
    builder.row(
        InlineKeyboardButton(
            text="⬅️ Назад (до вибору оплати)",
            callback_data="back_to:payment"
        )
    )
    return builder.as_markup()


def build_confirmation_kb() -> InlineKeyboardMarkup:
    """
    Клавіатура фінального підтвердження замовлення.
    """
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(
            text="✅ Все вірно, Підтвердити",
            callback_data="order:confirm"
        )
    )
    builder.row(
        InlineKeyboardButton(
            text="⬅️ Назад (до примітки)",
            callback_data="back_to:note"
        )
    )
    builder.row(
        InlineKeyboardButton(
            text="❌ Скасувати (почати FSM заново)",
            callback_data="order:cancel"
        )
    )
    return builder.as_markup()