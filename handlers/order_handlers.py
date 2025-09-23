# handlers/order_handlers.py
import re
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, ContentType
from aiogram.fsm.context import FSMContext

# Імпортуємо абсолютно все, що нам потрібно
from fsm.order_states import OrderFSM
from keyboards import inline_keyboards, reply_keyboards
# from services import cart_service, mydrop_service, gdrive_service

# Створюємо роутер для цього файлу
router = Router()

# --- 1. Початок оформлення замовлення ---
@router.callback_query(F.data == "start_checkout")
async def cb_start_checkout(callback: CallbackQuery, state: FSMContext):
    """
    Починає процес оформлення замовлення.
    Спрацьовує після натискання кнопки "Перейти до оформлення" в кошику.
    """
    # TODO: Перевірити, чи кошик не порожній
    # cart_items = await cart_service.get_cart(callback.from_user.id)
    # if not cart_items:
    #     await callback.answer("Ваш кошик порожній!", show_alert=True)
    #     return

    await callback.message.edit_text("✍️ Для оформлення замовлення, будь ласка, введіть ваше повне ім'я (Прізвище Ім'я По-батькові):")
    await state.set_state(OrderFSM.awaiting_name)
    await callback.answer()

# --- 2. Обробка введеного імені ---
@router.message(OrderFSM.awaiting_name, F.text)
async def process_name(message: Message, state: FSMContext):
    """Ловить ПІБ, валідує його і запитує номер телефону."""
    full_name = message.text.strip()
    if len(full_name.split()) < 2:
        await message.answer("❌ Будь ласка, введіть коректне повне ім'я (мінімум 2 слова).")
        return

    # Зберігаємо дані в "блокнот" FSM
    await state.update_data(customer_name=full_name)
    await message.answer(
        "📞 Дякую! Тепер надішліть ваш номер телефону або натисніть кнопку нижче.",
        reply_markup=reply_keyboards.get_phone_request_keyboard()
    )
    await state.set_state(OrderFSM.awaiting_phone)

# --- 3. Обробка номера телефону ---
@router.message(OrderFSM.awaiting_phone, (F.text | F.contact))
async def process_phone(message: Message, state: FSMContext):
    """Ловить номер телефону (текстом або через контакт) і валідує."""
    if message.contact:
        phone_number = message.contact.phone_number
    else:
        # Ваша надійна валідація з регулярним виразом
        phone_match = re.match(r'^\+?3?8?(0\d{9})$', message.text.strip())
        if not phone_match:
            await message.answer("❌ Некоректний формат номера. Спробуйте формат +380xxxxxxxxx або 0xxxxxxxxx.")
            return
        phone_number = f"+38{phone_match.group(1)}"
    
    await state.update_data(customer_phone=phone_number)
    
    # Видаляємо Reply-клавіатуру та питаємо про доставку
    await message.answer(
        "🚚 Чудово! Виберіть спосіб доставки:",
        reply_markup=reply_keyboards.get_delivery_choice_keyboard()
    )
    await state.set_state(OrderFSM.awaiting_delivery_choice)

# --- 4. Обробка вибору доставки і наступні кроки (каркас) ---
# Подальші хендлери будуть побудовані за тим же принципом
@router.message(OrderFSM.awaiting_delivery_choice, F.text.in_(['Нова Пошта', 'Укрпошта']))
async def process_delivery_choice(message: Message, state: FSMContext):
    delivery_type = message.text
    await state.update_data(delivery_type=delivery_type)
    
    # TODO: Тут буде логіка інтеграції з API пошти
    # Наприклад, запит міста
    await message.answer(f"Ви обрали: {delivery_type}. Введіть ваше місто:", reply_markup=reply_keyboards.remove_kb)
    await state.set_state(OrderFSM.awaiting_city)
    
# --- Останній крок: Підтвердження ---
@router.message(OrderFSM.awaiting_confirmation) # Припустимо, ми потрапили сюди
async def process_final_confirmation(message: Message, state: FSMContext):
    # Збираємо всі дані з "блокнота" FSM
    order_data = await state.get_data()
    # cart_items = await cart_service.get_cart(message.from_user.id)
    
    # Формуємо фінальне повідомлення
    summary_text = f"""
    ✅ Ваше замовлення майже готове! Будь ласка, перевірте дані:
    
    👤 **Отримувач:** {order_data.get('customer_name')}
    📞 **Телефон:** {order_data.get('customer_phone')}
    🚚 **Доставка:** {order_data.get('delivery_type')}
    
    📝 **Товари:**
    { "Тут буде список товарів з кошика" }
    
    💰 **До сплати: { "Тут буде фінальна сума" }**
    """
    
    await message.answer(summary_text, reply_markup=inline_keyboards.get_order_confirmation_keyboard())

# --- Обробка фінального підтвердження або скасування ---
@router.callback_query(F.data == "confirm_order")
async def cb_confirm_order(callback: CallbackQuery, state: FSMContext):
    # ================== TODO: МАЙБУТНЯ ІНТЕГРАЦІЯ ==================
    # 1. Сформувати фінальний об'єкт замовлення
    # 2. Відправити замовлення в MyDrop API (mydrop_service)
    # 3. Створити Google Sheet (gdrive_service)
    # 4. Надіслати сповіщення адміну
    # 5. Очистити кошик користувача (cart_service)
    # ===============================================================
    
    await callback.message.edit_text("🎉 Дякуємо! Ваше замовлення прийнято в обробку. Наш менеджер скоро з вами зв'яжеться.")
    await state.clear() # Очищуємо стан після успішного замовлення
    await callback.answer()

@router.callback_query(F.data == "cancel_order")
async def cb_cancel_order(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.edit_text(
        "❌ Ваше замовлення скасовано. Ви можете почати знову з головного меню.",
        reply_markup=inline_keyboards.get_main_menu_keyboard()
    )
    await callback.answer()