# handlers/user_commands.py
from aiogram import Router, F, types
from aiogram.types import Message
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
# Ми ВИДАЛИЛИ імпорт get_main_kb, бо його немає.
# Ми ВИДАЛИЛИ імпорт CartCallback, бо він тут не потрібен.
from keyboards.inline_keyboards import build_cart_kb, CartCallback # <-- ТЕПЕР ЦЕ ТУТ
from services import cart_service

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
        "натиснувши кнопку 'Меню' (ліворуч) або ввівши команду /catalog."
    )
    # Просто текст, без зайвих клавіатур (кнопка Меню вже налаштована в bot.py)
    await msg.answer(greeting_text)

# --- Додаємо обробник /basket ---
@router.message(F.text == "/basket")
async def show_cart_command(msg: Message, state: FSMContext):
    await show_cart(msg, state)

# --- Допоміжна функція для показу кошика ---
async def show_cart(target: Message | types.CallbackQuery, state: FSMContext):
    user_id = target.from_user.id
    cart_data = await cart_service.get_cart_contents(user_id)
    cart_items = cart_data[0]
    total_price = cart_data[1]

    if not cart_items:
        text = "🛒 Ваш кошик порожній."
        reply_markup = None
    else:
        text = "🛒 **Ваш кошик:**\n\n"
        for item in cart_items:
            text += (
                f"<b>{item['name']}</b> ({item['options_text']})\n"
                f"К-сть: {item['quantity']} шт. x {item['price']} грн\n\n"
            )
        text += f"<b>Загальна сума: {total_price} грн</b>"
        reply_markup = build_cart_kb(cart_items, total_price)

    if isinstance(target, types.CallbackQuery):
        await target.message.edit_text(text, reply_markup=reply_markup)
        await target.answer()
    else:
        await target.answer(text, reply_markup=reply_markup)

# --- Обробники кнопок кошика ---
@router.callback_query(F.data == "cart:close")
async def cb_close_cart(callback: types.CallbackQuery):
    await callback.message.delete()
    await callback.answer()

@router.callback_query(CartCallback.filter(F.action == 'clear'))
async def cb_clear_cart(callback: types.CallbackQuery, state: FSMContext):
    await cart_service.clear_cart(callback.from_user.id)
    await callback.answer("✅ Кошик успішно очищено!", show_alert=True)
    await show_cart(callback, state)