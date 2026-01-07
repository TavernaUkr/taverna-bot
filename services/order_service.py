# services/order_service.py
import logging
import json
import uuid
import asyncio
from datetime import datetime, timezone
from aiogram import Bot
from sqlalchemy.future import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import selectinload
from typing import List, Dict, Any, Tuple, Optional
from collections import defaultdict

from database.db import AsyncSessionLocal
from database.models import (
    Order, OrderItem, Channel, Supplier, ProductVariant,
    OrderStatus, PaymentStatus, PayoutMethod, OrderItemStatus
)
from services import mydrop_service, gdrive_service, notification_service, xml_parser, delivery_service
from config_reader import config

logger = logging.getLogger(__name__)

# ---
# [ПЛАН 25] Новий "Розумний" Order UID
# ---
async def _generate_order_uid(db: AsyncSession, user_id: int, cart_items: List[Dict], fsm_data: dict, supplier_count: int) -> Tuple[str, int]:
    """
    (План 25) Генерує ID замовлення (напр. ...tav1.2.6.4.np.n)
    """
    # 1. Отримуємо наступний номер замовлення
    last_order_q = await db.execute(
        select(Order.id)
        .where(Order.parent_order_id.is_(None)) # Тільки головні замовлення
        .order_by(Order.id.desc())
        .limit(1)
    )
    last_order_id = last_order_q.scalar_one_or_none()
    new_order_num = (last_order_id + 1) if last_order_id else 1
    
    # 2. Збираємо частини
    items_count = sum(i['quantity'] for i in cart_items) # 6
    unique_items_count = len(cart_items) # 2
    suppliers_count = supplier_count # 4
    
    delivery_code = fsm_data.get("delivery_service", "na")[:2] # np
    payment_code = fsm_data.get("payment_type", "na")[:1] # n, p, c
    
    # Формат: tav[Num].[UniqItems].[TotalItems].[Suppliers].[Delivery].[Payment]
    parent_uid = f"TAV{new_order_num}.{unique_items_count}.{items_count}.{suppliers_count}.{delivery_code}.{payment_code}"
    return parent_uid, new_order_num


def _format_customer_txt_summary(
    order_uid: str, 
    fsm_data: dict, 
    cart_items: list, 
    total_price: int, 
    supplier_count: int
) -> str:
    """
    (План 25) Форматує .txt файл, який бачить КЛІЄНТ.
    (Включає ВСІ товари та ЗАГАЛЬНУ (з націнкою) ціну).
    """
    payment_map = {"cod": "Накладений платіж", "prepaid": "Повна передоплата", "partial": "Часткова передоплата"}
    items_str = ""
    for i, item in enumerate(cart_items, 1):
        items_str += (
            f"\n{i}. {item.get('name')} (Арт: {item.get('sku')})\n"
            f"   Опції: {item.get('options_text', '-')}\n"
            f"   К-сть: {item.get('quantity')} шт. x {item.get('price')} грн\n"
            f"   Сума: {item.get('total_item_price')} грн\n"
        )
    
    delivery_warning = f"(Замовлення буде розділено на {supplier_count} посилк(и))\n\n" \
                       if supplier_count > 1 else "\n"
    
    summary = (
        f"--- ДЯКУЄМО ЗА ЗАМОВЛЕННЯ В TAVERNAGROUP! ---\n\n"
        f"Номер вашого замовлення: {order_uid}\n"
        f"Статус: Очікує підтвердження від постачальників...\n"
        f"{delivery_warning}"
        f"--- ДАНІ ОТРИМУВАЧА ---\n"
        f"ПІБ: {fsm_data.get('pib')}\n"
        f"Телефон: {fsm_data.get('phone')}\n"
        f"Доставка: {fsm_data.get('delivery_service')} / {fsm_data.get('address')}\n"
        f"Оплата: {payment_map.get(fsm_data.get('payment_type'))}\n"
        f"Примітка: {fsm_data.get('note', 'Немає')}\n\n"
        f"--- СКЛАД ЗАМОВЛЕННЯ ---\n"
        f"{items_str}\n"
        f"----------------------------------------\n"
        f"ЗАГАЛЬНА СУМА: {total_price} грн\n"
    )
    return summary

def _format_supplier_txt_summary(
    child_order_uid: str, 
    fsm_data: dict, 
    supplier_items: list, 
    supplier_total_drop_price: int,
    payment_type: str
) -> str:
    """
    (План 25) Форматує .txt файл, який бачить ПОСТАЧАЛЬНИК.
    (Включає ТІЛЬКИ його товари та ТІЛЬКИ дроп-ціну).
    """
    items_str = ""
    for i, item in enumerate(supplier_items, 1):
        items_str += (
            f"\n{i}. {item.get('name')} (Арт: {item.get('sku')})\n"
            f"   Опції: {item.get('options_text', '-')}\n"
            f"   К-сть: {item.get('quantity')} шт. x {item.get('drop_price')} грн\n"
        )
    
    payment_info = ""
    if payment_type == "prepaid":
        payment_info = "ОПЛАЧЕНО КЛІЄНТОМ (Повна передоплата).\nКошти (дроп-ціна) будуть автоматично переведені на ваш IBAN."
    elif payment_type == "cod":
        payment_info = f"НАКЛАДЕНИЙ ПЛАТІЖ (COD).\nСума до отримання з клієнта (дроп-ціна): {supplier_total_drop_price} грн."
    elif payment_type == "partial": # (Твій План 25)
        payment_info = f"ЧАСТКОВА ПЕРЕДОПЛАТА (Націнку отримано).\nСума до отримання з клієнта (дроп-ціна): {supplier_total_drop_price} грн."

    summary = (
        f"--- НОВЕ ЗАМОВЛЕННЯ ВІД TAVERNAGROUP ---\n\n"
        f"Номер замовлення: {child_order_uid}\n"
        f"Статус: Очікує на ваше підтвердження.\n\n"
        f"--- ІНФОРМАЦІЯ ПРО ОПЛАТУ ---\n"
        f"!!! {payment_info} !!!\n\n"
        f"--- ДАНІ ОТРИМУВАЧА (для ТТН) ---\n"
        f"ПІБ: {fsm_data.get('pib')}\n"
        f"Телефон: {fsm_data.get('phone')}\n"
        f"Доставка: {fsm_data.get('delivery_service')}\n"
        f"Адреса: {fsm_data.get('address')}\n"
        f"Ref Міста: {fsm_data.get('city_ref')}\n"
        f"Ref Відділення: {fsm_data.get('address_ref')}\n"
        f"Примітка: {fsm_data.get('note', 'Немає')}\n\n"
        f"--- СКЛАД ЗАМОВЛЕННЯ ---\n"
        f"{items_str}\n"
        f"----------------------------------------\n"
        f"ЗАГАЛЬНА ДРОП-СУМА: {supplier_total_drop_price} грн\n"
    )
    return summary


# ---
# [ГОЛОВНА ФУНКЦІЯ - ФАЗА 4.3] (Твій План 25)
# ---
async def create_order(
    bot: Bot,
    user_id: int, 
    fsm_data: dict, 
    cart_items: List[Dict[str, Any]], 
    total_price: int
) -> Tuple[bool, Optional[str]]:
    """
    (Оновлено для Фази 4.3 / План 25)
    "Order Spooler". Створює ParentOrder (для клієнта)
    та ChildOrders (для кожного постачальника).
    """
    
    # 1. Розділяємо кошик по постачальниках
    # { 1: [itemA, itemB], 2: [itemC] }
    supplier_cart_map = defaultdict(list)
    supplier_db_map = {} # { 1: Supplier(id=1, name=...), 2: ... }
    
    # Переконуємося, що в кошику є supplier_id та drop_price
    # (Ми додали їх у `cart_service` в Кроці 3)
    for item in cart_items:
        supplier_id = item.get('supplier_id')
        if not supplier_id:
            logger.error(f"Критична помилка: Товар {item.get('sku')} в кошику не має supplier_id!")
            return False, None
        supplier_cart_map[supplier_id].append(item)

    if not supplier_cart_map:
        return False, None

    # ---
    # [ПЛАН 25G] "Розумний Кошик"
    # "Сценарій А (Фулфілмент)" vs "Сценарій Б (Розділення)"
    # ---
    is_fulfillment_order = False
    
    # (Заглушка: ми *імітуємо* перевірку. 
    # TODO: У Фазі 4.X ми запитаємо `delivery_service.np_api.get_current_remains()`)
    if len(supplier_cart_map) == 1 and list(supplier_cart_map.keys())[0] == 1: # Припустимо, ID=1 - це наш Фулфілмент
         is_fulfillment_order = True
         logger.info("Order Spooler: Сценарій А (Фулфілмент). 1 Замовлення.")
    else:
         is_fulfillment_order = False
         logger.info(f"Order Spooler: Сценарій Б (Розділення). {len(supplier_cart_map)} постачальник(ів).")
    
    
    supplier_count = len(supplier_cart_map)
    parent_uid = "" # Визначаємо
    parent_order = None # Визначаємо

    async with AsyncSessionLocal() as db:
        try:
            async with db.begin():
                
                # 2. Створюємо ParentOrder (для Клієнта)
                parent_uid, order_num = await _generate_order_uid(db, user_id, cart_items, fsm_data, supplier_count)
                
                payment_type = fsm_data.get("payment_type")
                payment_status = PaymentStatus.pending
                if payment_type == "prepaid":
                    payment_status = PaymentStatus.paid # Вважаємо оплаченим, чекаємо callback
                elif payment_type == "partial":
                    payment_status = PaymentStatus.partial # Вважаємо оплаченим, чекаємо callback
                elif payment_type == "cod":
                    payment_status = PaymentStatus.cod

                parent_order = Order(
                    order_uid=parent_uid,
                    user_telegram_id=user_id,
                    status=OrderStatus.new,
                    payment_status=payment_status,
                    total_price=total_price, # Повна ціна
                    customer_name=fsm_data.get("pib"),
                    customer_phone=fsm_data.get("phone"),
                    delivery_service=fsm_data.get("delivery_service"),
                    delivery_address=fsm_data.get("address"),
                    address_ref=fsm_data.get("address_ref"),
                    city_ref=fsm_data.get("city_ref"),
                    payment_type=payment_type,
                    note=fsm_data.get("note")
                )
                db.add(parent_order)
                await db.flush() # Отримуємо parent_order.id

                # 3. Створюємо ChildOrders (для кожного Постачальника)
                child_orders_to_notify = [] # (supplier, child_uid, items, drop_total)
                
                supplier_index = 1 # (для ...4_1, ...4_2)
                for supplier_id, items_list in supplier_cart_map.items():
                    
                    supplier = supplier_db_map.get(supplier_id)
                    if not supplier: # Завантажуємо, якщо його немає
                        supplier = await db.get(Supplier, supplier_id, options=[selectinload(Supplier.user)])
                        if not supplier:
                            logger.error(f"Критична помилка: Не можу знайти Supplier ID {supplier_id}")
                            continue
                        supplier_db_map[supplier_id] = supplier
                    
                    # Розраховуємо дроп-суму *тільки* для цього постачальника
                    supplier_total_drop_price = sum(item['drop_price'] * item['quantity'] for item in items_list)
                    
                    # ID (План 25) - ...4_1, ...4_2
                    child_uid = f"{parent_uid}_{supplier_index}" 
                    supplier_index += 1
                    
                    child_order = Order(
                        parent_order_id=parent_order.id, # <-- Прив'язка
                        order_uid=child_uid,
                        user_telegram_id=user_id,
                        status=OrderStatus.confirmed if is_fulfillment_order else OrderStatus.new, # Фулфілмент = авто-підтверджено
                        payment_status=parent_order.payment_status,
                        total_price=supplier_total_drop_price, # <-- Дроп-ціна!
                        supplier_id=supplier_id, # <-- Прив'язка
                        
                        # Копіюємо дані клієнта
                        customer_name=parent_order.customer_name,
                        customer_phone=parent_order.customer_phone,
                        delivery_service=parent_order.delivery_service,
                        delivery_address=parent_order.delivery_address,
                        address_ref=parent_order.address_ref,
                        city_ref=parent_order.city_ref,
                        payment_type=parent_order.payment_type,
                        note=parent_order.note
                    )
                    db.add(child_order)
                    await db.flush() # Отримуємо child_order.id
                    
                    # 4. Створюємо OrderItems (для Parent та Child)
                    for item in items_list:
                        item_status = OrderItemStatus.confirmed if is_fulfillment_order else OrderItemStatus.pending
                        
                        # Створюємо Item для ParentOrder (з final_price)
                        db.add(OrderItem(
                            order_id=parent_order.id,
                            supplier_id=supplier_id,
                            product_id=item.get("product_id"),
                            variant_id=item.get("variant_db_id"),
                            product_name=item.get("name"),
                            sku=item.get("sku"),
                            options_text=item.get("options_text"), 
                            quantity=item.get("quantity"),
                            price_per_item=item.get("price"), # Final Price
                            drop_price_per_item=item.get("drop_price"), # Drop Price
                            supplier_offer_id=item.get("variant_offer_id"),
                            status=item_status
                        ))
                        # Створюємо Item для ChildOrder (з drop_price)
                        db.add(OrderItem(
                            order_id=child_order.id,
                            supplier_id=supplier_id,
                            product_id=item.get("product_id"),
                            variant_id=item.get("variant_db_id"),
                            product_name=item.get("name"),
                            sku=item.get("sku"),
                            options_text=item.get("options_text"), 
                            quantity=item.get("quantity"),
                            price_per_item=item.get("drop_price"), # <-- Дроп-ціна!
                            drop_price_per_item=item.get("drop_price"),
                            supplier_offer_id=item.get("variant_offer_id"),
                            status=item_status
                        ))
                    
                    # Додаємо в чергу на сповіщення (ТІЛЬКИ якщо це НЕ фулфілмент)
                    if not is_fulfillment_order:
                        child_orders_to_notify.append(
                            (supplier, child_uid, items_list, supplier_total_drop_price)
                        )

            # Коммітимо ВСЕ (Parent, 4 Child, 8 Items) однією транзакцією
            await db.commit()
            logger.info(f"Order Spooler: Успішно створено ParentOrder {parent_uid} та {supplier_count} ChildOrders.")
            
        except SQLAlchemyError as e:
            await db.rollback()
            logger.error(f"Помилка SQLAlchemy при 'Order Spooling' {parent_uid}: {e}", exc_info=True)
            return False, None
        except Exception as e:
            await db.rollback()
            logger.error(f"Неочікувана помилка при 'Order Spooling': {e}", exc_info=True)
            return False, None

    # --- 5. Фонові Завдання (Сповіщення) ---
    
    # 5.1. Сповіщення Клієнту (План 25)
    customer_txt_name = f"{fsm_data.get('pib', 'order').split()[0]}_{parent_uid}.txt"
    customer_txt = _format_customer_txt_summary(
        parent_uid, fsm_data, cart_items, total_price, supplier_count
    )
    
    customer_summary = f"✅ Дякуємо! Ваше замовлення <code>{parent_uid}</code> прийнято.\n"
    if is_fulfillment_order:
        customer_summary += "Всі товари будуть відправлені однією посилкою."
    else:
        customer_summary += f"Очікуємо підтвердження від {supplier_count} постачальник(ів)..."
        
    asyncio.create_task(
        notification_service.notify_customer_of_new_order(
            bot=bot,
            user_id=user_id,
            order_uid=parent_uid, # <-- Передаємо Parent UID
            summary_text=customer_summary,
            order_txt_content=customer_txt,
            order_filename=customer_txt_name
        )
    )

    # 5.2. Сповіщення Постачальникам (План 25)
    for supplier, child_uid, items, drop_total in child_orders_to_notify:
        supplier_txt_name = f"order_{child_uid}.txt"
        supplier_txt = _format_supplier_txt_summary(
            child_uid, fsm_data, items, drop_total, parent_order.payment_type
        )
        asyncio.create_task(
            notification_service.notify_supplier_of_new_order(
                bot=bot,
                supplier=supplier, # Об'єкт Supplier (з `user`)
                summary_text=f"🔥 **Нове Замовлення!** <code>{child_uid}</code>\n"
                             f"На суму (дроп): {drop_total} грн. Натисніть 'Підтвердити'.",
                order_txt_content=supplier_txt,
                order_filename=supplier_txt_name,
                child_order_uid=child_uid # Передаємо UID для кнопок
            )
        )
        
    # 5.3. Якщо це Фулфілмент - запускаємо API НП
    if is_fulfillment_order:
        logger.info(f"Order Spooler: Сценарій А. Відправляю запит на Фулфілмент-Хаб НП...")
        # TODO: Сформатувати `order_data` для `create_update_orders`
        # asyncio.create_task(
        #     delivery_service.np_api.create_update_orders(order_data=...)
        # )
        pass

    # 5.4. Сповіщення Адміну (в тест-канал)
    order_summary_text = _format_order_summary(fsm_data, cart_items, total_price)
    full_order_json_str = json.dumps(full_order_data, ensure_ascii=False, indent=4)
    asyncio.create_task(
        notification_service.notify_admin_of_new_order(
            bot=bot,
            order_summary=order_summary_text,
            order_data_json=full_order_json_str,
            order_uid=parent_uid
        )
    )

    # 5.5. --- [ФАЗА 3.7] Постинг у "Live" гілку (Твій План 17.1) ---
    asyncio.create_task(
        post_to_live_feed(
            bot=bot,
            fsm_data=fsm_data,
            total_price=total_price,
            items_count=len(cart_items)
        )
    )
    # ---
    
    return True, parent_uid

async def post_to_live_feed(bot: Bot, fsm_data: dict, total_price: int, items_count: int):
    # ... (код без змін, з `TavernaBot_8.rar`) ...
    try:
        name_parts = fsm_data.get("pib", "Клієнт").split()
        anon_name = name_parts[0] if name_parts else "Клієнт"
        price_str = str(total_price)
        anon_price = f"{price_str[0]}{'*' * (len(price_str) - 2)}{price_str[-1]}" if len(price_str) > 2 else f"{price_str}***"
        item_suffix = "товар" if items_count == 1 else ("товари" if 1 < items_count < 5 else "товарів")
        message_text = (
            f"🟢 **Нове Замовлення!**\n\n"
            f"👤 {anon_name}\n"
            f"📦 замовив(ла) **{items_count}** {item_suffix}\n"
            f"💰 на суму: **{anon_price} грн**"
        )
        
        live_topic_id = None
        async with AsyncSessionLocal() as db:
            channel_stmt = select(Channel.telegram_id).where(Channel.category_tag == "live_feed")
            live_topic_id_db = (await db.execute(channel_stmt)).scalar_one_or_none()
            if live_topic_id_db:
                live_topic_id = int(live_topic_id_db)
            else:
                live_topic_id = 1 
                logger.warning("Не можу запостити в 'Live' Feed: 'Тема' (гілка) з тегом 'live_feed' не знайдена в БД. Використовую General (1).")

        await bot.send_message(
            chat_id=config.main_channel, # ID TavernaGroup
            text=message_text,
            message_thread_id=live_topic_id
        )
    except Exception as e:
        logger.error(f"Помилка постингу в 'Live' Feed: {e}", exc_info=True)