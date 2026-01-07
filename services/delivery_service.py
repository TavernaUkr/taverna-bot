# services/delivery_service.py
import logging
import aiohttp
import asyncio # <-- НОВИЙ ІМПОРТ
from typing import Optional, Dict, Any
from config_reader import config

logger = logging.getLogger(__name__)

class NovaPoshtaFulfillmentAPI:
    """
    (Фаза 4.2) Клас для роботи з API "Нової Пошти".
    Включає JSON RPC (для MiniApp) та SOAP (для Фулфілменту).
    """
    def __init__(self, api_key: Optional[str], organization: str = "NPL_Al"):
        # API Фулфілменту (SOAP)
        self.fulfillment_api_url = "https://ff.nova-poshta.ua/ws/api.php" # Приклад, уточнити
        self.organization = organization 
        
        # Стандартне API (JSON RPC 2.0)
        self.json_api_url = "https://api.novaposhta.ua/v2.0/json/"
        self.api_key = api_key
        
    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def _make_request(self, model_name: str, called_method: str, method_properties: dict) -> Optional[Dict[str, Any]]:
        """
        (Фаза 4.2) РЕАЛІЗОВАНО: Допоміжна функція для запитів до JSON RPC API НП.
        """
        if not self.is_configured():
            logger.error("API Нової Пошти не налаштовано (NP_API_KEY).")
            return None
            
        payload = {
            "apiKey": self.api_key,
            "modelName": model_name,
            "calledMethod": called_method,
            "methodProperties": method_properties
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(self.json_api_url, json=payload, timeout=10) as resp:
                    resp.raise_for_status()
                    data = await resp.json()
                    if data.get("success"):
                        return data.get("data", [])
                    else:
                        logger.error(f"Помилка API НП ({called_method}): {data.get('errors')}")
                        return None
        except asyncio.TimeoutError:
            logger.error("Таймаут запиту до API НП.")
            return None
        except aiohttp.ClientError as e:
            logger.error(f"Помилка підключення до API НП: {e}")
            return None

    # --- API для MiniApp (Фаза 4.2) ---
    
    async def search_settlements(self, city_name: str) -> Optional[Dict[str, Any]]:
        """
        (РЕАЛІЗОВАНО) Пошук міст (для гарного вибору в MiniApp).
        """
        return await self._make_request(
            model_name="Address",
            called_method="searchSettlements",
            method_properties={"CityName": city_name, "Limit": 10}
        )

    async def get_warehouses(self, city_ref: str) -> Optional[Dict[str, Any]]:
        """
        (РЕАЛІЗОВАНО) Отримання відділень у місті (для гарного вибору в MiniApp).
        """
        return await self._make_request(
            model_name="Address",
            called_method="getWarehouses",
            method_properties={"CityRef": city_ref, "Limit": 500, "Language": "UA"}
        )

    # --- API для Фулфілменту (Фаза 3.3 - Заглушки) ---

    async def get_current_remains(self) -> Optional[Dict[str, Any]]:
        """
        Метод "GetCurrentRemains" (поточні залишки).
        """
        logger.info("Виклик 'GetCurrentRemains' (поки що заглушка)...")
        # TODO: Реалізувати SOAP/XML запит
        return {"sku": "example_sku", "quantity": 10}

    async def create_update_orders(self, order_data: dict) -> Optional[Dict[str, Any]]:
        """
        Метод "CreateUpdateOrders" (створення замовлення на відправку).
        """
        logger.info(f"Виклик 'CreateUpdateOrders' для {order_data.get('order_uid')} (заглушка)...")
        # TODO: Реалізувати SOAP/XML запит
        return {"success": True, "ttn": "20450000000001"}

    async def create_update_plan_inbound(self, inbound_data: dict) -> Optional[Dict[str, Any]]:
        """
        Метод "CreateUpdatePlaninbound" (план прийому).
        """
        logger.info(f"Виклик 'CreateUpdatePlaninbound' (заглушка)...")
        return {"success": True, "inbound_ref": "uuid-inbound"}

# Створюємо єдиний екземпляр сервісу
np_api = NovaPoshtaFulfillmentAPI(
    api_key=config.np_api_key.get_secret_value() if config.np_api_key else None
)