# handlers/order_handlers.py
import logging
import re
from aiogram import Router, F, Bot
from aiogram.types import Message, CallbackQuery
from aiogram.fsm.context import FSMContext

from fsm.order_states import OrderFSM
from services import cart_service, order_service
from keyboards.inline_keyboards import (
    build_delivery_kb,
    build_payment_kb,
    build_skip_kb,
    build_confirmation_kb
)

logger = logging.getLogger(__name__)
router = Router()

# --- ВАЛІДАТОРИ (з bot_updated_77 – копія.py) ---

def _validate_pib(text: str) -> Tuple[bool, str, str]:
    """
    Валідує ПІБ. 
    Повертає (is_valid, error_message, formatted_name)
    """
    parts = text.strip().split()
    if len(parts) < 2 or len(parts) > 3:
        return False, "❌ Введіть Прізвище та Ім'я (2 слова), або Прізвище, Ім'я, По-батькові (3 слова).", ""
    
    cyrillic_pattern = re.compile(r"^[А-ЯҐЄІЇа-яґєії']+$")
    
    for part in parts:
        if not cyrillic_pattern.match(part) or len(part) < 2:
            return False, "❌ ПІБ має складатися лише з українських літер (дозволено апостроф) та містити мінімум 2 символи у кожному слові.", ""
            
    formatted_name = " ".join([part.title() for part in parts])
    return True, "", formatted_name


def _validate_phone(text: str) -> Tuple[bool, str, str]:
    """
    Валідує телефон. 
    Повертає (is_valid, error_message, formatted_phone)
    """
    phone = re.sub(r"[^\d+]", "", text) # Видаляємо все, крім цифр та +
    
    if phone.startswith('+380') and len(phone) == 13:
        digits = phone[4:] # 9 цифр
    elif phone.startswith('380') and len(phone) == 12:
        digits = phone[3:] # 9 цифр
    elif phone.startswith('0') and len(phone) == 10:
        digits = phone[1:] # 9 цифр
    else:
        return False, "❌ Некоректний формат. Номер має містити 10, 12 або 13 цифр (з +380).", ""

    # Перевірка кодів операторів (з твого старого файлу)
    VALID_CODES = {
        "67", "68", "96", "97", "98", "50", "66", "95", "99", 
        "75", "63", "73", "93", "91", "92", "94"
    }
    if digits[:2] not in VALID_CODES:
        return False, f"❌ Невідомий код оператора (0{digits[:2]}). Спробуйте ще раз.", ""

    formatted_phone = f"+380{digits}"
    return True, "", formatted_phone

# --- FSM Хендлери ---

@router.message(OrderFSM.awaiting_name)
async def handle_name(msg: Message, state: FSMContext):
    """Обробляє введене ПІБ."""
    is_valid, error_msg, formatted_name = _validate_pib(msg.text)
    
    if not is_valid:
        await msg.answer(error_msg)
        return
        
    await state.update_data(pib=formatted_name)
    await state.set_state(OrderFSM.awaiting_phone)
    await msg.answer(f"✅ ПІБ: {formatted_name}\n\nТепер введіть Ваш <b>номер телефону</b>:")

@router.message(OrderFSM.awaiting_phone)
async def handle_phone(msg: Message, state: FSMContext):
    """Обробляє введений телефон."""
    is_valid, error_msg, formatted_phone = _validate_phone(msg.text)
    
    if not is_valid:
        await msg.answer(error_msg)
        return
        
    await state.update_data(phone=formatted_phone)
    await state.set_state(OrderFSM.awaiting_delivery_service)
    await msg.answer(f"✅ Телефон: {formatted_phone}\n\nОберіть <b>службу доставки</b>:", reply_markup=build_delivery_kb())

@router.callback_query(F.data.startswith("delivery:"))
async def handle_delivery_service(cb: CallbackQuery, state: FSMContext):
    """Обробляє вибір служби доставки."""
    service_key = cb.data.split(":")[1]
    await state.update_data(delivery_service=service_key)
    
    await state.set_state(OrderFSM.awaiting_address)
    
    service_name_map = {
        "nova_poshta": "Нова Пошта",
        "ukr_poshta": "Укрпошта"
    }
    service_name = service_name_map.get(service_key, "Доставка")
    
    # TODO: Тут буде інтеграція з API Нової Пошти (в наступних кроках)
    # Поки що просимо ввести текстом
    await cb.message.edit_text(
        f"✅ Служба: {service_name}\n\n"
        "Введіть Ваше <b>місто та номер відділення</b> (наприклад: <code>Київ, відділення 100</code>):"
    )
    await cb.answer()

@router.message(OrderFSM.awaiting_address)
async def handle_address(msg: Message, state: FSMContext):
    """Обробляє введену адресу."""
    address_text = msg.text.strip()
    if len(address_text) < 5:
        await msg.answer("❌ Будь ласка, введіть повнішу адресу (місто та відділення).")
        return

    await state.update_data(address=address_text)
    await state.set_state(OrderFSM.awaiting_payment_type)
    await msg.answer(
        f"✅ Адреса: {address_text}\n\n"
        "Оберіть <b>спосіб оплати</b>:",
        reply_markup=build_payment_kb()
    )

@router.callback_query(F.data.startswith("payment:"))
async def handle_payment_type(cb: CallbackQuery, state: FSMContext):
    """Обробляє вибір типу оплати."""
    payment_key = cb.data.split(":")[1]
    
    payment_name_map = {
        "cod": "Накладений платіж",
        "prepaid": "Повна передоплата"
    }
    payment_name = payment_name_map.get(payment_key, "Оплата")
    
    await state.update_data(payment_type=payment_key)
    await state.set_state(OrderFSM.awaiting_note)
    await cb.message.edit_text(
        f"✅ Оплата: {payment_name}\n\n"
        "Додайте <b>примітку</b> до замовлення (або натисніть 'Пропустити'):",
        reply_markup=build_skip_kb("note")
    )
    await cb.answer()

@router.message(OrderFSM.awaiting_note)
async def handle_note(msg: Message, state: FSMContext):
    """Обробляє примітку."""
    await state.update_data(note=msg.text.strip())
    await msg.answer("✅ Примітку додано.")
    await show_confirmation_summary(msg, state) # Переходимо до підтвердження

@router.callback_query(F.data == "skip:note")
async def handle_skip_note(cb: CallbackQuery, state: FSMContext):
    """Обробляє пропуск примітки."""
    await state.update_data(note=None)
    await cb.message.delete() # Видаляємо повідомлення з кнопкою "Пропустити"
    await show_confirmation_summary(cb.message, state) # Переходимо до підтвердження
    await cb.answer("Примітку пропущено.")

async def show_confirmation_summary(msg: Message, state: FSMContext):
    """
    Показує фінальний екран підтвердження замовлення.
    """
    user_id = msg.chat.id
    fsm_data = await state.get_data()
    cart_items, total_price = await cart_service.get_cart_contents(user_id)
    
    if not cart_items:
        await msg.answer("❌ Ваш кошик порожній. Неможливо оформити замовлення.")
        await state.clear()
        return

    # Формуємо текст
    summary_lines = ["🧾 <b>Перевірте Ваше замовлення:</b>\n"]
    
    # Блок 1: Товари
    for i, item in enumerate(cart_items, 1):
        summary_lines.append(
            f"<b>{i}. {item.get('name')}</b> (<code>{item.get('sku')}</code>)"
        )
        summary_lines.append(
            f"   Розмір: {item.get('size', '-')} | {item.get('price', 0)} грн x {item.get('quantity', 0)} шт. = <b>{item.get('total_item_price', 0)} грн</b>"
        )
    
    summary_lines.append("\n" + "—" * 20)
    
    # Блок 2: Отримувач
    payment_map = {"cod": "Накладений платіж", "prepaid": "Повна передоплата"}
    delivery_map = {"nova_poshta": "Нова Пошта", "ukr_poshta": "Укрпошта"}
    
    summary_lines.append(f"<b>Отримувач:</b>")
    summary_lines.append(f"  ПІБ: {fsm_data.get('pib')}")
    summary_lines.append(f"  Телефон: {fsm_data.get('phone')}")
    summary_lines.append(f"<b>Доставка:</b>")
    summary_lines.append(f"  Служба: {delivery_map.get(fsm_data.get('delivery_service'))}")
    summary_lines.append(f"  Адреса: {fsm_data.get('address')}")
    summary_lines.append(f"<b>Оплата:</b>")
    summary_lines.append(f"  Тип: {payment_map.get(fsm_data.get('payment_type'))}")
    if fsm_data.get('note'):
        summary_lines.append(f"  Примітка: {fsm_data.get('note')}")
        
    summary_lines.append("\n" + "—" * 20)
    summary_lines.append(f"🔥 <b>Загальна сума до сплати: {total_price} грн</b>")
    
    await state.set_state(OrderFSM.awaiting_confirmation)
    await msg.answer("\n".join(summary_lines), reply_markup=build_confirmation_kb())

@router.callback_query(OrderFSM.awaiting_confirmation, F.data == "order:confirm")
async def handle_order_confirm(cb: CallbackQuery, state: FSMContext, bot: Bot):
    """
    ФІНАЛЬНИЙ крок. Обробляє замовлення.
    (ВЕРСІЯ БЕЗ ЗАГЛУШКИ)
    """
    user_id = cb.from_user.id
    fsm_data = await state.get_data()
    cart_items, total_price = await cart_service.get_cart_contents(user_id)
    
    if not cart_items:
        await cb.answer("Кошик порожній!", show_alert=True)
        await state.clear()
        return

    await cb.message.edit_text("⏳ <b>Обробляємо Ваше замовлення...</b>", reply_markup=None)
    
    try:
        # --- ОСЬ ТУТ ЗАМІНА ЗАГЛУШКИ ---
        success, order_uid = await order_service.create_order(
            bot=bot,
            user_id=user_id,
            fsm_data=fsm_data,
            cart_items=cart_items,
            total_price=total_price
        )
        # --- КІНЕЦЬ ЗАМІНИ ---

        if success:
            await cb.message.answer(
                f"✅ <b>Дякуємо, Ваше замовлення <code>{order_uid}</code> прийнято!</b>\n\n"
                f"Наш менеджер зв'яжеться з Вами найближчим часом для підтвердження."
            )
            # Очищуємо кошик в Redis
            await cart_service.clear_cart(user_id)
            
        else:
            await cb.message.answer(
                "❌ <b>Сталася помилка під час створення замовлення.</b>\n\n"
                "Будь ласка, спробуйте ще раз або зв'яжіться з нами напряму."
            )
            
    except Exception as e:
        logger.error(f"Критична помилка при handle_order_confirm: {e}", exc_info=True)
        await cb.message.answer("❌ <b>Сталася критична помилка.</b> Ваші дані не втрачено, але, будь ласка, повідомте адміністратора.")
    finally:
        # Завершуємо FSM
        await state.clear()

@router.callback_query(OrderFSM.awaiting_confirmation, F.data == "order:cancel")
async def handle_order_cancel(cb: CallbackQuery, state: FSMContext):
    """
    Скасовує FSM, але НЕ чистить кошик.
    """
    await state.clear()
    await cb.message.edit_text(
        "❌ Оформлення скасовано.\n\n"
        "Ваш кошик збережено. Ви можете повернутися до нього в будь-який час за командою /basket"
    )
    await cb.answer("Оформлення скасовано.")

# --- Обробники "Назад" ---
# (Дозволяють користувачу рухатись по FSM)

@router.callback_query(F.data == "back_to:address")
async def go_back_to_address(cb: CallbackQuery, state: FSMContext):
    await state.set_state(OrderFSM.awaiting_address)
    await cb.message.edit_text("⬅️ Повернення...\n\nВведіть <b>місто та номер відділення</b>:")
    await cb.answer()

@router.callback_query(F.data == "back_to:payment")
async def go_back_to_payment(cb: CallbackQuery, state: FSMContext):
    await state.set_state(OrderFSM.awaiting_payment_type)
    await cb.message.edit_text("⬅️ Повернення...\n\nОберіть <b>спосіб оплати</b>:", reply_markup=build_payment_kb())
    await cb.answer()
    
@router.callback_query(F.data == "back_to:note")
async def go_back_to_note(cb: CallbackQuery, state: FSMContext):
    await state.set_state(OrderFSM.awaiting_note)
    await cb.message.edit_text("⬅️ Повернення...\n\nДодайте <b>примітку</b> (або 'Пропустити'):", reply_markup=build_skip_kb("note"))
    await cb.answer()