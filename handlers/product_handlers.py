# handlers/product_handlers.py
from aiogram import Router, F, types
from aiogram.fsm.context import FSMContext
from aiogram.types import Message, CallbackQuery
from aiogram.exceptions import TelegramBadRequest

# Імпортуємо всі наші модулі
from fsm.order_states import OrderFSM
from services import xml_parser, cart_service
from keyboards import inline_keyboards
from keyboards.inline_keyboards import ProductCallback

# Створюємо роутер для цього файлу
router = Router()

# Словник для зберігання ID повідомлень з "плаваючою" кнопкою
# {user_id: message_id}
# УВАГА: це сховище в пам'яті, при перезапуску бота дані зникнуть.
# Для production можна буде замінити на Redis або інше постійне сховище.
floating_buttons = {}


# --- Допоміжні функції ---
def render_product_card(product: dict) -> str:
    """Форматує дані товару в текстове повідомлення з HTML-розміткою."""
    pictures_html = "".join(f"<a href='{url}'>&#8203;</a>" for url in product.get('pictures', []))
    return (
        f"{pictures_html}"
        f"<b>{product.get('name', 'Без назви')}</b>\n\n"
        f"<b>Ціна:</b> {product.get('final_price', 'Не вказана')} грн\n"
        f"<b>Артикул:</b> <code>{product.get('sku', 'Не вказано')}</code>\n\n"
        f"<i>{product.get('description', 'Опис відсутній.')}</i>"
    )

async def show_floating_cart_button(message: Message):
    """Створює або оновлює "плаваючу" кнопку кошика."""
    user_id = message.from_user.id
    cart = await cart_service.get_cart(user_id)
    items = cart.get("items", [])
    
    if not items:
        return

    total_sum = sum(item.get('final_price', 0) * item.get('quantity', 1) for item in items)
    keyboard = inline_keyboards.get_floating_cart_keyboard(user_id, total_sum)
    text = f"✅ Товар додано. У вашому кошику {len(items)} поз. на суму {total_sum} грн.\n" \
           f"Кошик дійсний {cart_service.CART_TTL_MINUTES} хвилин."

    # Якщо ми вже відправляли кнопку, редагуємо її
    if user_id in floating_buttons:
        try:
            await message.bot.edit_message_text(
                text=text,
                chat_id=user_id,
                message_id=floating_buttons[user_id],
                reply_markup=keyboard
            )
            return
        except TelegramBadRequest: # Якщо повідомлення видалено або застаріло
            del floating_buttons[user_id]

    # Якщо кнопки ще не було, відправляємо нове повідомлення
    sent_message = await message.answer(text, reply_markup=keyboard)
    floating_buttons[user_id] = sent_message.message_id


# --- Обробники ---
@router.message(OrderFSM.awaiting_sku_search, F.text)
async def process_product_search(message: Message, state: FSMContext):
    query = message.text.strip()
    await state.clear()
    found_products = await xml_parser.search_products(query)
    if not found_products:
        await message.answer("😔 На жаль, за вашим запитом нічого не знайдено.")
        return
    product = found_products[0]
    card_text = render_product_card(product)
    keyboard = inline_keyboards.get_product_card_keyboard(product)
    await message.answer(text=card_text, reply_markup=keyboard)

@router.callback_query(ProductCallback.filter(F.action == 'select_size'))
async def cb_select_size(callback: CallbackQuery, callback_data: ProductCallback, state: FSMContext):
    await state.update_data(
        selected_sku=callback_data.sku,
        selected_offer_id=callback_data.offer_id
    )
    await callback.message.edit_text(
        f"Тепер введіть бажану кількість товару (наприклад: 1, 2, 5):",
    )
    await state.set_state(OrderFSM.awaiting_quantity)
    await callback.answer("Введіть кількість")

@router.message(OrderFSM.awaiting_quantity, F.text)
async def process_quantity(message: Message, state: FSMContext):
    quantity_str = message.text.strip()
    if not quantity_str.isdigit() or int(quantity_str) <= 0:
        await message.answer("❌ Будь ласка, введіть коректне число (більше нуля).")
        return
    
    quantity = int(quantity_str)
    user_data = await state.get_data()
    sku = user_data.get('selected_sku')
    offer_id = user_data.get('selected_offer_id')

    if not sku or not offer_id:
        await message.answer("Щось пішло не так. Спробуйте почати спочатку.", reply_markup=inline_keyboards.get_main_menu_keyboard())
        await state.clear()
        return

    await cart_service.add_item(
        user_id=message.from_user.id,
        sku=sku,
        offer_id=offer_id,
        quantity=quantity
    )
    
    await state.clear()
    
    # Показуємо "плаваючу" кнопку
    await show_floating_cart_button(message)
    # Повертаємо головне меню, щоб користувач міг продовжити покупки
    await message.answer("Оберіть наступну дію:", reply_markup=inline_keyboards.get_main_menu_keyboard())