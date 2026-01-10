# handlers/cart_handlers.py
import logging
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext # FSM тут більше не потрібен

from services import cart_service
from keyboards.inline_keyboards import build_cart_kb
# from fsm.order_states import OrderFSM # FSM тут більше не потрібен

logger = logging.getLogger(__name__)
router = Router()

async def show_cart(message_or_cb: Message | CallbackQuery, state: FSMContext):
    user_id = message_or_cb.from_user.id
    cart_items, total_price = await cart_service.get_cart_contents(user_id)
    
    text_lines = []
    if not cart_items:
        text_lines.append("🛒 Ваш кошик порожній.")
        text_lines.append("\nПерейдіть у наш каталог, щоб додати товари.")
    else:
        text_lines.append("🛒 <b>Ваш кошик:</b>\n")
        for i, item in enumerate(cart_items, 1):
            text_lines.append(f"<b>{i}. {item.get('name')}</b> (<code>{item.get('sku')}</code>)")
            text_lines.append(f"   Розмір: {item.get('size', '-')} | {item.get('price', 0)} грн x {item.get('quantity', 0)} шт.")
            text_lines.append(f"   <b>Сума: {item.get('total_item_price', 0)} грн</b>\n")
        text_lines.append("—" * 20)
        text_lines.append(f"<b>Загальна сума: {total_price} грн</b>")
        text_lines.append("\nЩоб оформити замовлення, будь ласка, відкрийте наш <b>Каталог (MiniApp)</b>.")
        
    text = "\n".join(text_lines)
    
    kb = build_cart_kb(cart_items, total_price) # Клавіатура (з Kрок 4)
    
    if isinstance(message_or_cb, Message):
        await message_or_cb.answer(text, reply_markup=kb)
    elif isinstance(message_or_cb, CallbackQuery):
        if message_or_cb.message.text != text:
             await message_or_cb.message.edit_text(text, reply_markup=kb)
        else:
            await message_or_cb.answer()

@router.message(Command("basket"))
async def cmd_basket(msg: Message, state: FSMContext):
    await show_cart(msg, state)

@router.callback_query(F.data == "cart:open")
async def cb_open_cart(cb: CallbackQuery, state: FSMContext):
    await show_cart(cb, state)
    await cb.answer()

@router.callback_query(F.data.startswith("cart:remove:"))
async def cb_remove_item(cb: CallbackQuery, state: FSMContext):
    try:
        variant_offer_id = cb.data.split(":")[2]
    except (IndexError, ValueError):
        await cb.answer("Помилка видалення.", show_alert=True)
        return

    await cart_service.remove_item_from_cart(cb.from_user.id, variant_offer_id)
    await cb.answer("Товар видалено з кошика.")
    await show_cart(cb, state) # Оновлюємо вигляд

@router.callback_query(F.data == "cart:clear")
async def cb_clear_cart(cb: CallbackQuery, state: FSMContext):
    await cart_service.clear_cart(cb.from_user.id)
    await cb.answer("Кошик повністю очищено.", show_alert=True)
    await show_cart(cb, state) # Оновлюємо вигляд

# --- ХЕНДЛЕР 'cart:checkout' ВИДАЛЕНО ---