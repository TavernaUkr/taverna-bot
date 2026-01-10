# handlers/product_handlers.py
import logging
from aiogram import Router, F, Bot
from aiogram.types import Message, CallbackQuery
from aiogram.filters import Command, CommandStart, CommandObject
from aiogram.fsm.context import FSMContext
from urllib.parse import unquote

# Наші нові імпорти
from services import xml_parser, cart_service
from database.models import Product # Імпортуємо модель
from fsm.order_states import OrderFSM
from keyboards.inline_keyboards import (
    format_product_card, 
    build_product_details_kb,
    build_ask_quantity_kb,
    build_cart_added_kb
)
# TODO: Імпортувати cart_service, коли він буде готовий
# from services import cart_service 

logger = logging.getLogger(__name__)
router = Router()

async def _show_product_card(message: Message, sku: str, state: FSMContext, back_url: Optional[str] = None):
    """
    Універсальна функція для пошуку товару в БД та відображення картки.
    """
    product: Optional[Product] = await xml_parser.get_product_by_sku(sku)
    
    if not product:
        await message.answer(f"На жаль, товар з артикулом <code>{sku}</code> не знайдено.")
        return

    if not product.variants or not any(v.is_available for v in product.variants):
        await message.answer(f"На жаль, товар <b>{product.name}</b> (<code>{sku}</code>) тимчасово відсутній.")
        return
        
    # Формуємо картку та клавіатуру з нових функцій
    text_card = format_product_card(product)
    keyboard = build_product_details_kb(product, back_url)
    
    # Зберігаємо поточний SKU в FSM, щоб повернутись до нього
    await state.update_data(current_sku=product.sku)
    
    # Відправляємо фото (якщо є) або текст
    if product.pictures:
        try:
            await message.answer_photo(
                photo=product.pictures[0],
                caption=text_card,
                reply_markup=keyboard
            )
            return
        except Exception as e:
            logger.warning(f"Не вдалося завантажити фото {product.pictures[0]} для SKU {sku}: {e}")
            # Продовжуємо і відправляємо як текст
    
    await message.answer(text_card, reply_markup=keyboard)


# --- 1. Обробка DeepLink з каналу (з bot_updated_77) ---
@router.message(CommandStart(deep_link=True, magic=F.args.startswith("show_sku_")))
async def cmd_start_show_sku(msg: Message, command: CommandObject, state: FSMContext):
    """
    Обробляє посилання типу: /start show_sku_12345_from_https://t.me/channel/123
    """
    try:
        args_part = command.args.replace("show_sku_", "")
        
        raw_sku = args_part
        back_url = None
        
        if "_from_" in args_part:
            parts = args_part.split('_from_')
            raw_sku = parts[0]
            back_url = unquote(parts[1]) if len(parts) > 1 else None
            
        logger.info(f"DeepLink: SKU={raw_sku}, BackURL={back_url}")
        
        if not raw_sku:
            await msg.answer("Помилка посилання. Не вдалося знайти артикул.")
            return

        # Використовуємо нашу нову універсальну функцію
        await _show_product_card(msg, raw_sku, state, back_url)

    except Exception as e:
        logger.error(f"Помилка обробки deep-link 'show_sku': {e}", exc_info=True)
        await msg.answer("Сталася помилка під час обробки вашого запиту. Спробуйте ще раз.")


# --- 2. Обробка ручного пошуку (/start -> "Пошук") ---
@router.callback_query(F.data == "start_search")
async def cb_start_search(cb: CallbackQuery, state: FSMContext):
    await state.set_state(OrderFSM.awaiting_article_search)
    await cb.message.answer("Введіть артикул або назву товару для пошуку:")
    await cb.answer()

@router.message(OrderFSM.awaiting_article_search)
async def process_sku_search(msg: Message, state: FSMContext):
    await state.clear() # Очищуємо стан очікування
    raw_sku = msg.text.strip()
    
    # Використовуємо нашу нову універсальну функцію
    # (back_url тут не потрібен, бо це ручний пошук)
    await _show_product_card(msg, raw_sku, state, back_url=None)


# --- 3. Обробка вибору розміру (після _show_product_card) ---
@router.callback_query(F.data.startswith("select_size:"))
async def cb_select_size(cb: CallbackQuery, state: FSMContext):
    try:
        variant_offer_id = cb.data.split(":")[1]
    except (IndexError, ValueError):
        await cb.answer("Помилка вибору розміру.", show_alert=True)
        return

    # Зберігаємо ID варіанту у FSM
    await state.update_data(selected_variant_offer_id=variant_offer_id)
    
    # Переводимо на вибір кількості
    await state.set_state(OrderFSM.awaiting_quantity)
    
    # Будуємо клавіатуру для кількості
    kb = build_ask_quantity_kb(variant_offer_id)
    
    await cb.message.edit_reply_markup(reply_markup=None) # Прибираємо клавіатуру розмірів
    await cb.message.answer("Тепер оберіть кількість:", reply_markup=kb)
    await cb.answer()


# --- 4. Обробка повернення до вибору розмірів ---
@router.callback_query(F.data == "back_to_sizes")
async def cb_back_to_sizes(cb: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    sku = data.get("current_sku")
    
    if not sku:
        await cb.answer("Не вдалося повернутись. Почніть пошук заново.", show_alert=True)
        await state.clear()
        await cb.message.delete()
        return

    # "Перезапускаємо" показ картки товару
    await cb.message.delete() # Видаляємо повідомлення "Оберіть кількість"
    await _show_product_card(cb.message, sku, state, back_url=None)
    await cb.answer()

# --- 5. Обробка вибору кількості (фінальний крок) ---
# ЗАМІНИ ЦЮ ФУНКЦІЮ ПОВНІСТЮ
@router.callback_query(F.data.startswith("select_qty:"))
async def cb_select_quantity(cb: CallbackQuery, state: FSMContext):
    try:
        _, variant_offer_id, quantity_str = cb.data.split(":")
        quantity = int(quantity_str)
    except (IndexError, ValueError):
        await cb.answer("Помилка вибору кількості.", show_alert=True)
        return

    # 1. Викликаємо наш новий cart_service
    success = await cart_service.add_item_to_cart(
        user_id=cb.from_user.id,
        variant_offer_id=variant_offer_id,
        quantity=quantity
    )

    if not success:
        await cb.answer("Не вдалося додати товар. Можливо, його немає в наявності.", show_alert=True)
        return

    # 2. Отримуємо загальну суму кошика, щоб показати на кнопці
    _, total_price = await cart_service.get_cart_contents(cb.from_user.id)
    
    # 3. Будуємо нову клавіатуру
    kb = build_cart_added_kb(total_price)

    # 4. Повідомляємо користувача
    await cb.message.edit_text(
        f"✅ Товар у кількості {quantity} шт. додано до кошика.\n\n"
        f"Загальна сума у кошику: <b>{total_price} грн</b>.",
        reply_markup=kb
    )
    
    # Очищуємо FSM стану вибору товару
    await state.set_state(None) # Виходимо з FSM
    await state.update_data(current_sku=None, selected_variant_offer_id=None) # Чистимо дані
    await cb.answer("Додано до кошика!")

# --- Обробник "Скасувати" ---
@router.callback_query(F.data == "cancel_action")
async def cb_cancel_action(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    await cb.message.edit_text("Дію скасовано. Ви можете почати заново з /start")
    await cb.answer("Скасовано")