# services/mono_api.py
import logging
import aiohttp
from typing import Optional, Dict, Any

from config_reader import config

logger = logging.getLogger(__name__)

class MonobankAPI:
    """
    (Фаза 6.1 / План 27)
    "Фінансовий Дроп-Бот". Керує рахунком ФОП,
    "Банками" (Податки, Реклама, Прибуток) та
    Авто-Виплатами на IBAN.
    """
    def __init__(self, api_key: Optional[str]):
        self.api_url = "https://api.monobank.ua"
        self.api_key = api_key

    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def _make_request(self, method: str, endpoint: str, payload: Optional[Dict] = None) -> Optional[Dict[str, Any]]:
        """Хелпер для запитів до API Monobank."""
        if not self.is_configured():
            logger.error("Monobank API: Ключ не надано (MONO_API_KEY).")
            return None
            
        headers = {"X-Token": self.api_key}
        url = f"{self.api_url}{endpoint}"
        
        try:
            async with aiohttp.ClientSession(headers=headers) as session:
                if method == 'GET':
                    async with session.get(url) as resp:
                        resp.raise_for_status()
                        return await resp.json()
                elif method == 'POST':
                    async with session.post(url, json=payload) as resp:
                        resp.raise_for_status()
                        return await resp.json()
        except Exception as e:
            logger.error(f"Помилка Monobank API ({endpoint}): {e}")
            return None

    async def get_client_info(self) -> Optional[Dict[str, Any]]:
        """Отримує інфо про ФОП та ID рахунків/банок."""
        return await self._make_request('GET', '/personal/client-info')

    async def create_payout(self, amount_kopecks: int, iban: str, purpose: str) -> bool:
        """
        (Фаза 4.5 / План 24)
        Робить "Авто-Виплату" (дроп-ціна) на IBAN постачальника.
        """
        if not self.is_configured(): return False
        
        logger.info(f"[Mono API] Спроба виплати {amount_kopecks / 100} грн на IBAN: {iban}")
        
        payload = {
            "amount": amount_kopecks, # в копійках
            "destination": f"IBAN:{iban}",
            "paymentPurpose": purpose # "Оплата за товар TAV-123..."
        }
        
        # TODO: Знайти правильний endpoint для ФОП Payout
        # (Це заглушка, /personal/p2p/transfer - для фіз. осіб)
        # response = await self._make_request('POST', '/personal/p2p/transfer', payload)
        
        # --- ЗАГЛУШКА ---
        logger.info(f"[ЗАГЛУШКА MONO API] Успішна виплата {amount_kopecks / 100} грн на {iban}")
        response = {"status": "ok"} # Імітуємо успіх
        # ---
        
        return bool(response and response.get("status") == "ok")

    async def transfer_to_jar(self, amount_kopecks: int, jar_id: str, purpose: str = "Авто-розподіл прибутку") -> bool:
        """
        (Фаза 6.1 / План 27)
        Переказує гроші з основного рахунку ФОП на "Банку"
        (Податки, Реклама, Прибуток).
        """
        if not self.is_configured() or not jar_id:
            logger.warning(f"Mono API: Не можу переказати на 'банку' (немає ключа або JAR_ID).")
            return False
            
        # TODO: Знайти правильний endpoint для поповнення "Банки" ФОП
        # (Це заглушка)
        logger.info(f"[ЗАГЛУШКА MONO API] Переказ {amount_kopecks / 100} грн на 'Банку' ID: {jar_id} (Призначення: {purpose})")
        return True
        

# Створюємо єдиний екземпляр
mono_api = MonobankAPI(
    api_key=config.mono_api_key.get_secret_value() if config.mono_api_key else None
)