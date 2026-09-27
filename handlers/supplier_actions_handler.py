# handlers/supplier_actions_handler.py
import logging
import asyncio
from aiogram import Router, F, Bot
from aiogram.types import CallbackQuery, Message
from aiogram.fsm.state import StatesGroup, State
from aiogram.fsm.context import FSMContext
from sqlalchemy.future import select
from sqlalchemy import update
from sqlalchemy.orm import selectinload

from database.db import AsyncSessionLocal
from database.models import Order, OrderItem, OrderStatus, OrderItemStatus
from config_reader import config

logger = logging.getLogger(__name__)
router = Router()

# --- Створюємо FSM для отримання "Причини Скасування" (План 25) ---
class SupplierCancelFSM(StatesGroup):
    awaiting_cancel_reason = State()
    
# --- "Оживлюємо" кнопки ---

async def update_customer_message(bot: Bot, parent_order_id: int):
    """
    (План 25) Головна функція інтерактивності.
    Перевіряє статуси всіх Child-замовлень і оновлює
    головне повідомлення клієнта.
    """
    async with AsyncSessionLocal() as db:
        # 1. Завантажуємо ParentOrder разом з дітьми
        stmt = select(Order).where(Order.id == parent_order_id).options(selectinload(Order.children))
        parent_order = (await db.execute(stmt)).scalar_one_or_none()
        
        if not parent_order or not parent_order.customer_message_id:
            logger.warning(f"Не можу оновити статус клієнту: `customer_message_id` не збережено для ParentOrder {parent_order_id}.")
            return

        # 2. Аналізуємо статус дітей
        total_children = len(parent_order.children)
        confirmed_count = 0
        cancelled_items_text = ""
        
        for child in parent_order.children:
            if child.status == OrderStatus.confirmed:
                confirmed_count += 1
            elif child.status == OrderStatus.cancelled:
                # Знаходимо скасовані товари (беремо перший, якщо їх декілька)
                item_stmt = select(OrderItem).where(
                    (OrderItem.order_id == child.id) &
                    (OrderItem.status == OrderItemStatus.cancelled_supplier)
                ).limit(1)
                item = (await db.execute(item_stmt)).scalar_one_or_none()
                
                reason = item.cancel_reason if item and item.cancel_reason else "Причина не вказана"
                item_name = item.product_name if item else f"Товар з {child.order_uid}"
                cancelled_items_text += f"\n   - <b>{item_name}</b> (Скасовано: {reason})"
        
        waiting = total_children - confirmed_count - (len(cancelled_items_text.splitlines()))
        
        # 3. Формуємо текст статусу
        base_text = f"✅ Дякуємо! Ваше замовлення <code>{parent_order.order_uid}</code> прийнято.\n"
        status_text = f"\n--- СТАТУС ЗАМОВЛЕННЯ ---\n"
        
        if waiting > 0:
            status_text += f"⏳ Очікуємо відповіді від постачальників: {waiting}/{total_children}\n"
        if confirmed_count > 0:
            status_text += f"✅ Підтверджено до відправки: {confirmed_count} посилк(и)\n"
        if cancelled_items_text:
            status_text += f"❌ Скасовано постачальниками: {cancelled_items_text}\n"
        if waiting == 0:
            status_text += "\n🏁 **Обробку завершено!** Очікуйте на ТТН."

        # 4. Оновлюємо ОРИГІНАЛЬНЕ повідомлення клієнта
        try:
            await bot.edit_message_text(
                text=base_text + status_text,
                chat_id=parent_order.user_telegram_id,
                message_id=parent_order.customer_message_id,
                parse_mode="HTML"
            )
        except Exception as e:
            # Помилка може бути, якщо текст не змінився, це нормально
            if "message is not modified" not in str(e):
                logger.warning(f"Не вдалося оновити повідомлення клієнта ({parent_order.customer_message_id}): {e}")

@router.callback_query(F.data.startswith("supplier:confirm:"))
async def handle_supplier_confirm(cb: CallbackQuery, bot: Bot):
    """
    (Фаза 4.4 / План 25)
    Обробляє натискання "✅ Підтвердити" від постачальника.
    """
    try:
        child_order_uid = cb.data.split(":")[-1]
    except Exception:
        await cb.answer("Помилка ID замовлення.", show_alert=True)
        return

    logger.info(f"Постачальник {cb.from_user.id} підтверджує {child_order_uid}")
    
    parent_id = None
    async with AsyncSessionLocal() as db:
        # 1. Знаходимо ChildOrder
        stmt = select(Order).where(Order.order_uid == child_order_uid)
        child_order = (await db.execute(stmt)).scalar_one_or_none()
        
        if not child_order or child_order.supplier_id is None:
            await cb.answer("Замовлення не знайдено.", show_alert=True)
            return
        
        if child_order.status != OrderStatus.new:
             await cb.answer("Замовлення вже оброблено!", show_alert=True)
             return

        # 2. Статуси позицій — в тій самій транзакції, ЩО зміна статусу
        # (commit зробить change_order_status — атомарно разом)
        await db.execute(
            update(OrderItem)
            .where(OrderItem.order_id == child_order.id)
            .values(status=OrderItemStatus.confirmed)
        )

        # 3. Статус → Order State Machine (централізовано; перехід
        # new→confirmed, білінг при цьому не активний)
        from core.order_service import change_order_status
        child_order = await change_order_status(
            db, child_order.id, OrderStatus.confirmed,
            changed_by_user_id=None,  # постачальник у боті — не менеджер-контрактник
            changed_by_manager_role=False,
        )
            
        # 4. Отримуємо ParentOrder ID (expire_on_commit=False — об'єкт живий)
        parent_id = child_order.parent_order_id

    # 4. Оновлюємо повідомлення постачальника (прибираємо кнопки)
    await cb.message.edit_text(
        cb.message.text + "\n\n**✅ ЗАМОВЛЕННЯ ПІДТВЕРДЖЕНО.**\n(Готуйте товар до відправки)",
        reply_markup=None # Видаляємо клавіатуру
    )
    await cb.answer("Замовлення підтверджено!")
    
    # 5. Оновлюємо повідомлення Клієнта (Інтерактивність, План 25)
    if parent_id:
        await update_customer_message(bot, parent_id)

@router.callback_query(F.data.startswith("supplier:cancel:"))
async def handle_supplier_cancel(cb: CallbackQuery, state: FSMContext):
    """
    (Фаза 4.4 / План 25)
    Обробляє натискання "❌ Скасувати". Запитує причину.
    """
    try:
        child_order_uid = cb.data.split(":")[-1]
    except Exception:
        await cb.answer("Помилка ID замовлення.", show_alert=True)
        return
        
    await state.set_state(SupplierCancelFSM.awaiting_cancel_reason)
    await state.update_data(cancel_child_uid=child_order_uid, cancel_msg_id=cb.message.message_id)
    
    await cb.message.answer(
        f"<b>Вкажіть причину скасування</b> замовлення <code>{child_order_uid}</code>:\n"
        f"(Наприклад: 'Немає в наявності', 'Брак')"
    )
    await cb.answer("Вкажіть причину...")

@router.message(SupplierCancelFSM.awaiting_cancel_reason)
async def handle_supplier_cancel_reason(msg: Message, state: FSMContext, bot: Bot):
    """
    (Фаза 4.4 / План 25)
    Отримує причину скасування, оновлює БД та повідомлення клієнта.
    """
    reason = msg.text
    data = await state.get_data()
    child_order_uid = data.get("cancel_child_uid")
    original_msg_id = data.get("cancel_msg_id")
    await state.clear()
    
    if not child_order_uid:
        return

    logger.info(f"Постачальник {msg.from_user.id} скасовує {child_order_uid}, Причина: {reason}")
    parent_id = None

    async with AsyncSessionLocal() as db:
        stmt = select(Order).where(Order.order_uid == child_order_uid)
        child_order = (await db.execute(stmt)).scalar_one_or_none()
        if not child_order: return

        # Причина скасування — в тій самій транзакції, ЩО статус
        await db.execute(
            update(OrderItem)
            .where(OrderItem.order_id == child_order.id)
            .values(status=OrderItemStatus.cancelled_supplier, cancel_reason=reason)
        )

        # Статус → Order State Machine (централізовано)
        from core.order_service import change_order_status
        child_order = await change_order_status(
            db, child_order.id, OrderStatus.cancelled,
            changed_by_user_id=None,
            changed_by_manager_role=False,
        )
        parent_id = child_order.parent_order_id
             
    # Оновлюємо оригінальне повідомлення постачальника
    try:
        await bot.edit_message_text(
            text=cb.message.text + f"\n\n❌ **ЗАМОВЛЕННЯ СКАСОВАНО ВАМИ.**\nПричина: {reason}",
            chat_id=msg.chat.id,
            message_id=original_msg_id,
            reply_markup=None
        )
    except Exception:
        pass # Може бути помилка, якщо текст той самий

    await msg.answer(f"Замовлення {child_order_uid} скасовано. Клієнт отримає сповіщення.")
    
    if parent_id:
        await update_customer_message(bot, parent_id)