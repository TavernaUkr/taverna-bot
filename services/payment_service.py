# services/payment_service.py
import logging
from uuid import uuid4

logger = logging.getLogger(__name__)

# --- Тестовий режим (Sandbox) ---
# У майбутньому тут буде інтеграція з LiqPay API

async def create_payment_link(order_id: str, amount: int, description: str) -> str | None:
    """
    ІМІТУЄ створення платіжного посилання.
    У бойовому режимі ця функція буде звертатися до API LiqPay.
    Зараз вона просто повертає безпечне посилання-заглушку.
    """
    logger.info(f"Створення ТЕСТОВОГО платіжного посилання для замовлення {order_id} на суму {amount} грн.")
    
    # Створюємо унікальне посилання-заглушку для імітації
    # У реальності тут буде URL від LiqPay
    test_payment_url = f"https://www.liqpay.ua/api/3/checkout?data=eyJ2ZXJzaW9uIjoiMy...&signature=...{uuid4()}"
    
    # Уявімо, що ми зберегли цей платіж у нашій базі для подальшої перевірки
    # db.save_payment(order_id, amount, status='pending')
    
    return test_payment_url

async def check_payment_status(order_id: str) -> bool:
    """
    ІМІТУЄ перевірку статусу платежу.
    У бойовому режимі ця функція буде запитувати статус у LiqPay.
    Зараз вона завжди повертає True для тестування.
    """
    logger.info(f"Перевірка ТЕСТОВОГО статусу платежу для замовлення {order_id}.")
    
    # Уявімо, що ми звернулись до LiqPay і отримали статус "success"
    # status = liqpay.api("request", {"action": "status", "order_id": order_id})
    # return status == 'success'
    
    return True