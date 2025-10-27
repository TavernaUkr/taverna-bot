# fsm/order_states.py
from aiogram.fsm.state import State, StatesGroup

class OrderFSM(StatesGroup):
    """
    Клас, що визначає всі можливі стани користувача в процесі
    пошуку товару та оформлення замовлення.
    """
    # --- Етап 1: Пошук та вибір товару ---
    awaiting_sku_search = State()      # Очікування введення артикула/назви для пошуку
    awaiting_quantity = State()        # Очікування введення кількості товару

    # --- Етап 2: Оформлення замовлення (Контактна інформація) ---
    awaiting_name = State()            # Очікування введення ПІБ
    awaiting_phone = State()           # Очікування введення номера телефону

    # --- Етап 3: Вибір та деталізація доставки ---
    awaiting_delivery_choice = State() # Очікування вибору типу (Відділення/Кур'єр/Самовивіз)
    awaiting_delivery_service = State()# Очікування вибору служби (НП/Укрпошта)
    awaiting_city = State()            # Очікування введення міста (для НП)
    awaiting_np_warehouse = State()    # Очікування введення відділення Нової Пошти
    awaiting_ukrposhta_address = State() # Очікування введення повної адреси для Укрпошти (індекс, місто, вулиця, дім)
    awaiting_courier_address = State() # Очікування введення повної адреси для кур'єра (місто, вулиця, дім)

    # --- Етап 4: Оплата та завершення ---
    awaiting_payment_choice = State()  # Очікування вибору способу оплати
    awaiting_notes = State()           # Очікування введення приміток до замовлення
    awaiting_confirmation = State()    # Очікування фінального підтвердження замовлення

    # Додаємо словник для зручного доступу до станів за іменем (для кнопки Назад)
    states_map_inv = {state.state: state for state in [
        awaiting_sku_search, awaiting_quantity, awaiting_name, awaiting_phone,
        awaiting_delivery_choice, awaiting_delivery_service, awaiting_city,
        awaiting_np_warehouse, awaiting_ukrposhta_address, awaiting_courier_address,
        awaiting_payment_choice, awaiting_notes, awaiting_confirmation
    ]}