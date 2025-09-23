# handlers/product_handlers.py
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.fsm.context import FSMContext
from typing import List

# Імпортуємо всі наші модулі
from fsm.order_states import OrderFSM
from services import xml_parser
# from services import cart_service # Уявимо, що цей сервіс вже є
from keyboards import inline_keyboards
from keyboards.inline_keyboards import AddToCartCallback

# Створюємо роутер для цього файлу
router = Router()

# --- Допоміжна функція для красивого виводу картки товару ---
def _render_product_card(product: dict) -> str:
    """Форматує дані товару в текстове повідомлення з HTML-розміткою."""
    pictures_html = "\n".join(f"<a href='{url}'>&#8203;</a>" for url in product['pictures'])
    
    return (
        f"{pictures_html}"
        f"<b>{product['name']}</b>\n\n"
        f"<b>Ціна:</b> {product['final_price']} грн\n"
        f"<b>Артикул:</b> {product['sku']}\n\n"
        f"<i>{product['description']}</i>"
    )

# --- Обробник, що ловить повідомлення в стані пошуку ---
@router.message(OrderFSM.awaiting_sku_search, F.text)
async def process_product_search(message: Message, state: FSMContext):
    """
    Цей хендлер спрацьовує, коли користувач надіслав текст
    після натискання кнопки "Пошук".
    """
    query = message.text.strip()
    # Важливо: одразу виходимо зі стану, щоб не ловити наступні повідомлення
    await state.clear()

    # Викликаємо наш сервіс для пошуку товарів
    found_products = await xml_parser.search_products(query)

    # Сценарій 1: Нічого не знайдено
    if not found_products:
        await message.answer("😔 На жаль, за вашим запитом нічого не знайдено. Спробуйте інший запит.")
        return

    # Сценарій 2: Знайдено один товар - показуємо повну картку
    if len(found_products) == 1:
        product = found_products[0]
        card_text = _render_product_card(product)
        keyboard = inline_keyboards.get_product_card_keyboard(product)
        
        # Відправляємо повідомлення з фото, текстом та клавіатурою
        if product['pictures']:
            await message.answer_photo(
                photo=product['pictures'][0],
                caption=card_text,
                reply_markup=keyboard
            )
        else:
            await message.answer(text=card_text, reply_markup=keyboard)
        return

    # Сценарій 3: Знайдено декілька товарів - показуємо список
    if len(found_products) > 1:
        response_text = "🔎 Знайдено декілька товарів. Будь ласка, уточніть ваш запит або введіть точний артикул:\n\n"
        for prod in found_products[:10]: # Обмежимо вивід до 10 товарів
            response_text += f"▪️ {prod['name']} (Артикул: `{prod['sku']}`)\n"
        await message.answer(response_text)


# --- Обробник, що ловить натискання на кнопку вибору розміру (додавання в кошик) ---
@router.callback_query(AddToCartCallback.filter())
async def cb_add_to_cart(callback: CallbackQuery, callback_data: AddToCartCallback):
    """
    Спрацьовує, коли користувач натискає на кнопку з розміром.
    Використовує фабрику AddToCartCallback для безпечного отримання даних.
    """
    user_id = callback.from_user.id
    sku = callback_data.sku
    offer_id = callback_data.offer_id
    quantity = callback_data.quantity

    # TODO: Викликати реальний сервіс кошика
    # await cart_service.add_item(
    #     user_id=user_id,
    #     sku=sku,
    #     offer_id=offer_id,
    #     quantity=quantity
    # )
    
    # Показуємо спливаюче повідомлення користувачу
    await callback.answer(
        "✅ Товар додано до кошика!",
        show_alert=False
    )