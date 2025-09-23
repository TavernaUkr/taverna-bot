# handlers/user_commands.py
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.filters import CommandStart, Command, CommandObject
from aiogram.fsm.context import FSMContext

# Імпортуємо все, що ми створили раніше
from keyboards import inline_keyboards
from fsm.order_states import OrderFSM
from services import cart_service, xml_parser
from handlers.product_handlers import _render_product_card # Імпортуємо хелпер

# Створюємо роутер для цього файлу. Всі обробники будуть прив'язані до нього.
router = Router()

# --- Обробник команди /start ---
@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext, command: CommandObject):
    """
    Цей хендлер тепер обробляє і звичайний /start, і deep-link (/start SKU).
    """
    await state.clear()
    
    # Перевіряємо, чи є аргумент (артикул) після команди /start
    sku_from_deeplink = command.args
    if sku_from_deeplink:
        product = await xml_parser.get_product_by_sku(sku_from_deeplink)
        if product:
            # Якщо товар знайдено, одразу показуємо його картку
            card_text = _render_product_card(product)
            keyboard = inline_keyboards.get_product_card_keyboard(product)
            if product['pictures']:
                await message.answer_photo(
                    photo=product['pictures'][0],
                    caption=card_text,
                    reply_markup=keyboard
                )
            else:
                await message.answer(text=card_text, reply_markup=keyboard)
            return

    # Якщо deep-link немає або товар не знайдено, показуємо головне меню
    await message.answer(
        "👋 Вітаємо в магазині 'Таверна'! \n\nТут ви знайдете найкраще тактичне спорядження.",
        reply_markup=inline_keyboards.get_main_menu_keyboard()
    )

# --- Обробник колбеку для повернення на головне меню ---
# Припустимо, у нас буде кнопка з callback_data="back_to_main_menu"
@router.callback_query(F.data == "back_to_main_menu")
async def cb_back_to_main_menu(callback: CallbackQuery, state: FSMContext):
    """
    Обробляє натискання кнопки "Повернутись на головну".
    Працює аналогічно до /start, але редагує поточне повідомлення.
    """
    await state.clear()
    await callback.message.edit_text(
        "👋 Головне меню:",
        reply_markup=inline_keyboards.get_main_menu_keyboard()
    )
    await callback.answer()

# --- Обробник колбеку для початку пошуку товару ---
@router.callback_query(F.data == "start_search")
async def cb_start_search(callback: CallbackQuery, state: FSMContext):
    """
    Реагує на кнопку "Пошук за назвою/артикулом" і переводить
    користувача у стан очікування пошукового запиту.
    """
    await callback.message.edit_text(
        "🔍 Введіть назву товару або артикул для пошуку:"
    )
    # Встановлюємо стан FSM, щоб наступне повідомлення від користувача
    # обробив інший, спеціальний хендлер.
    await state.set_state(OrderFSM.awaiting_sku_search)
    await callback.answer()

# --- Обробник для відображення кошика ---
# Він буде реагувати і на команду /basket, і на кнопку "Мій кошик"

# Спочатку створимо допоміжну функцію, щоб не дублювати код
async def show_cart_for_user(message: Message, user_id: int):
    cart_items = await cart_service.get_cart(user_id)

    if not cart_items:
        await message.answer(
            "🛒 Ваш кошик порожній.",
            reply_markup=inline_keyboards.get_main_menu_keyboard()
        )
        return

    total_price = sum(item['final_price'] * item['quantity'] for item in cart_items)
    cart_text = "🛒 **Ваш кошик:**\n\n"
    for item in cart_items:
        cart_text += f"🔹 {item['name']} ({item['size']})\n"
        cart_text += f"   `{item['quantity']} шт. x {item['final_price']} грн`\n"
    cart_text += f"\n💰 **Загальна сума: {total_price} грн**"

    await message.answer(
        cart_text,
        reply_markup=inline_keyboards.get_cart_keyboard(cart_items)
    )

@router.message(Command("basket"))
async def cmd_basket(message: Message):
    await show_cart_for_user(message, message.from_user.id)

@router.callback_query(F.data == "show_cart")
async def cb_show_cart(callback: CallbackQuery):
    await callback.message.delete()
    await show_cart_for_user(callback.message, callback.from_user.id)
    await callback.answer()