# services/payment_service.py
import logging
import base64
import hashlib
import json
import aiohttp
from typing import Dict, Any, Optional, List
from config_reader import config
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

class LiqPayAPI:
    """
    Клас для роботи з LiqPay (оплати, чеки).
    """
    def __init__(self, public_key: str, private_key: str):
        self.public_key = public_key
        self.private_key = private_key
        self.api_url = "https://www.liqpay.ua/api/3/checkout" # URL для сторінки оплати

    def _generate_signature(self, data_str: str) -> str:
        """Генерує підпис LiqPay (Private Key + Data + Private Key)."""
        combined = self.private_key + data_str + self.private_key
        signature = base64.b64encode(hashlib.sha1(combined.encode('utf-8')).digest()).decode('utf-8')
        return signature

    def create_payment_form_data(
        self, 
        amount: int, 
        order_uid: str, 
        description: str,
        user_id: int,
        cart_items: List[Dict[str, Any]] # <-- НОВЕ (для Checkbox)
    ) -> Dict[str, str]:
        """
        (Фаза 4.1) Готує дані та підпис для кнопки оплати LiqPay в MiniApp.
        """
        params = {
            'action': 'pay',
            'amount': str(amount),
            'currency': 'UAH',
            'description': description,
            'order_id': order_uid,
            'version': '3',
            'public_key': self.public_key,
            'result_url': f"{str(config.webapp_url)}/payment-success", # Сторінка "Дякуємо"
            'server_url': f"{str(config.api_url)}/api/v1/payment/callback", # Наш API для підтвердження
            'sandbox': '1', # 1 = Тестовий режим (використовуємо твої sandbox_ ключі), 0 = Бойовий
            'user_id': str(user_id), # Додаємо ID користувача
            'paytypes': 'card,privat24,paypart,googlePay,applePay' # (Твій План 23G+O)
        }
        
        # --- [ПЛАН 18] Інтеграція з Checkbox ---
        if checkbox_api and checkbox_api.is_configured():
            logger.info(f"Додаю фіскалізацію Checkbox для {order_uid}...")
            # Готуємо список товарів для чеку
            goods = []
            for item in cart_items:
                goods.append({
                    'name': item.get("name"),
                    'price': item.get("price") * 100, # в копійках
                    'quantity': item.get("quantity") * 1000, # в 1/1000 (для ваги)
                    'code': item.get("sku")
                })
            
            # https://wiki.checkbox.ua/uk/instructions/acquiring/internet-acquiring
            params['fiscalization'] = {
                'service': 'checkbox',
                'cashier_id': config.checkbox_cashier_id,
                'kassa_id': config.checkbox_kassa_id,
                'goods': goods
            }
            logger.info(f"Дані фіскалізації для {order_uid} додано.")
        else:
            logger.warning(f"Checkbox не налаштовано (ключі: {config.checkbox_login}, {config.checkbox_kassa_id}). Платіж {order_uid} пройде БЕЗ фіскалізації.")

        # Кодуємо дані в JSON, потім в Base64
        data_str = base64.b64encode(json.dumps(params).encode('utf-8')).decode('utf-8')
        signature = self._generate_signature(data_str)
        
        # Повертаємо `data` та `signature` для HTML-форми
        return {'data': data_str, 'signature': signature}

    def validate_callback(self, data_str_base64: str, signature: str) -> bool:
        """
        Перевіряє, чи callback-запит від LiqPay є справжнім.
        """
        expected_signature = self._generate_signature(data_str_base64)
        return hmac.compare_digest(expected_signature, signature)

class CheckboxAPI:
    """
    Клас для роботи з API фіскалізації Checkbox.
    https://wiki.checkbox.ua/uk/api
    """
    def __init__(self, login: str, password: str, license_key: str):
        self.api_url = "https://api.checkbox.ua/api/v1"
        self.login = login
        self.password = password
        self.license_key = license_key # Ключ ліцензії каси (testfd98...)
        self.access_token = None # Будемо отримувати
        self.token_expires_at = datetime.now(timezone.utc)
    
    def is_configured(self) -> bool:
        return bool(self.login and self.password and self.license_key)

    async def _get_access_token(self) -> Optional[str]:
        """Отримує токен касира для роботи з API (з кешуванням)."""
        # Перевіряємо, чи токен ще дійсний
        if self.access_token and datetime.now(timezone.utc) < self.token_expires_at:
            return self.access_token
            
        if not self.is_configured():
            logger.error("Checkbox: Не можу отримати токен, сервіс не налаштовано.")
            return None
            
        try:
            headers = {'X-License-Key': self.license_key}
            payload = {'login': self.login, 'password': self.password}
            async with aiohttp.ClientSession() as session:
                async with session.post(f"{self.api_url}/cashier/signin", json=payload, headers=headers) as resp:
                    resp.raise_for_status()
                    data = await resp.json()
                    self.access_token = data.get('access_token')
                    # Кешуємо токен на 23 години (він дійсний 24)
                    self.token_expires_at = datetime.now(timezone.utc) + timedelta(hours=23)
                    logger.info("Checkbox: Отримано НОВИЙ токен доступу касира.")
                    return self.access_token
        except Exception as e:
            logger.error(f"Checkbox: Помилка отримання токену: {e}")
            return None
            
    async def create_receipt(self, payment_data: dict, order_items: List[dict]) -> Optional[dict]:
        """
        Створює фіскальний чек (якщо оплата пройшла не через LiqPay, а іншим чином).
        """
        if not self.is_configured(): return None
        
        token = await self._get_access_token()
        if not token: return None
            
        headers = {
            'Authorization': f'Bearer {token}',
            'X-License-Key': self.license_key
        }
        
        goods = []
        for item in order_items:
            goods.append({
                "good": {
                    "code": item.get("sku"),
                    "name": item.get("name"),
                    "price": item.get("price") * 100 # в копійках
                },
                "quantity": item.get("quantity") * 1000 # в 1/1000 (для ваги)
            })
        
        payload = {
            "goods": goods,
            "payments": [{
                "type": "CARD", # Оплата карткою
                "value": payment_data.get("total_price") * 100 # в копійках
            }],
            # TODO: Додати інтеграцію з НП для накладних (План 18)
            # https://wiki.checkbox.ua/uk/api/receipts/sell#delivery
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(f"{self.api_url}/receipts/sell", json=payload, headers=headers) as resp:
                    resp.raise_for_status()
                    data = await resp.json()
                    logger.info(f"Checkbox: Успішно створено чек (ID: {data.get('id')})")
                    return data
        except Exception as e:
            logger.error(f"Checkbox: Помилка створення чеку: {e}")
            return None


# --- Створюємо єдині екземпляри сервісів ---

payment_api = LiqPayAPI(
    public_key=config.liqpay_public_key,
    private_key=config.liqpay_private_key.get_secret_value()
) if config.liqpay_public_key and config.liqpay_private_key else None

checkbox_api = CheckboxAPI(
    login=config.checkbox_login,
    password=config.checkbox_password.get_secret_value(),
    license_key=config.checkbox_api_key.get_secret_value()
) if config.checkbox_login and config.checkbox_password and config.checkbox_api_key else None