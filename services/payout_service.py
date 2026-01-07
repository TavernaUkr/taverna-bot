# services/payout_service.py
import logging
import asyncio
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from aiogram import Bot

from database.db import AsyncSessionLocal
from database.models import Order, OrderStatus, PaymentStatus, Supplier, PayoutMethod, OrderItem
from config_reader import config
from services.mono_api import mono_api # <-- НОВИЙ ІМПОРТ

logger = logging.getLogger(__name__)

async def process_payout_for_order(parent_order: Order, bot: Bot):
    """
    (Оновлено для Фази 6.2 / План 24)
    Запускається ПІСЛЯ успішної "Повної предоплати" (p) або
    "Часткової предоплати" (ch).
    
    Розраховує дроп-ціну для КОЖНОГО постачальника
    та запускає авто-виплату через Monobank.
    """
    if parent_order.payment_status not in (PaymentStatus.paid, PaymentStatus.partial):
        logger.warning(f"Payout: Спроба виплати для неоплаченого замовлення {parent_order.order_uid}")
        return
        
    logger.info(f"Payout: Починаю обробку авто-виплат для {parent_order.order_uid}")
    
    our_total_profit = 0 # Наш прибуток (для "Банок")
    
    async with AsyncSessionLocal() as db:
        # 1. Завантажуємо всі ChildOrders з їхніми Постачальниками та IBAN
        stmt = select(Order).where(
            Order.parent_order_id == parent_order.id
        ).options(
            selectinload(Order.supplier) # Підвантажуємо дані постачальника
        )
        child_orders = (await db.execute(stmt)).scalars().all()

        for child in child_orders:
            if not child.supplier:
                logger.error(f"Payout: У ChildOrder {child.order_uid} немає постачальника!")
                continue
                
            supplier = child.supplier
            drop_price_total_kopecks = child.total_price * 100 # (total_price в ChildOrder - це дроп-ціна в ГРН)
            
            # --- [ПЛАН 24G] Визначаємо, куди платити ---
            payout_details = ""
            payout_iban = None
            payout_token = None
            
            if supplier.payout_method == PayoutMethod.iban and supplier.payout_iban:
                payout_details = f"IBAN: {supplier.payout_iban}"
                payout_iban = supplier.payout_iban
            elif supplier.payout_method == PayoutMethod.card_token and supplier.payout_card_token:
                payout_details = f"CardToken: {supplier.payout_card_token}"
                payout_token = supplier.payout_card_token
            else:
                logger.error(f"Payout: НЕ МОЖУ ВИПЛАТИТИ! У постачальника {supplier.name} не вказано IBAN/Токен.")
                await bot.send_message(config.test_channel, f"⚠️ Помилка Виплати: Постачальник {supplier.name} (ID: {supplier.id}) не має IBAN для замовлення {child.order_uid}")
                continue
                
            # 3. Формуємо призначення платежу (План 24)
            payment_purpose = f"Оплата за товар по замовленню {child.order_uid} - {parent_order.customer_name}"
            
            logger.info(f"Payout: ГОТОВО ДО ВИПЛАТИ (на {supplier.name}):")
            logger.info(f"  - Сума: {drop_price_total_kopecks / 100} грн")
            logger.info(f"  - Куди: {payout_details}")

            # 4. --- [РЕАЛЬНА ІНТЕГРАЦІЯ API MONOBANK] (План 6.2) ---
            try:
                success = False
                if payout_iban:
                    success = await mono_api.create_payout(
                        amount_kopecks=drop_price_total_kopecks,
                        iban=payout_iban,
                        purpose=payment_purpose
                    )
                # TODO: Додати `elif payout_token: ...`
                    
                if success:
                    child.payment_status = PaymentStatus.paid_to_supplier
                    await db.commit()
                    logger.info(f"Payout: Успішна виплата для {child.order_uid}.")
                else:
                    raise Exception("API Виплати повернуло помилку (success=False)")
                    
            except Exception as e:
                logger.error(f"Payout: Помилка API виплати: {e}")
                await bot.send_message(config.test_channel, f"❌ ПОМИЛКА АВТО-ВИПЛАТИ для {child.order_uid} (Сума: {drop_price_total_kopecks / 100} грн): {e}")

        # --- [ПЛАН 27G] Розподіл Прибутку по "Банках" ---
        our_total_profit_kopecks = (parent_order.total_price * 100) - sum(c.total_price * 100 for c in child_orders)
        if our_total_profit_kopecks > 0:
            logger.info(f"Payout: Розподіляю прибуток {our_total_profit_kopecks / 100} грн по 'Банках'...")
            
            # 1. Податок (5%)
            tax_amount = int(our_total_profit_kopecks * 0.05)
            await mono_api.transfer_to_jar(tax_amount, config.tax_jar_id, f"Податок 5% з {parent_order.order_uid}")
            
            # 2. Бюджет на Рекламу (15%) (План 27)
            ad_amount = int(our_total_profit_kopecks * 0.15)
            await mono_api.transfer_to_jar(ad_amount, config.ad_budget_jar_id, f"Рекламний бюджет з {parent_order.order_uid}")
            
            # 3. Чистий прибуток (80%)
            profit_amount = our_total_profit_kopecks - tax_amount - ad_amount
            await mono_api.transfer_to_jar(profit_amount, config.profit_jar_id, f"Чистий прибуток з {parent_order.order_uid}")
            
            logger.info(f"Payout: Прибуток розподілено.")


async def process_cod_invoice(bot: Bot, order: Order):
    """
    (Фаза 6.3 / План 25G)
    "Дроп-бот Інвойсів". Запускається ПІСЛЯ доставки "Наложки" (n).
    Надсилає постачальнику рахунок на оплату НАШОЇ комісії (33%).
    """
    # TODO: Реалізувати у Фазі 6.3
    logger.info(f"Інвойсинг: Замовлення {order.order_uid} доставлено. "
                f"Треба виставити постачальнику рахунок на 33%. (Заглушка)")