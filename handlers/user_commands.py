# handlers/user_commands.py
from aiogram import Router, F, types
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from aiogram.types import Message, CallbackQuery

# Імпортуємо все, що нам потрібно
from keyboards import inline_keyboards
from keyboards.inline_keyboards import NavigationCallback, CartCallback
from fsm.order_states import OrderFSM
from services import cart_service, xml_parser
from handlers.product_handlers import render_product_card # Імпортуємо хелпер

# Створюємо роутер
router = Router()

@router.message(CommandStart(deep_link=False))
async def cmd_start_simple(msg: Message, state: FSMContext):
    """Обробник /start без deep-link."""
    await state.clear()
    
    greeting_text = (
        f"Вітаю, {msg.from_user.full_name}! 👋\n\n"
        "Я — ваш бот-помічник 'Taverna'.\n\n"
        "👉 Ви можете відкрити наш повний <b>Каталог (MiniApp)</b>, "
        "знайти товар в боті за артикулом, або перейти на наш канал."
    )
    
    await msg.answer(greeting_text, reply_markup=build_start_kb())

# --- Допоміжна функція для показу кошика ---
async def show_cart(target: Message | CallbackQuery, state: FSMContext):
    """Універсальна функція для відображення кошика."""
    user_id = target.from_user.id
    cart_data = await cart_service.get_cart(user_id)
    cart_items = cart_data.get("items", [])

    if not cart_items:
        text = "🛒 Ваш кошик порожній."
        keyboard = inline_keyboards.get_main_menu_keyboard()
    else:
        total_price = sum(item['final_price'] * item['quantity'] for item in cart_items)
        text = "🛒 **Ваш кошик:**\n\n"
        for i, item in enumerate(cart_items, 1):
            text += f"*{i}. {item['name']} ({item['size']})*\n"
            text += f"`{item['quantity']} шт. x {item['final_price']} грн` = `{item['quantity'] * item['final_price']}` грн\n\n"
        text += f"💰 **Загальна сума: {total_price} грн**\n\n"
        text += "Скористайтесь кнопками нижче для керування замовленням."
        
        keyboard = inline_keyboards.get_cart_view_keyboard(cart_items)

    # Визначаємо, як відповісти: новим повідомленням чи редагуванням
    if isinstance(target, Message):
        await target.answer(text, reply_markup=keyboard, parse_mode="Markdown")
    else: # CallbackQuery
        await target.message.edit_text(text, reply_markup=keyboard, parse_mode="Markdown")

# --- Обробник команди /start та deep-link ---
@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext):
    await state.clear()
    
    # Перевіряємо, чи є аргумент (артикул) після команди /start
    args = message.text.split()
    if len(args) > 1:
        sku_from_deeplink = args[1]
        product = await xml_parser.get_product_by_sku(sku_from_deeplink)
        if product:
            # Якщо товар знайдено, одразу показуємо його картку
            card_text = render_product_card(product)
            keyboard = inline_keyboards.get_product_card_keyboard(product)
            await message.answer(text=card_text, reply_markup=keyboard)
            return

    # Якщо deep-link немає або товар не знайдено, показуємо головне меню
    await message.answer(
        "👋 Вітаємо в магазині 'Таверна'!\n\nТут ви знайдете найкраще тактичне спорядження.",
        reply_markup=inline_keyboards.get_main_menu_keyboard()
    )


# --- Обробники кнопок навігації ---
@router.callback_query(NavigationCallback.filter(F.action == 'to_main_menu'))
async def cb_main_menu(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.edit_text(
        "👋 Головне меню:",
        reply_markup=inline_keyboards.get_main_menu_keyboard()
    )
    await callback.answer()

@router.callback_query(NavigationCallback.filter(F.action == 'start_search'))
async def cb_start_search(callback: CallbackQuery, state: FSMContext):
    await callback.message.edit_text("🔍 Введіть назву товару або артикул для пошуку:")
    await state.set_state(OrderFSM.awaiting_sku_search)
    await callback.answer()


# --- Обробники дій з кошиком ---
@router.message(Command("basket"))
async def cmd_basket(message: Message, state: FSMContext):
    """Обробляє команду /basket."""
    await show_cart(message, state)

@router.callback_query(CartCallback.filter(F.action == 'show'))
async def cb_show_cart(callback: CallbackQuery, state: FSMContext):
    """Обробляє кнопку 'Мій кошик'."""
    await show_cart(callback, state)
    await callback.answer()

@router.callback_query(CartCallback.filter(F.action == 'clear'))
async def cb_clear_cart(callback: CallbackQuery, state: FSMContext):
    """Обробляє кнопку 'Очистити кошик'."""
    await cart_service.clear_cart(callback.from_user.id)
    await callback.answer("✅ Кошик успішно очищено!", show_alert=True)
    await show_cart(callback, state) # Оновлюємо вигляд кошика

@router.callback_query(CartCallback.filter(F.action == 'remove_item'))
async def cb_remove_item_from_cart(callback: CallbackQuery, state: FSMContext, callback_data: CartCallback):
    """Обробляє кнопку 'Видалити' для конкретного товару."""
    item_id_to_remove = callback_data.item_id
    cart_service.remove_item(callback.from_user.id, item_id_to_remove)
    await callback.answer("✅ Позицію видалено.", show_alert=False)
    await show_cart(callback, state) # Оновлюємо вигляд кошика

@router.callback_query(CartCallback.filter(F.action == 'edit_item'))
async def cb_edit_item_in_cart(callback: CallbackQuery, state: FSMContext, callback_data: CartCallback):
    """
    Обробляє кнопку 'Змінити' для конкретного товару.
    ПОКИ ЩО це заглушка, яка повідомляє про майбутній функціонал.
    """
    # В майбутньому тут буде логіка:
    # 1. Отримати item_id з callback_data
    # 2. Зберегти його в FSM
    # 3. Показати картку цього товару знову
    # 4. Запропонувати вибрати новий розмір або ввести нову кількість
    # 5. Викликати cart_service.update_item()
    await callback.answer("Цей функціонал знаходиться в розробці.", show_alert=True)
