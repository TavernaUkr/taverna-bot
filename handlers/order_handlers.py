# handlers/order_handlers.py
import re
import uuid
import logging # Додаємо логування
from aiogram import Router, F, types, Bot, Dispatcher # Додаємо Dispatcher
from aiogram.fsm.context import FSMContext
from aiogram.types import Message, CallbackQuery, ContentType
from aiogram.fsm.state import State # Потрібно для кнопки Назад
from aiogram.exceptions import TelegramBadRequest # Для обробки помилок редагування

from fsm.order_states import OrderFSM
from keyboards import inline_keyboards, reply_keyboards
from keyboards.inline_keyboards import CartCallback, PaymentCallback, OrderCallback, BackCallback
from services import (
    cart_service,
    delivery_service,
    payment_service,
    order_service,
    mydrop_service,
    notification_service,
    gdrive_service,
    xml_parser, # Потрібен для розрахунку часткової оплати
)
from config_reader import config # Потрібен для фінального підтвердження

logger = logging.getLogger(__name__) # Ініціалізуємо логер
router = Router()

# --- Валідація (без змін) ---
def is_valid_pib(text: str) -> str | None:
    parts = text.strip().split()
    if not (2 <= len(parts) <= 3): return None
    for part in parts:
        if not re.fullmatch(r"[А-ЯҐЄІЇа-яґєії'\-]+", part): return None
    formatted_parts = [p.capitalize() for p in parts]
    return " ".join(formatted_parts)

def is_valid_phone(text: str) -> str | None:
    digits_only = re.sub(r'\D', '', text)
    match = re.match(r'^(?:380|0)(\d{9})$', digits_only)
    if match: return f"+380{match.group(1)}"
    return None

# --- Початок оформлення, ПІБ, Телефон (без змін, крім видалення reply клавіатури) ---
@router.callback_query(CartCallback.filter(F.action == "checkout"))
async def cb_start_checkout(callback: CallbackQuery, state: FSMContext):
    user_id = callback.from_user.id
    cart = await cart_service.get_cart(user_id)
    if not cart.get("items"):
        await callback.answer("Ваш кошик порожній!", show_alert=True)
        return
    await callback.message.edit_text("✍️ Введіть ваше повне ім'я:")
    await state.set_state(OrderFSM.awaiting_name)
    await callback.answer()

@router.message(OrderFSM.awaiting_name, F.text)
async def process_name(message: Message, state: FSMContext):
    validated_name = is_valid_pib(message.text)
    if not validated_name:
        await message.answer("❌ Введіть коректне ім'я та прізвище.")
        return
    await state.update_data(customer_name=validated_name)
    await message.answer("📞 Надішліть номер телефону:", reply_markup=reply_keyboards.get_phone_request_keyboard())
    await state.set_state(OrderFSM.awaiting_phone)

@router.message(OrderFSM.awaiting_phone, (F.text | F.contact))
async def process_phone(message: Message, state: FSMContext):
    phone_number = message.contact.phone_number if message.contact else message.text
    validated_phone = is_valid_phone(phone_number)
    if not validated_phone:
        await message.answer("❌ Некоректний формат номера.")
        return
    await state.update_data(customer_phone=validated_phone)
    msg_to_delete = None
    try:
        sent_msg = await message.answer("🚚 Оберіть спосіб доставки:", reply_markup=inline_keyboards.get_delivery_type_keyboard())
        # Видаляємо reply клавіатуру, відправивши порожню і видаливши повідомлення
        msg_to_delete = await message.answer("...", reply_markup=reply_keyboards.remove_kb)
        await msg_to_delete.delete()
    except Exception as e:
        logger.error(f"Помилка при видаленні reply клавіатури: {e}")
        if msg_to_delete: try: await msg_to_delete.delete() except: pass
    await state.set_state(OrderFSM.awaiting_delivery_choice)


# --- Універсальний обробник кнопки "Назад" ---
@router.callback_query(BackCallback.filter())
async def process_back_button(callback: CallbackQuery, state: FSMContext, callback_data: BackCallback, dp: Dispatcher): # Додали dp
    target_state_str = callback_data.to
    current_state_str = (await state.get_state())

    # Логіка для "previous_delivery_step"
    if target_state_str == 'previous_delivery_step':
        user_data = await state.get_data()
        delivery_type = user_data.get('delivery_type')
        if delivery_type == 'branch':
            service = user_data.get('delivery_service')
            if service == 'Нова Пошта': target_state_str = OrderFSM.awaiting_np_warehouse.state
            elif service == 'Укрпошта': target_state_str = OrderFSM.awaiting_ukrposhta_address.state
            else: target_state_str = OrderFSM.awaiting_delivery_service.state
        elif delivery_type == 'courier': target_state_str = OrderFSM.awaiting_courier_address.state
        else: target_state_str = OrderFSM.awaiting_delivery_choice.state # Самовивіз або помилка

    # Головне меню
    if target_state_str == 'main_menu':
        await state.clear()
        try: await callback.message.edit_text("👋 Головне меню:", reply_markup=inline_keyboards.get_main_menu_keyboard())
        except TelegramBadRequest:
             await callback.message.answer("👋 Головне меню:", reply_markup=inline_keyboards.get_main_menu_keyboard())
             try: await callback.message.delete()
             except: pass
        await callback.answer("Повернення до головного меню.")
        return

    # Знаходимо об'єкт State за допомогою states_map_inv
    target_state: State | None = OrderFSM.states_map_inv.get(target_state_str)

    if target_state is None:
        logger.error(f"Не вдалося знайти стан '{target_state_str}' для кнопки 'Назад'")
        await state.clear()
        await callback.message.edit_text("Помилка навігації. Головне меню.", reply_markup=inline_keyboards.get_main_menu_keyboard())
        await callback.answer("Помилка", show_alert=True)
        return

    # --- Відображення повідомлень та клавіатур ---
    await state.set_state(target_state)
    message_text = "↩️ Повернення до попереднього кроку.\n\n"
    reply_markup = None
    edit_mode = True

    # Визначаємо текст та клавіатуру для кожного стану
    if target_state == OrderFSM.awaiting_name: message_text += "Введіть ваше ПІБ:"
    elif target_state == OrderFSM.awaiting_phone:
        message_text += "Надішліть номер телефону:"; reply_markup = reply_keyboards.get_phone_request_keyboard(); edit_mode = False
    elif target_state == OrderFSM.awaiting_delivery_choice:
        message_text += "Оберіть спосіб доставки:"; reply_markup = inline_keyboards.get_delivery_type_keyboard()
    elif target_state == OrderFSM.awaiting_delivery_service:
        message_text += "Оберіть службу доставки:"; reply_markup = inline_keyboards.get_delivery_service_keyboard()
    elif target_state == OrderFSM.awaiting_city: message_text += "Введіть назву населеного пункту (для НП):"
    elif target_state == OrderFSM.awaiting_np_warehouse: message_text += "Введіть номер або адресу відділення НП:"
    elif target_state == OrderFSM.awaiting_ukrposhta_address: message_text += "Введіть повну адресу для Укрпошти (індекс, місто, вулиця, дім):"
    elif target_state == OrderFSM.awaiting_courier_address: message_text += "Введіть адресу для кур'єра (місто, вулиця, дім):"
    elif target_state == OrderFSM.awaiting_payment_choice:
        message_text += "Оберіть спосіб оплати:"; reply_markup = inline_keyboards.get_payment_method_keyboard()
    elif target_state == OrderFSM.awaiting_notes:
        message_text += "Додайте примітку або пропустіть:"; reply_markup = inline_keyboards.get_skip_notes_keyboard()
    else: message_text += "Продовжуйте." # Generic

    # Надсилаємо або редагуємо повідомлення
    try:
        if edit_mode: await callback.message.edit_text(message_text, reply_markup=reply_markup)
        else:
            try: await callback.message.delete() # Видаляємо старе inline
            except: pass # Ігноруємо помилку, якщо вже видалено
            await callback.message.answer(message_text, reply_markup=reply_markup) # Надсилаємо нове з reply
    except TelegramBadRequest as e:
        logger.warning(f"Помилка edit/send 'Назад': {e}. Спроба відправити нове.")
        try:
            await callback.message.answer(message_text, reply_markup=reply_markup)
            try: await callback.message.delete() # Спробувати видалити старе
            except: pass
        except Exception as inner_e: logger.error(f"Не вдалося відправити нове 'Назад': {inner_e}")
    await callback.answer("Повернення назад")


# --- Обробники вибору доставки (ОНОВЛЕНО) ---

@router.callback_query(F.data.startswith("delivery_type:"), OrderFSM.awaiting_delivery_choice)
async def select_delivery_type(callback: CallbackQuery, state: FSMContext):
    delivery_type = callback.data.split(":")[1]
    await state.update_data(delivery_type=delivery_type)
    if delivery_type == 'branch':
        await callback.message.edit_text("Оберіть службу доставки:", reply_markup=inline_keyboards.get_delivery_service_keyboard())
        await state.set_state(OrderFSM.awaiting_delivery_service)
    elif delivery_type == 'courier':
        await state.update_data(delivery_service="Кур'єр Нової Пошти") # TODO: Додати вибір служби
        await callback.message.edit_text("🏠 Введіть адресу кур'єра (місто, вулиця, дім):")
        await state.set_state(OrderFSM.awaiting_courier_address)
    elif delivery_type == 'pickup':
        await state.update_data(delivery_service="Самовивіз", delivery_city_name="Самовивіз", delivery_warehouse="За ТТН")
        await callback.message.edit_text("✅ Самовивіз.\nОберіть спосіб оплати:", reply_markup=inline_keyboards.get_payment_method_keyboard())
        await state.set_state(OrderFSM.awaiting_payment_choice)
    await callback.answer()

@router.callback_query(F.data.startswith("delivery_service:"), OrderFSM.awaiting_delivery_service)
async def select_delivery_service(callback: CallbackQuery, state: FSMContext):
    service = callback.data.split(":")[1]; message_text, next_state = "", None
    if service == 'np':
        await state.update_data(delivery_service="Нова Пошта")
        message_text = "🏙️ Введіть місто:"; next_state = OrderFSM.awaiting_city
    elif service == 'ukrpost':
        await state.update_data(delivery_service="Укрпошта")
        message_text = "📬 Введіть повну адресу (індекс, місто, вулиця, дім):"; next_state = OrderFSM.awaiting_ukrposhta_address
    else: await callback.answer("Невідома служба."); return
    await callback.message.edit_text(message_text); await state.set_state(next_state); await callback.answer()

# Обробники НП (без змін)
@router.message(OrderFSM.awaiting_city, F.text)
async def process_city_np(message: Message, state: FSMContext):
    cities = await delivery_service.find_np_city(message.text)
    if not cities: await message.answer("❌ Не знайдено. Спробуйте ще раз."); return
    selected_city = cities[0]; city_name = selected_city.get("Present"); city_ref = selected_city.get("Ref")
    await state.update_data(delivery_city_name=city_name, delivery_city_ref=city_ref)
    await message.answer(f"✅ Місто: {city_name}.\nВведіть номер/адресу відділення:"); await state.set_state(OrderFSM.awaiting_np_warehouse)

@router.message(OrderFSM.awaiting_np_warehouse, F.text)
async def process_warehouse_np(message: Message, state: FSMContext):
    user_data = await state.get_data(); city_ref = user_data.get("delivery_city_ref")
    warehouses = await delivery_service.find_np_warehouses(city_ref, message.text)
    if not warehouses: await message.answer("❌ Не знайдено відділення. Спробуйте ще раз."); return
    selected_warehouse = warehouses[0]; warehouse_desc = selected_warehouse.get("Description")
    await state.update_data(delivery_warehouse=warehouse_desc)
    await message.answer(f"✅ Відділення: {warehouse_desc}.\nОберіть спосіб оплати:", reply_markup=inline_keyboards.get_payment_method_keyboard()); await state.set_state(OrderFSM.awaiting_payment_choice)

# Обробник адреси для Укрпошти
@router.message(OrderFSM.awaiting_ukrposhta_address, F.text)
async def process_ukrposhta_address(message: Message, state: FSMContext):
    address = message.text.strip()
    # Посилюємо перевірку: 5 цифр індексу на початку, потім хоча б 2 слова
    if not re.match(r'^\d{5}\s+\S+\s+\S+', address):
        await message.answer("❌ Введіть адресу у форматі: Індекс Місто Вулиця Дім (напр., 58000 Чернівці Головна 1)")
        return
    # Зберігаємо місто окремо, якщо можливо (беремо друге слово)
    parts = address.split()
    city_name = parts[1] if len(parts) > 1 else "Укрпошта"
    await state.update_data(delivery_city_name=city_name, delivery_warehouse=address)
    await message.answer("✅ Адресу збережено.\nОберіть спосіб оплати:", reply_markup=inline_keyboards.get_payment_method_keyboard())
    await state.set_state(OrderFSM.awaiting_payment_choice)

# Обробник адреси для кур'єра
@router.message(OrderFSM.awaiting_courier_address, F.text)
async def process_courier_address(message: Message, state: FSMContext):
    address = message.text.strip()
    if len(address.split()) < 3:
        await message.answer("❌ Введіть повну адресу (Місто Вулиця Дім).")
        return
    parts = address.split(maxsplit=1); city = parts[0]; street_house = parts[1] if len(parts) > 1 else ""
    await state.update_data(delivery_city_name=city, delivery_warehouse=f"Кур'єр: {street_house}")
    await message.answer("✅ Адресу збережено.\nОберіть спосіб оплати:", reply_markup=inline_keyboards.get_payment_method_keyboard())
    await state.set_state(OrderFSM.awaiting_payment_choice)


# --- Обробка оплати, приміток, підтвердження (ОНОВЛЕНО з кнопкою Назад) ---

@router.callback_query(PaymentCallback.filter(), OrderFSM.awaiting_payment_choice)
async def process_payment_choice(callback: CallbackQuery, callback_data: PaymentCallback, state: FSMContext):
    user_id = callback.from_user.id; payment_method = callback_data.method
    await state.update_data(payment_method=payment_method)
    cart = await cart_service.get_cart(user_id); total_sum = sum(item['final_price'] * item['quantity'] for item in cart.get("items", []))
    order_id = str(uuid.uuid4().hex[:10]); await state.update_data(order_id=order_id)

    if payment_method == 'cod':
        await state.update_data(payment_display_name="Накладений платіж")
        await callback.message.edit_text("✍️ Додайте примітку або пропустіть:", reply_markup=inline_keyboards.get_skip_notes_keyboard())
        await state.set_state(OrderFSM.awaiting_notes)
    elif payment_method in ['full', 'partial']:
        amount_to_pay, payment_display_name = 0, ""
        if payment_method == 'full': amount_to_pay = total_sum; payment_display_name = "Повна передоплата"
        else: # partial
            try:
                # Використовуємо _aggressive_rounding з xml_parser
                partial_sum = sum(xml_parser._aggressive_rounding(Decimal(item['final_price']) / Decimal('1.33') * Decimal('0.33')) * item['quantity'] for item in cart.get("items", []) if isinstance(item['final_price'], (int, float)) or str(item.get('final_price','')).isdigit()) # Додано get
                amount_to_pay = partial_sum if partial_sum > 0 else int(total_sum * 0.33)
            except Exception as e: logger.error(f"Помилка розрахунку часткової оплати: {e}"); amount_to_pay = int(total_sum * 0.33)
            payment_display_name = "Часткова передоплата"
        await state.update_data(payment_display_name=payment_display_name)
        payment_link = await payment_service.create_payment_link(order_id, amount_to_pay, f"Замовлення #{order_id}")
        if not payment_link: await callback.answer("Помилка оплати.", show_alert=True); return
        keyboard = inline_keyboards.get_payment_url_keyboard(payment_link, order_id)
        await callback.message.edit_text(f"Сума: {amount_to_pay} грн. Оплатіть та натисніть 'Я оплатив(-ла)'.", reply_markup=keyboard)
    await callback.answer()

@router.callback_query(OrderCallback.filter(F.action == 'check_payment'), OrderFSM.awaiting_payment_choice)
async def check_payment(callback: CallbackQuery, callback_data: OrderCallback, state: FSMContext):
    is_paid = await payment_service.check_payment_status(callback_data.order_id)
    if is_paid:
        await callback.answer("✅ Оплата успішна!", show_alert=True)
        await callback.message.edit_text("✍️ Додайте примітку або пропустіть:", reply_markup=inline_keyboards.get_skip_notes_keyboard())
        await state.set_state(OrderFSM.awaiting_notes)
    else: await callback.answer("❌ Оплата ще не надійшла.", show_alert=True)

@router.callback_query(F.data == "notes:skip", OrderFSM.awaiting_notes)
async def process_skip_notes(callback: CallbackQuery, state: FSMContext):
    await state.update_data(notes=None)
    await show_final_confirmation(callback, state) # Передаємо callback
    await callback.answer()

@router.message(OrderFSM.awaiting_notes, F.text)
async def process_notes(message: Message, state: FSMContext):
    await state.update_data(notes=message.text)
    await show_final_confirmation(message, state)

# Функція показу фінального підтвердження (ОНОВЛЕНО)
async def show_final_confirmation(target: types.Message | types.CallbackQuery, state: FSMContext):
    user_id = target.from_user.id
    message = target.message if isinstance(target, types.CallbackQuery) else target

    user_data = await state.get_data(); cart = await cart_service.get_cart(user_id)
    cart_items = cart.get("items", []); total_sum = sum(item['final_price'] * item['quantity'] for item in cart_items)
    items_text = "".join([f"▪️ {item['name']} ({item['size']}) - {item['quantity']} шт. x {item['final_price']} грн\n" for item in cart_items])

    delivery_details = ""; delivery_service_name = user_data.get('delivery_service', 'Не обрано')
    delivery_city = user_data.get('delivery_city_name', ''); delivery_warehouse = user_data.get('delivery_warehouse', '')
    if delivery_service_name == "Самовивіз": delivery_details = f"🏢 <b>Спосіб:</b> {delivery_service_name}"
    elif "Кур'єр" in delivery_service_name: delivery_details = f"🏠 <b>Спосіб:</b> {delivery_service_name}\n📍 <b>Адреса:</b> {delivery_city}, {delivery_warehouse.replace('Курєр: ', '')}" # Прибираємо префікс
    elif delivery_service_name == "Укрпошта": delivery_details = f"📬 <b>Служба:</b> {delivery_service_name}\n📍 <b>Адреса:</b> {delivery_warehouse}"
    elif delivery_service_name == "Нова Пошта": delivery_details = f"🚚 <b>Служба:</b> {delivery_service_name}\n📍 <b>Місто:</b> {delivery_city}\n🏤 <b>Відділення:</b> {delivery_warehouse}"
    else: delivery_details = "🚚 <b>Доставка:</b> Не вказано"

    summary_text = f"""
    <b>⚠️ Будь ласка, перевірте ваше замовлення:</b>

    👤 <b>Отримувач:</b> {user_data.get('customer_name')}
    📞 <b>Телефон:</b> {user_data.get('customer_phone')}

    {delivery_details}

    💳 <b>Оплата:</b> {user_data.get('payment_display_name', 'Не обрано')}
    📝 <b>Примітка:</b> {user_data.get('notes', 'немає')}

    🛒 <b>Товари:</b>
{items_text}
    💰 <b>Загальна сума: {total_sum} грн</b>
    """
    keyboard = inline_keyboards.get_final_confirmation_keyboard(user_data.get('order_id'))
    try:
        if isinstance(target, types.CallbackQuery): await message.edit_text(summary_text, reply_markup=keyboard)
        else: await message.answer(summary_text, reply_markup=keyboard)
    except TelegramBadRequest as e:
        logger.warning(f"Помилка edit confirm: {e}. Нове повідомлення.")
        await message.answer(summary_text, reply_markup=keyboard)
    await state.set_state(OrderFSM.awaiting_confirmation)

# Фінальне підтвердження та скасування (без змін)
@router.callback_query(OrderCallback.filter(F.action == 'confirm'), OrderFSM.awaiting_confirmation)
async def final_confirm(callback: CallbackQuery, state: FSMContext, bot: Bot):
    await callback.message.edit_text("⏳ Обробляємо...")
    user_data = await state.get_data(); cart = await cart_service.get_cart(callback.from_user.id)
    order_id = user_data.get('order_id'); supplier_name = "Landliz Drop" # TODO: Динамічно
    full_order_data = {**user_data, "order_id": order_id, "cart": cart, "supplier_name": supplier_name, "customer_id": callback.from_user.id}
    mydrop_response = await mydrop_service.create_order(full_order_data)
    if mydrop_response.get("success"): ttn = mydrop_response.get("ttn"); full_order_data['ttn'] = ttn # Тепер ttn це словник
    else: await callback.message.edit_text("❌ Помилка створення замовлення."); return
    filename = order_service.generate_order_filename(order_id, user_data.get('customer_name'))
    txt_content = order_service.format_order_to_txt(full_order_data)
    if config.use_gdrive:
        try:
             # Використовуємо photo_filename як ім'я для .txt файлу
             await gdrive_service.save_order_txt(txt_content.encode('utf-8'), filename=filename) # Потрібна нова функція в gdrive_service
        except Exception as e: logger.error(f"Помилка GDrive TXT: {e}")
    await notification_service.send_new_order_notifications(bot, full_order_data, txt_content, filename)
    await state.clear(); await cart_service.clear_cart(callback.from_user.id)
    try: await callback.message.delete()
    except: pass
    await callback.answer("Замовлення підтверджено!")

@router.callback_query(OrderCallback.filter(F.action == 'cancel'), OrderFSM.awaiting_confirmation)
async def final_cancel(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.edit_text("❌ Замовлення скасовано.", reply_markup=inline_keyboards.get_main_menu_keyboard())
    await callback.answer()