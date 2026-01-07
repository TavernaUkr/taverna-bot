# services/ai_agent_service.py
import logging
import asyncio
import aiohttp
import xml.etree.ElementTree as ET
import random
import json
from bs4 import BeautifulSoup
from sqlalchemy.future import select
from sqlalchemy import update, func
from typing import Optional, Dict, Any, List, Tuple
from collections import Counter

from database.db import AsyncSessionLocal
from database.models import Supplier, SupplierStatus, Channel, UserRole, Product
from config_reader import config
from services import gemini_service, notification_service
from handlers.supplier_handlers import get_or_create_topic # Імпортуємо наш хелпер
from aiogram import Bot

logger = logging.getLogger(__name__)

# --- [ПЛАН 22] Cервіс Перевірки Цін ---
async def check_for_cosmic_price(product_name: str, supplier_price: float) -> (bool, str):
    """
    (План 22) Використовує Gemini для "пошуку" середньої ринкової ціни.
    Повертає (is_cosmic, analysis_text).
    """
    if not config.gemini_api_key or supplier_price == 0 or not product_name:
        return False, "Перевірку ціни пропущено (немає API, ціни, або назви)."

    try:
        # Ми просимо Gemini виступити в ролі аналітика ринку
        system_prompt = f"""
Ти - AI-аналітик маркетплейсу TavernaGroup.
Твоє завдання - оцінити ДРОП-ціну постачальника.
Я дам тобі Назву Товару і ДРОП-Ціну.
Ти маєш *приблизно* оцінити СЕРЕДНЮ РОЗДРІБНУ ціну (Retail Price) в Україні (UAH) і порівняти її з дроп-ціною.
Дроп-ціна має бути на 30-50% нижчою за роздрібну.
Якщо дроп-ціна *вище* роздрібної, або *дорівнює* їй - це "космічна" ціна.
Поверни JSON: {{ "market_retail_price_avg": int, "is_cosmic": bool, "analysis": "твій короткий коментар українською" }}
"""
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash-latest",
            system_instruction=system_prompt,
            generation_config=genai.types.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.1
            )
        )
        
        prompt = f"Назва Товару: '{product_name}', Дроп-Ціна: {supplier_price} UAH"
        response = await model.generate_content_async(prompt)
        
        data = json.loads(response.text)
        is_cosmic = data.get("is_cosmic", False)
        analysis = data.get("analysis", "AI-аналіз ціни завершено.")
        
        logger.info(f"AI Price Check ({product_name}): {analysis}")
        return is_cosmic, analysis
        
    except Exception as e:
        logger.error(f"Помилка AI Price Check: {e}")
        return False, f"Помилка AI-аналізу ціни: {e}"

# --- [ПЛАН 21] Сервіс Перевірки Дублікатів ---
async def check_for_duplicates(db: AsyncSession, product_name: str, sku: str) -> (bool, str):
    """
    (План 21) Проста перевірка на дублікати за SKU або Назвою.
    Повертає (is_duplicate, analysis_text).
    """
    # TODO: У Фазі 3.9.5 ми замінимо це на AI Vector Search (по фото/опису)
    
    # 1. Перевірка по SKU
    if sku and sku != "0": # "0" - це часто заглушка
        stmt = select(Product).where(Product.sku.ilike(sku))
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing:
            return True, f"Дублікат: Товар з SKU '{sku}' вже існує (ID: {existing.id})."
            
    # 2. Перевірка по Назві (проста)
    # (Ми беремо перші 20 символів назви)
    if len(product_name) > 20:
        stmt = select(Product).where(Product.name.ilike(f"%{product_name[:20]}%"))
        existing_by_name = (await db.execute(stmt)).first()
        if existing_by_name:
            return True, f"Можливий дублікат: Товар зі схожою назвою '{product_name}' вже існує."

    return False, "OK"


# --- "Мозок" Агента ---

async def analyze_supplier_source(db: AsyncSession, supplier: Supplier) -> (Optional[str], str):
    """
    Парсить/Скрапить XML/URL постачальника.
    Повертає: (Визначена Категорія, Звіт про Аналіз)
    """
    source_url = supplier.xml_url or supplier.shop_url
    if not source_url:
        return None, "Джерело (URL/XML) не вказано."

    logger.info(f"AI-Агент: Починаю аналіз {source_url} для {supplier.name}")
    raw_products_text = [] # Збираємо тексти описів
    product_samples: List[Dict[str, Any]] = [] # Збираємо 10 товарів для аналізу

    try:
        # --- 1. Отримуємо дані ---
        async with aiohttp.ClientSession(headers={'User-Agent': 'TavernaBot-AI-Scraper/1.0'}) as session:
            async with session.get(str(source_url)) as resp:
                content = await resp.text()

        # --- 2. Парсимо (XML або HTML) ---
        if supplier.type == "mydrop" and supplier.xml_url:
            root = ET.fromstring(content)
            offers = root.findall('.//offer')[:20] # Беремо перші 20
            for offer in offers:
                name_el = offer.find('name')
                desc_el = offer.find('description')
                price_el = offer.find('price')
                sku_el = offer.find('vendorCode')
                
                name = name_el.text if name_el is not None and name_el.text is not None else ""
                desc = desc_el.text if desc_el is not None and desc_el.text is not None else ""
                price_str = price_el.text if price_el is not None and price_el.text is not None else "0"
                sku = sku_el.text if sku_el is not None and sku_el.text is not None else "0"

                try:
                    price = float(price_str.replace(',', '.'))
                except ValueError:
                    price = 0.0
                    
                raw_products_text.append(f"{name} {desc}")
                product_samples.append({"name": name, "sku": sku, "price": price})
        
        elif supplier.type == "independent" and supplier.shop_url:
            # (Заглушка для скрапінгу - у Фазі 5 це буде окремий модуль)
            soup = BeautifulSoup(content, 'lxml')
            text = soup.body.get_text(separator=" ", strip=True)[:15000]
            raw_products_text.append(text)
            product_samples.append({"name": f"Товар з {supplier.name}", "sku": "0", "price": 0.0})

        if not raw_products_text:
            return None, "Не вдалося зчитати товари з URL/XML."
            
        # --- 3. Визначаємо Категорію (План 19) ---
        logger.info(f"AI-Агент: Відправляю {len(raw_products_text)} товарів в Gemini для категоризації...")
        combined_text = " ".join(raw_products_text)
        ai_data = await gemini_service.extract_product_attributes_with_ai(
            raw_text=combined_text[:15000], # Обрізаємо (ліміт токенів)
            category_hint="Визнач головну категорію для цього магазину (напр. 'Одяг', 'Електроніка', 'Взуття')"
        )
        
        if not ai_data:
            return None, "Gemini не зміг проаналізувати товари."
            
        main_category = "General" # За замовчуванням
        if ai_data.get("attributes"):
            # Шукаємо "Категорія" або "Тип"
            main_category = ai_data.get("attributes", {}).get("Категорія", 
                                ai_data.get("attributes", {}).get("Тип", "General"))
        
        # --- 4. Перевірка Ціни (План 22) та Дублікатів (План 21) ---
        final_report = f"AI-Аналіз Категорії: {main_category}.\n\n"
        cosmic_price_count = 0
        duplicate_count = 0
        
        # Рандомно обираємо 5 товарів для перевірки (План 22)
        samples_to_check = random.sample(product_samples, min(len(product_samples), 5))
        
        for sample in samples_to_check:
            # Перевірка ціни
            is_cosmic, price_analysis = await check_for_cosmic_price(sample["name"], sample["price"])
            if is_cosmic:
                cosmic_price_count += 1
                final_report += f"🚨 **Warning (Price):** Товар '{sample['name']}' ({sample['price']} грн) - {price_analysis}\n"
            
            # Перевірка на дублікат
            is_duplicate, dup_analysis = await check_for_duplicates(db, sample["name"], sample["sku"])
            if is_duplicate:
                duplicate_count += 1
                final_report += f"⛔️ **Warning (Duplicate):** {dup_analysis}\n"

        if cosmic_price_count > 1:
            final_report += "\n**Вердикт AI: Ціни виглядають завищеними.**"
        if duplicate_count > 0:
            final_report += "\n**Вердикт AI: Знайдено можливі дублікати товарів!**"

        return main_category, final_report

    except Exception as e:
        logger.error(f"Помилка AI-Агента при аналізі {source_url}: {e}", exc_info=True)
        return None, f"Помилка аналізу: {e}"


async def run_ai_onboarding_analysis(supplier_id: int, bot_instance: Bot):
    """
    (Фаза 3.9) Головна функція, яку викликає планувальник.
    Аналізує нового постачальника, перевіряє ціни/дублікати.
    """
    async with AsyncSessionLocal() as db:
        supplier = None # Визначаємо
        try:
            # 1. Отримуємо постачальника
            supplier = await db.get(Supplier, supplier_id)
            if not supplier or supplier.status != SupplierStatus.pending_ai_analysis:
                logger.warning(f"AI-Агент: Cпроба аналізу вже обробленого постачальника {supplier_id}.")
                return

            # 2. "Блокуємо" його, щоб інший процес не взяв його
            supplier.status = SupplierStatus.ai_in_progress
            await db.commit()

            # 3. Виконуємо аналіз (викликаємо "мозок")
            category_name, report = await analyze_supplier_source(db, supplier)
            
            if not category_name:
                # Провал аналізу
                supplier.status = SupplierStatus.rejected
                supplier.admin_notes = report
                await db.commit()
                # Повідомляємо Адміна
                await bot_instance.send_message(
                    config.test_channel,
                    f"❌ **AI-Аналіз ПРОВАЛЕНО** (Постачальник: {supplier.name})\n"
                    f"**Причина:** {report}"
                )
                return

            # 4. Успіх! Створюємо "гілку" (Тему)
            category_tag = category_name.lower().replace(' ', '_').replace('/', '_')
            await get_or_create_topic(bot_instance, db, category_name, category_tag)
            
            # 5. Оновлюємо статус постачальника
            supplier.status = SupplierStatus.pending_admin_approval # Очікує на Адміна
            supplier.category_tag = category_tag
            supplier.admin_notes = report
            await db.commit()
            
            # 6. Надсилаємо фінальний звіт Адміну
            await bot_instance.send_message(
                config.test_channel,
                text=f"✅ **AI-Аналіз Завершено!**\n\n"
                     f"**Постачальник:** {supplier.name}\n"
                     f"**Визначена Категорія:** {category_name} (Гілка створена/знайдена)\n"
                     f"**Звіт AI:**\n"
                     f"```\n{report}\n```\n"
                     f"👉 **Очікує на ваше схвалення** (в Адмін-панелі Фази 3.10)."
            )

        except Exception as e:
            logger.error(f"Критична помилка AI-Агента (ID: {supplier_id}): {e}", exc_info=True)
            # Розблоковуємо на випадок помилки
            if supplier:
                await db.rollback()
                supplier.status = SupplierStatus.pending_ai_analysis
                supplier.admin_notes = f"Помилка Агента: {e}"
                await db.commit()