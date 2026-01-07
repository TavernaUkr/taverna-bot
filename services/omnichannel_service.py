# services/omnichannel_service.py
import logging
import asyncio
import aiohttp
from aiogram import Bot
from typing import Dict, Any, Optional, List

from database.db import AsyncSessionLocal
from database.models import PaidService, Product, Supplier
from config_reader import config
from sqlalchemy.future import select

logger = logging.getLogger(__name__)

# ... (ADS_PRICE_LIST залишається без змін) ...
ADS_PRICE_LIST = {
    "instagram_story": {"name": "Instagram Story (Taverna)", "price_per_day": 300},
    "facebook_post": {"name": "Facebook Post (Taverna)", "price_per_day": 250},
    "olx_top": {"name": "OLX Top (7 днів)", "price_per_day": 50}, 
    "prom_catalog": {"name": "Prom.ua Каталог", "price_per_day": 200},
    "telegram_ads": {"name": "Telegram Ads (Офіційно)", "price_per_day": 1500},
}

class OmnichannelServiceAPI:
    
    def __init__(self):
        # --- [ОНОВЛЕНО - ФАЗА 5.7] ---
        # Prom.ua
        self.prom_api_key = config.prom_api_key.get_secret_value() if config.prom_api_key else None
        self.prom_api_url = "https.my.prom.ua/api/v1"
        
        # Meta (Facebook/Instagram)
        self.meta_api_url = "https://graph.facebook.com/v19.0"
        self.meta_access_token = config.meta_access_token.get_secret_value() if config.meta_access_token else None
        
        # OLX
        self.olx_api_url = "https://www.olx.ua/api/partner"
        self.olx_client_id = config.olx_client_id
        self.olx_client_secret = config.olx_client_secret.get_secret_value() if config.olx_client_secret else None
        # ---
        
        logger.info("OmnichannelService (Prom, Meta, OLX) 'скелет' ініціалізовано.")

    async def _make_prom_request(self, method: str, endpoint: str, payload: Optional[Dict] = None) -> Optional[Dict[str, Any]]:
        # ... (код без змін, з `TavernaBot_12.rar`) ...
        if not self.prom_api_key:
            logger.error("Prom.ua API: Ключ не надано (PROM_API_KEY).")
            return None
        headers = {"Authorization": f"Bearer {self.prom_api_key}", "Content-Type": "application/json"}
        url = f"{self.prom_api_url}{endpoint}"
        try:
            async with aiohttp.ClientSession(headers=headers) as session:
                if method == 'GET':
                    async with session.get(url, params=payload) as resp:
                        resp.raise_for_status()
                        return await resp.json()
                elif method == 'POST':
                    async with session.post(url, json=payload) as resp:
                        resp.raise_for_status()
                        return await resp.json()
        except Exception as e:
            logger.error(f"Помилка Prom.ua API ({endpoint}): {e}")
            return None

    # --- [Фаза 5.6.4] (Код без змін) ---
    async def sync_supplier_xml_to_prom(self, supplier: Supplier) -> Dict[str, Any]:
        # ... (код без змін, з `TavernaBot_12.rar`) ...
        if not supplier.xml_url:
            return {"status": "error", "message": "У постачальника немає XML-фіду."}
        payload = {
            "url": str(supplier.xml_url),
            "force_update": True,
            "mark_missing_product_as": "on_display",
            "updated_fields": ["price", "presence", "name", "description"]
        }
        response = await self._make_prom_request(method='POST', endpoint='/products/import_url', payload=payload)
        if response and response.get('id'):
            return {"status": "success", "message": f"Імпорт запущено (Job ID: {response.get('id')})"}
        else:
            return {"status": "error", "message": f"Помилка API Prom.ua: {response}"}

    # --- [Фаза 5.3] (Код без змін) ---
    async def get_ad_platforms(self) -> List[Dict[str, Any]]:
        # ... (код без змін) ...
        platforms = []
        for key, info in ADS_PRICE_LIST.items():
            base_price = info["price_per_day"]
            final_price = int(base_price * 1.33)
            platforms.append({
                "id": key,
                "name": info["name"],
                "price_per_day": final_price
            })
        return platforms

    # ---
    # [ОНОВЛЕНО - ФАЗА 5.7] (План 27) API Інтеграції (Скелети)
    # ---

    async def _run_meta_campaign(self, product: Product, days: int, platforms: List[str]):
        """(План 27) Скелет інтеграції з Meta Business API (Insta/FB)"""
        if not self.meta_access_token:
            logger.warning("Meta API: Ключ не надано. Пропуск Meta-кампанії.")
            return False
            
        logger.info(f"[СКЕЛЕТ META API] Запускаю кампанію для {product.sku} на {days} дн.")
        # 1. Згенерувати "Креатив" (взяти `product.pictures[0]` та `product.description`)
        # 2. Створити Кампанію (POST /act_{ad_account_id}/campaigns)
        # 3. Створити Ad Set (бюджет, таргет...)
        # 4. Створити Ad (з креативом)
        await asyncio.sleep(1) # Імітація роботи
        return True

    async def _run_olx_campaign(self, product: Product, days: int):
        """(План 27) Скелет інтеграції з OLX API (Prom/OLX)"""
        if not self.olx_client_id:
            logger.warning("OLX API: Ключі не надано. Пропуск OLX-кампанії.")
            return False
            
        logger.info(f"[СКЕЛЕТ OLX API] Запускаю 'OLX Top' для {product.sku} на {days} дн.")
        # 1. Отримати Access Token (POST /open/oauth/token)
        # 2. Знайти/Створити оголошення (POST /api/partner/adverts)
        # 3. Активувати платну послугу "Top" (POST /api/partner/adverts/{id}/promote)
        await asyncio.sleep(1)
        return True

    async def _run_telegram_ads_campaign(self, product: Product, days: int):
        """(План 27) Скелет інтеграції з Telegram Ads API"""
        logger.info(f"[СКЕЛЕТ TG ADS API] Запускаю Telegram Ads для {product.sku} на {days} дн.")
        # 1. Створити оголошення (POST /ads.createAds)
        # 2. Встановити бюджет (POST /ads.setBudget)
        await asyncio.sleep(1)
        return True
    
    # --- (Головний "Виконавець" Реклами, без змін) ---
    async def execute_paid_ad_campaign(self, bot: Bot, service: PaidService, product: Product, supplier: Supplier):
        # ... (код без змін) ...
        logger.info(f"ВИКОНУЮ ОПЛАЧЕНУ РЕКЛАМУ: Service ID {service.service_uid} для {product.sku}")
        details = service.details
        days = details.get("days", 1)
        platforms = details.get("platforms", [])
        tasks = []
        report_text = ""
        
        if "instagram_story" in platforms or "facebook_post" in platforms:
            tasks.append(self._run_meta_campaign(product, days, platforms))
            report_text += "- Meta (Instagram/Facebook)\n"
        if "olx_top" in platforms:
            tasks.append(self._run_olx_campaign(product, days))
            report_text += "- OLX\n"
        if "telegram_ads" in platforms:
            tasks.append(self._run_telegram_ads_campaign(product, days))
            report_text += "- Telegram Ads\n"
            
        try:
            await asyncio.gather(*tasks)
            await bot.send_message(config.test_channel, f"✅ **Успішна Реклама**\n...")
        except Exception as e:
            logger.error(f"Помилка рекламної кампанії {service.service_uid}: {e}")
            await bot.send_message(config.test_channel, f"❌ **Помилка Реклами**\n...")

# Створюємо єдиний екземпляр
omnichannel_service = OmnichannelServiceAPI()