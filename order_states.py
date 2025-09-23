# fsm/order_states.py
from aiogram.fsm.state import State, StatesGroup


class OrderFSM(StatesGroup):
    """
    Клас, що визначає всі можливі стани користувача в процесі
    пошуку товару та оформлення замовлення.
    Це єдина "карта" шляху клієнта.
    """
    # --- Етап 1: Пошук та вибір товару ---
    awaiting_sku_search = State()      # Очікування введення артикула/назви для пошуку
    awaiting_quantity = State()        # Очікування введення кількості товару

    # --- Етап 2: Оформлення замовлення (Контактна інформація) ---
    awaiting_name = State()            # Очікування введення ПІБ
    awaiting_phone = State()           # Очікування введення номера телефону

    # --- Етап 3: Вибір та деталізація доставки ---
    awaiting_delivery_choice = State() # Очікування вибору способу доставки
    awaiting_city = State()            # Очікування введення міста
    awaiting_np_warehouse = State()    # Очікування введення відділення Нової Пошти
    awaiting_ukrposhta_address = State() # Очікування введення повної адреси для Укрпошти

    # --- Етап 4: Оплата та завершення ---
    awaiting_payment_choice = State()  # Очікування вибору способу оплати
    awaiting_notes = State()           # Очікування введення приміток до замовлення
    awaiting_confirmation = State()    # Очікування фінального підтвердження замовлення