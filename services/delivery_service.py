# services/delivery_service.py
import logging
import aiohttp
from typing import List, Dict, Any

from config_reader import config

logger = logging.getLogger(__name__)

# --- Константи для API Нової Пошти ---
NP_API_URL = "https://api.novaposhta.ua/v2.0/json/"

# --- Сервіс для Нової Пошти ---

async def _np_api_request(model_name: str, called_method: str, method_properties: Dict[str, Any]) -> Dict[str, Any] | None:
    """Універсальна функція для відправки запитів до API Нової Пошти."""
    if not config.np_api_key:
        logger.error("NP_API_KEY не налаштовано!")
        return None

    payload = {
        "apiKey": config.np_api_key,
        "modelName": model_name,
        "calledMethod": called_method,
        "methodProperties": method_properties
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(NP_API_URL, json=payload) as response:
                response.raise_for_status()
                data = await response.json()
                if data.get("success"):
                    return data.get("data")
                else:
                    logger.error(f"Помилка від API Нової Пошти: {data.get('errors')}")
                    return None
    except aiohttp.ClientError as e:
        logger.error(f"Помилка з'єднання з API Нової Пошти: {e}")
        return None
    except Exception as e:
        logger.error(f"Невідома помилка при роботі з API Нової Пошти: {e}")
        return None

async def find_np_city(query: str) -> List[Dict[str, Any]]:
    """Шукає населені пункти Нової Пошти за назвою."""
    method_properties = {
        "CityName": query,
        "Limit": "10", # Повертаємо до 10 варіантів
    }
    data = await _np_api_request("Address", "searchSettlements", method_properties)
    if data and data[0]["TotalCount"] > 0:
        return data[0]["Addresses"]
    return []

async def find_np_warehouses(city_ref: str, query: str = "") -> List[Dict[str, Any]]:
    """Шукає відділення Нової Пошти в конкретному місті."""
    method_properties = {
        "CityRef": city_ref,
        "Limit": "500", # Максимальна кількість відділень у місті
    }
    # Якщо є пошуковий запит (номер відділення), додаємо його
    if query:
        method_properties["FindByString"] = query

    data = await _np_api_request("Address", "getWarehouses", method_properties)
    return data if data else []