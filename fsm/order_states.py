# fsm/order_states.py
from aiogram.fsm.state import StatesGroup, State

class OrderFSM(StatesGroup):
    # --- Стани для пошуку та вибору товару ---
    awaiting_article_search = State() # Очікування текстового вводу SKU/назви
    awaiting_quantity = State()       # Очікування вводу кількості
    
    # --- Стани для оформлення замовлення (Checkout) ---
    awaiting_name = State()           # Очікування ПІБ
    awaiting_phone = State()          # Очікування телефону
    awaiting_delivery_service = State() # Очікування вибору "Нова Пошта" / "Укрпошта"
    awaiting_address = State()        # Очікування адреси (місто, відділення)
    awaiting_payment_type = State()   # Очікування вибору типу оплати
    awaiting_note = State()           # Очікування примітки
    awaiting_confirmation = State()   # Очікування фінального підтвердження