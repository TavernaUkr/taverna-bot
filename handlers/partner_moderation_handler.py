# handlers/partner_moderation_handler.py
"""Обробка кнопок Схвалити / Відхилити заявку партнера в Telegram."""
import logging

from aiogram import Bot, F, Router
from aiogram.types import CallbackQuery

from config_reader import config
from database.db import AsyncSessionLocal
from database.models import Supplier, SupplierStatus, User, UserRole

logger = logging.getLogger(__name__)
router = Router()


def _is_admin(telegram_id: int) -> bool:
    return telegram_id in set(config.ADMIN_IDS)


@router.callback_query(F.data.startswith("partner:approve:"))
async def approve_partner(cb: CallbackQuery, bot: Bot):
    if not cb.from_user or not _is_admin(cb.from_user.id):
        await cb.answer("Немає прав модератора.", show_alert=True)
        return

    try:
        supplier_id = int(cb.data.split(":")[-1])
    except (TypeError, ValueError):
        await cb.answer("Некоректний ID заявки.", show_alert=True)
        return

    async with AsyncSessionLocal() as db:
        supplier = await db.get(Supplier, supplier_id)
        if not supplier:
            await cb.answer("Заявку не знайдено.", show_alert=True)
            return
        if supplier.is_verified and supplier.status == SupplierStatus.active:
            await cb.answer("Заявку вже схвалено.", show_alert=True)
            return

        supplier.is_verified = True
        supplier.status = SupplierStatus.active
        if supplier.user_id:
            user = await db.get(User, supplier.user_id)
            if user and user.role != UserRole.admin:
                user.role = UserRole.supplier
        await db.commit()
        contact_id = supplier.contact_telegram_id
        name = supplier.name

    logger.info("Адмін %s схвалив партнера #%s", cb.from_user.id, supplier_id)
    base = cb.message.text or ""
    try:
        await cb.message.edit_text(
            base + "\n\n✅ <b>ЗАЯВКУ СХВАЛЕНО</b>",
            reply_markup=None,
        )
    except Exception:
        pass
    await cb.answer("Партнера схвалено.")

    if contact_id:
        try:
            await bot.send_message(
                chat_id=contact_id,
                text=(
                    f"✅ Вашу заявку постачальника <b>{name}</b> схвалено.\n"
                    "Тепер ви партнер Taverna Group."
                ),
            )
        except Exception as e:
            logger.warning("Не вдалося повідомити партнера %s: %s", contact_id, e)


@router.callback_query(F.data.startswith("partner:reject:"))
async def reject_partner(cb: CallbackQuery, bot: Bot):
    if not cb.from_user or not _is_admin(cb.from_user.id):
        await cb.answer("Немає прав модератора.", show_alert=True)
        return

    try:
        supplier_id = int(cb.data.split(":")[-1])
    except (TypeError, ValueError):
        await cb.answer("Некоректний ID заявки.", show_alert=True)
        return

    async with AsyncSessionLocal() as db:
        supplier = await db.get(Supplier, supplier_id)
        if not supplier:
            await cb.answer("Заявку не знайдено.", show_alert=True)
            return
        if supplier.status == SupplierStatus.rejected:
            await cb.answer("Заявку вже відхилено.", show_alert=True)
            return

        supplier.is_verified = False
        supplier.status = SupplierStatus.rejected
        await db.commit()
        contact_id = supplier.contact_telegram_id
        name = supplier.name

    logger.info("Адмін %s відхилив партнера #%s", cb.from_user.id, supplier_id)
    base = cb.message.text or ""
    try:
        await cb.message.edit_text(
            base + "\n\n❌ <b>ЗАЯВКУ ВІДХИЛЕНО</b>",
            reply_markup=None,
        )
    except Exception:
        pass
    await cb.answer("Заявку відхилено.")

    if contact_id:
        try:
            await bot.send_message(
                chat_id=contact_id,
                text=(
                    f"❌ На жаль, заявку постачальника <b>{name}</b> відхилено.\n"
                    "Якщо вважаєте це помилкою — напишіть адміністратору."
                ),
            )
        except Exception as e:
            logger.warning("Не вдалося повідомити заявника %s: %s", contact_id, e)
