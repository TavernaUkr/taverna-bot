# keyboards/reply_keyboards.py
from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove

def get_phone_request_keyboard() -> ReplyKeyboardMarkup:
    """Створює клавіатуру із запитом на відправку контакту."""
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="📱 Надіслати мій номер", request_contact=True)]],
        resize_keyboard=True,
        one_time_keyboard=True # Клавіатура зникне після натискання
    )

def get_delivery_choice_keyboard() -> ReplyKeyboardMarkup:
    """Створює клавіатуру для вибору способу доставки."""
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="Нова Пошта")],
            [KeyboardButton(text="Укрпошта")]
        ],
        resize_keyboard=True,
        one_time_keyboard=True
    )

# Створюємо готовий об'єкт для видалення Reply-клавіатури
remove_kb = ReplyKeyboardRemove()