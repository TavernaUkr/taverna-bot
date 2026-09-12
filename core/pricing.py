import math

def calculate_final_price(drop_price: float) -> float:
    """
    Розрахунок фінальної ціни клієнта на основі ціни постачальника (дроп).
    Логіка:
    - до 1000 грн: +33%, округлення до 10 грн.
    - 1000 - 10000 грн: +28%, округлення до 100 грн.
    - від 10000 грн: +23%, округлення до 500 грн.
    """
    if drop_price < 1000:
        margin = 1.33
        step = 10
    elif 1000 <= drop_price < 10000:
        margin = 1.28
        step = 100
    else:
        margin = 1.23
        step = 500
    
    final_price = drop_price * margin
    # Агресивне округлення вгору до найближчого кроку (step)
    return float(math.ceil(final_price / step) * step)

# Приклад тесту для твого запиту:
# 12450 * 1.23 = 15313.5 -> math.ceil(15313.5 / 500) * 500 = 15500