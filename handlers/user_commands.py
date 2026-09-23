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

from sqlalchemy import insert, select, func, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from config_reader import config
from database.db import AsyncSessionLocal
from database.models import (
    ManagerInvite,
    Product,
    ProductStatus,
    Supplier,
    User,
    UserRole,
    supplier_managers,
)

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
    Перевірку префікса робимо ВСЕРЕДИНІ хендлера.

    Логіка в ДВІ дії:
    1. Тут — валідація токена + створення юзера (якщо треба) і показ
       запрошення з кнопками «Прийняти» / «Відхилити». Менеджера ще НЕ
       призначаємо і токен НЕ витрачаємо.
    2. У cb_invite_accept — повторна валідація і ПРЯМИЙ INSERT у
       supplier_managers + invite.is_used = True.

    Стійкість (анти-«тиша»):
    - Уся логіка — в ОДНОМУ try/except: падіння Redis (FSM) або БД
      НІКОЛИ не лишає користувача без відповіді.
    - SkipHandler обов'язково підіймається ПОЗА try/except, інакше
      except Exception перехопить його, і чужі лінки (show_sku_ тощо)
      застрягнуть у цьому хендлері замість передачі далі по ланцюжку.
    """
    # Перевірка префікса — ДО try і без Redis/БД: ловимо ЛИШЕ /start manager_...
    # SkipHandler обов'язково підіймається ПОЗА try/except, інакше
    # except Exception перехопить його, і чужі лінки (show_sku_ тощо)
    # застрягнуть у цьому хендлері замість передачі далі по ланцюжку.
    if not command.args or not command.args.startswith("manager_"):
        logger.info(
            "Deep-link /start з іншим payload (%r) — інвайт-хендлер пропускає його.",
            command.args,
        )
        raise SkipHandler()

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
                await db.flush()  # отримуємо user.id
                # ФІКСУЄМО юзера ОДРАЗУ: сесція тут закінчується без
                # спільного commit (токен ми ще не витрачаємо), а без
                # записаного в БД юзера кнопка «Прийняти» не знайде його
                # профіль у cb_invite_accept. expire_on_commit=False,
                # тому об'єкт юзера після commit лишається придатним.
                await db.commit()
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

            # 5. Рахуємо активні товари магазину для показу в запрошенні.
            product_count = (
                await db.execute(
                    select(func.count())
                    .select_from(Product)
                    .where(
                        Product.supplier_id == supplier.id,
                        Product.status == ProductStatus.active,
                    )
                )
            ).scalar() or 0

        # FSM-скидання ПЕРЕД показом запрошення: перехід за лінком і вибір
        # кнопки — тепер ДВІ окремі дії, тому старий стан скидаємо одразу.
        # Помилка Redis не має права проковтнути запрошення.
        try:
            await state.clear()
        except Exception as fsm_error:
            logger.warning("state.clear() перед показом запрошення впав (Redis?): %s", fsm_error)

        # 6. НЕ призначаємо менеджера одразу — лише показуємо запрошення.
        # Призначення відбудеться у callback-хендлері після вибору кнопки.
        store_name = html.escape(supplier.store_name or supplier.name or "магазину")
        raw_desc = (supplier.store_description or "").strip()
        if raw_desc:
            desc_preview = html.escape(raw_desc[:100] + ("…" if len(raw_desc) > 100 else ""))
            desc_line = f"📝 <i>{desc_preview}</i>\n"
        else:
            desc_line = ""
        text = (
            "👋 <b>Запрошення!</b>\n\n"
            f"Вас запрошують стати менеджером магазину <b>{store_name}</b>.\n\n"
            f"{desc_line}"
            f"📦 Товарів у каталозі: <b>{product_count}</b>.\n\n"
            "Зробіть свій вибір:"
        )
        kb = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(text="✅ Прийняти", callback_data=f"invite_acc_{token}"),
                    InlineKeyboardButton(text="❌ Відхилити", callback_data=f"invite_dec_{token}"),
                ]
            ]
        )
        await msg.answer(text, reply_markup=kb)

    except Exception as e:
        logger.error("Error in invite handler", exc_info=True)
        await msg.answer(
            "❌ Виникла технічна помилка. Спробуйте пізніше або зверніться до підтримки."
        )


# --- Callback-хендлери вибору за запрошенням ---

async def _finish_invite(
    call: types.CallbackQuery,
    text: str,
    reply_markup: Optional[InlineKeyboardMarkup] = None,
):
    """
    Безпечно редагує повідомлення із запрошенням і закриває callback.
    TelegramApiException (message is not modified / message to edit not found)
    не має права залишити юзера без відповіді.
    """
    try:
        await call.message.edit_text(text, reply_markup=reply_markup)
    except Exception as edit_error:
        logger.warning("edit_text запрошення впав: %s", edit_error)
        try:
            await call.message.answer(text, reply_markup=reply_markup)
        except Exception as answer_error:
            logger.error("Резервний answer після падіння edit_text теж впав: %s", answer_error)


@router.callback_query(F.data.startswith("invite_acc_"))
async def cb_invite_accept(call: types.CallbackQuery):
    """
    «✅ Прийняти»: призначаємо менеджера у БД.

    Гарантія одноразовості — АТОМАРНИЙ claim через
    UPDATE manager_invites SET is_used=true
    WHERE token=? AND is_used=false
    → rowcount 0 означає: лінк уже хтось використав/спалив.
    Це страхує від подвійного кліку та гонок у/webhook-ів.
    """
    token = call.data.removeprefix("invite_acc_")

    try:
        async with AsyncSessionLocal() as db:
            # 1. Атомарно «забираємо» токен: якщо rowcount == 0 —
            #    лінк уже використаний (прийнятий або відхилений).
            claim = (
                await db.execute(
                    update(ManagerInvite)
                    .where(
                        ManagerInvite.token == token,
                        ManagerInvite.is_used.is_(False),
                    )
                    .values(is_used=True)
                )
            ).rowcount
            if not claim:
                await _finish_invite(
                    call, "❌ Це посилання вже було використано (або його відхилили)."
                )
                await call.answer()
                return

            # 2. Витягуємо інвайт + магазин (токен уже наш, нікому не дістанеться)
            stmt = (
                select(ManagerInvite)
                .where(ManagerInvite.token == token)
                .options(joinedload(ManagerInvite.supplier))
            )
            invite = (await db.execute(stmt)).scalar_one_or_none()
            if not invite:
                await _finish_invite(call, "❌ Посилання недійсне.")
                await call.answer()
                return
            if _invite_expired(invite.expires_at):
                await _finish_invite(call, "❌ Термін дії посилання минув.")
                await call.answer()
                return

            supplier = invite.supplier
            if not supplier:
                await _finish_invite(
                    call, "❌ Магазин, до якого вас запрошували, більше не існує."
                )
                await call.answer()
                return

            # 3. Користувач, що натиснув кнопку (обов'язково існує —
            #    він був створений на етапі /start, але тримаємо оборону)
            user = (
                await db.execute(
                    select(User).where(User.telegram_id == call.from_user.id)
                )
            ).scalar_one_or_none()
            if not user:
                await _finish_invite(
                    call, "❌ Не вдалося визначити ваш профіль. Натисніть /start і спробуйте ще раз."
                )
                await call.answer()
                return

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
                await _finish_invite(call, "ℹ️ Ви вже є менеджером цього магазину.")
                await call.answer()
                return

            # 5. Призначаємо менеджера ПРЯМИМ INSERT-ом у таблицю-посередник.
            # НЕ supplier.managers.append(user): у async-сесії це ліниво
            # довантажує колекцію relationship і падає з MissingGreenlet.
            # IntegrityError — рятівна сітка, якщо два паралельні запити
            # пройшли claim одночасно (PK у supplier_managers складений).
            try:
                await db.execute(
                    insert(supplier_managers).values(
                        supplier_id=supplier.id, user_id=user.id
                    )
                )
            except IntegrityError:
                await db.rollback()
                await _finish_invite(call, "ℹ️ Ви вже є менеджером цього магазину.")
                await call.answer()
                return

            await db.commit()

        store_name = html.escape(supplier.store_name or supplier.name or "магазину")
        text = (
            "✅ Ви стали менеджером магазину "
            f"<b>{store_name}</b>."
        )
        await _finish_invite(call, text, reply_markup=_manager_miniapp_kb(supplier.id))
        await call.answer("✅ Готово!")

    except Exception as e:
        logger.error("Error in invite accept callback", exc_info=True)
        await _finish_invite(
            call, "❌ Виникла технічна помилка. Спробуйте пізніше або зверніться до підтримки."
        )
        await call.answer()


@router.callback_query(F.data.startswith("invite_dec_"))
async def cb_invite_decline(call: types.CallbackQuery):
    """
    «❌ Відхилити»: спалюємо токен (is_used=True), щоб лінком
    більше ніхто не міг скористатися, і прибираємо кнопки.
    """
    token = call.data.removeprefix("invite_dec_")

    # Спалюємо токен атомарно. Помилка тут не критична (лінк і так
    # одноразовий), тому лише логуємо — відмова юзера фіксується.
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(ManagerInvite)
                .where(
                    ManagerInvite.token == token,
                    ManagerInvite.is_used.is_(False),
                )
                .values(is_used=True)
            )
            await db.commit()
    except Exception as burn_error:
        logger.warning("Не вдалося спалити токен відмови %r: %s", token, burn_error)

    try:
        await _finish_invite(call, "❌ Ви відхилили запрошення.")
    except Exception as e:
        logger.error("Error in invite decline callback", exc_info=True)
        await call.message.answer(
            "❌ Виникла технічна помилка. Спробуйте пізніше або зверніться до підтримки."
        )
    await call.answer()


# --- /start БЕЗ deep-link: реєструємо ПІСЛЯ deep-link хендлера ---
# ПОРЯДОК ВАЖЛИВИЙ: aiogram перевіряє хендлери послідовно, і перший, чий
# фільтр зматчився, забирає оновлення. CommandStart(deep_link=False) також
# матчить /start manager_... , тому цей хендлер обов'язково має йти ПІСЛЯ
# cmd_start_manager_invite — інакше інвайт-хендлер ніколи не отримає керування.
@router.message(CommandStart(deep_link=False))
async def cmd_start_simple(msg: Message, state: FSMContext):
    """Обробник /start без deep-link (звичайний запуск бота)."""
    # Та сама анти-«тиша» оборона, що й в інвайт-хендлері: лежачий Redis
    # (FSM) не має права проковтнути вітання — скидання стану некритичне.
    try:
        await state.clear()
    except Exception as fsm_error:
        logger.warning("state.clear() у cmd_start_simple впав (Redis?): %s", fsm_error)

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