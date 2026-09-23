# handlers/user_commands.py
from aiogram import Router, F, types
from aiogram.types import Message, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from aiogram.filters import CommandStart, CommandObject
from aiogram.dispatcher.event.bases import SkipHandler
from aiogram.fsm.context import FSMContext
# Ми ВИДАЛИЛИ імпорт get_main_kb, бо його немає.
# Ми ВИДАЛИЛИ імпорт CartCallback, бо він тут не потрібен.
from keyboards.inline_keyboards import build_cart_kb, CartCallback # <-- ТЕПЕР ЦЕ ТУТ
from services import cart_service

# --- Deep-link менеджера: /start manager_{token} ---
import html
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from config_reader import config
from database.db import AsyncSessionLocal
from database.models import ManagerInvite, Supplier, User, UserRole, supplier_managers

logger = logging.getLogger(__name__)

# Створюємо роутер
router = Router()


# --- Deep-link: запрошення менеджера до магазину ---

def _manager_miniapp_kb(supplier_id: int) -> Optional[InlineKeyboardMarkup]:
    """Кнопка «Відкрити Mini App» на сторінку керування магазином."""
    base = config.MINI_APP_URL
    if not base:
        return None
    web_url = f"{base}/store-management/{supplier_id}?startapp=manager_{supplier_id}"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🛖 Відкрити Mini App",
                    web_app=WebAppInfo(url=web_url),
                )
            ]
        ]
    )


def _invite_expired(expires_at: Optional[datetime]) -> bool:
    """True, якщо час дії токена минув (naive-час вважаємо UTC)."""
    if expires_at is None:
        return True
    expires = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
    return expires < datetime.now(timezone.utc)


@router.message(CommandStart(deep_link=True))
async def cmd_start_manager_invite(msg: Message, command: CommandObject, state: FSMContext):
    """
    Обробляє інвайт-посилання: /start manager_{token}
    Токен з таблиці manager_invites (24 год, одноразовий).

    Фільтр — максимально простий (лише deep_link=True), без magic-F.
    Перевірку префікса робимо ВСЕРЕДИНІ: якщо це не інвайт менеджера —
    просто виходимо (return), і жоден інший хендлер не постраждає.
    """
    # Жорстка перевірка всередині хендлера: ловимо ЛИШЕ /start manager_...
    if not command.args or not command.args.startswith("manager_"):
        logger.info(
            "Deep-link /start з іншим payload (%r) — інвайт-хендлер пропускає його.",
            command.args,
        )
        # НЕ return: через SkipHandler лінк (show_sku_ тощо) йде далі
        # по ланцюжку хендлерів, якби цього хендлера не існувало.
        raise SkipHandler()

    await state.clear()
    try:
        token = command.args.replace("manager_", "").strip()
        if not token:
            await msg.answer("❌ Посилання недійсне.")
            return

        telegram_id = msg.from_user.id

        async with AsyncSessionLocal() as db:
            # 1. Знаходимо інвайт разом із магазином
            stmt = (
                select(ManagerInvite)
                .where(ManagerInvite.token == token)
                .options(joinedload(ManagerInvite.supplier))
            )
            invite = (await db.execute(stmt)).scalar_one_or_none()

            # 2. Валідація токена
            if not invite:
                await msg.answer("❌ Посилання недійсне.")
                return
            if invite.is_used:
                await msg.answer("❌ Це посилання вже було використано.")
                return
            if _invite_expired(invite.expires_at):
                await msg.answer("❌ Термін дії посилання минув.")
                return

            supplier = invite.supplier
            if not supplier:
                await msg.answer("❌ Магазин, до якого вас запрошували, більше не існує.")
                return

            # 3. Знаходимо або створюємо користувача
            user = (
                await db.execute(select(User).where(User.telegram_id == telegram_id))
            ).scalar_one_or_none()
            if not user:
                user = User(
                    telegram_id=telegram_id,
                    first_name=msg.from_user.first_name,
                    last_name=msg.from_user.last_name,
                    username=msg.from_user.username,
                    full_name=msg.from_user.full_name,
                    role=UserRole.client,
                )
                db.add(user)
                await db.flush()  # отримуємо user.id без commit
                logger.info("Deep-link manager: створено User telegram_id=%s", telegram_id)

            # 4. Чи вже є менеджером цього магазину?
            already_manager = (
                await db.execute(
                    select(supplier_managers.c.user_id).where(
                        supplier_managers.c.supplier_id == supplier.id,
                        supplier_managers.c.user_id == user.id,
                    )
                )
            ).scalar_one_or_none()
            if already_manager:
                await msg.answer("ℹ️ Ви вже є менеджером цього магазину.")
                return

            # 5. Успіх: додаємо менеджера, позначаємо інвайт використаним
            supplier.managers.append(user)
            invite.is_used = True
            await db.commit()

        store_name = html.escape(supplier.store_name or supplier.name or "магазину")
        text = (
            "✅ Вітаємо! Ви стали менеджером магазину "
            f"<b>{store_name}</b>. Тепер ви можете керувати ним через Mini App."
        )
        await msg.answer(text, reply_markup=_manager_miniapp_kb(supplier.id))

    except Exception as e:
        logger.error("Помилка deep-link 'manager_': %s", e, exc_info=True)
        await msg.answer("⚠️ Сталася помилка. Спробуйте відкрити посилання ще раз.")


# --- /start БЕЗ deep-link: реєструємо ПІСЛЯ deep-link хендлера ---
# ПОРЯДОК ВАЖЛИВИЙ: aiogram перевіряє хендлери послідовно, і перший, чий
# фільтр зматчився, забирає оновлення. CommandStart(deep_link=False) також
# матчить /start manager_... , тому цей хендлер обов'язково має йти ПІСЛЯ
# cmd_start_manager_invite — інакше інвайт-хендлер ніколи не отримає керування.
@router.message(CommandStart(deep_link=False))
async def cmd_start_simple(msg: Message, state: FSMContext):
    """Обробник /start без deep-link (звичайний запуск бота)."""
    await state.clear()

    greeting_text = (
        f"Вітаю, {msg.from_user.full_name}! 👋\n\n"
        "Я — ваш бот-помічник 'Taverna'.\n\n"
        "👉 Ви можете відкрити наш повний <b>Каталог (MiniApp)</b>, "
        "натиснувши кнопку 'Меню' (ліворуч) або ввівши команду /catalog."
    )
    # Просто текст, без зайвих клавіатур (кнопка Меню вже налаштована в bot.py)
    await msg.answer(greeting_text)


# --- Додаємо обробник /basket ---
@router.message(F.text == "/basket")
async def show_cart_command(msg: Message, state: FSMContext):
    await show_cart(msg, state)

# --- Допоміжна функція для показу кошика ---
async def show_cart(target: Message | types.CallbackQuery, state: FSMContext):
    user_id = target.from_user.id
    cart_data = await cart_service.get_cart_contents(user_id)
    cart_items = cart_data[0]
    total_price = cart_data[1]

    if not cart_items:
        text = "🛒 Ваш кошик порожній."
        reply_markup = None
    else:
        text = "🛒 **Ваш кошик:**\n\n"
        for item in cart_items:
            text += (
                f"<b>{item['name']}</b> ({item['options_text']})\n"
                f"К-сть: {item['quantity']} шт. x {item['price']} грн\n\n"
            )
        text += f"<b>Загальна сума: {total_price} грн</b>"
        reply_markup = build_cart_kb(cart_items, total_price)

    if isinstance(target, types.CallbackQuery):
        await target.message.edit_text(text, reply_markup=reply_markup)
        await target.answer()
    else:
        await target.answer(text, reply_markup=reply_markup)

# --- Обробники кнопок кошика ---
@router.callback_query(F.data == "cart:close")
async def cb_close_cart(callback: types.CallbackQuery):
    await callback.message.delete()
    await callback.answer()

@router.callback_query(CartCallback.filter(F.action == 'clear'))
async def cb_clear_cart(callback: types.CallbackQuery, state: FSMContext):
    await cart_service.clear_cart(callback.from_user.id)
    await callback.answer("✅ Кошик успішно очищено!", show_alert=True)
    await show_cart(callback, state)