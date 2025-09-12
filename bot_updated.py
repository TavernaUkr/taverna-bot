# -*- coding: utf-8 -*-
"""
Bot with FSM (real & test modes)
- Aiogram bot with FSM for orders
- Telethon reposts supplier posts with +33% markup
- MyDrop integration: real vs test mode
- Nova Poshta API integration
- Flask healthcheck
"""

import os
import sys
import json
import asyncio
import logging
import threading
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List
import re
import io

import aiohttp
from dotenv import load_dotenv
from flask import Flask

from aiogram import Bot, Dispatcher, Router, F
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import StatesGroup, State
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message, CallbackQuery,
    InlineKeyboardButton, InlineKeyboardMarkup,
)

from telethon import TelegramClient

# ---------------- Config & Env ----------------
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("taverna")

def check_env_vars():
    print("=== Checking ENV variables ===")
    BOT_TOKEN = os.getenv("BOT_TOKEN")
    if not BOT_TOKEN:
        print("❌ ERROR: BOT_TOKEN is missing")
        sys.exit(1)

    env_vars = [
        "BOT_TOKEN", "BOT_USERNAME", "ADMIN_ID",
        "TEST_CHANNEL", "MAIN_CHANNEL", "TG_API_ID", "TG_API_HASH",
        "SESSION_NAME", "SUPPLIER_CHANNEL", "SUPPLIER_NAME",
        "NP_API_KEY", "NP_API_URL", "MYDROP_API_KEY", "MYDROP_EXPORT_URL", "MYDROP_ORDERS_URL", "ORDERS_DIR", "USE_GCS", "GCS_BUCKET",
        "SERVICE_ACCOUNT_JSON", "USE_GDRIVE", "GDRIVE_FOLDER_ID", "TEST_MODE"
    ]
    for var in env_vars:
        value = os.getenv(var)
        if value:
            print(f"✅ {var} = {str(value)[:40]}...")
        else:
            print(f"⚠️ {var} is not set")
    print("=== End ENV check ===")
    return BOT_TOKEN

BOT_TOKEN = check_env_vars()
BOT_USERNAME = os.getenv("BOT_USERNAME")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))
TEST_CHANNEL = os.getenv("TEST_CHANNEL")
MAIN_CHANNEL = os.getenv("MAIN_CHANNEL")

api_id = int(os.getenv("TG_API_ID", "0") or 0)
api_hash = os.getenv("TG_API_HASH", "")
SESSION_NAME = os.getenv("SESSION_NAME", "bot1")
supplier_channel = os.getenv("SUPPLIER_CHANNEL")
supplier_name = os.getenv("SUPPLIER_NAME", "Supplier")

NP_API_KEY = os.getenv("NP_API_KEY")
NP_API_URL = os.getenv("NP_API_URL")

MYDROP_API_KEY = os.getenv("MYDROP_API_KEY")
MYDROP_EXPORT_URL = os.getenv("MYDROP_EXPORT_URL")
MYDROP_ORDERS_URL = os.getenv("MYDROP_ORDERS_URL")

ORDERS_DIR = os.getenv("ORDERS_DIR", "/tmp/orders")
Path(ORDERS_DIR).mkdir(parents=True, exist_ok=True)

TEST_MODE = os.getenv("TEST_MODE", "false").lower() == "true"

# ---------------- Cache for MyDrop products ----------------
PRODUCTS_CACHE = {
    "last_update": None,
    "data": None
}
CACHE_TTL = 900  # 15 хвилин (900 секунд)

# ---------------- Flask ----------------
app = Flask(__name__)

@app.route("/")
def index():
    return "Bot is running!", 200

@app.route("/healthz")
def healthz():
    logger.info("🔄 Healthcheck запит отримано (keepalive ping).")
    return "ok", 200

def run_flask():
    port = int(os.getenv("PORT", 10000))
    logging.info(f"🌐 Flask healthcheck running on port {port}")
    app.run(host="0.0.0.0", port=port)

# ---------------- Aiogram bot ----------------
bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher(storage=MemoryStorage())
router = Router()
dp.include_router(router)
from aiogram.types import BotCommand

async def setup_commands():
    commands = [
        BotCommand(command="start", description="Почати роботу з ботом"),
        BotCommand(command="publish_test", description="Опублікувати тестовий пост (адмін)"),
        BotCommand(command="refresh_cache", description="Оновити кеш вигрузки (адмін)"),
    ]
    try:
        await bot.set_my_commands(commands)
    except Exception as e:
        logger.exception("Cannot set bot commands: %s", e)

# ---------------- FSM ----------------
class OrderForm(StatesGroup):
    pib = State()
    phone = State()
    article = State()
    amount = State()
    delivery = State()
    address = State()
    payment = State()
    note = State()
    confirm = State()

# ---------------- Helpers: keyboards ----------------
def get_order_keyboard(post_id: int, test: bool = False):
    mode = "test" if test else "real"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🛒 Замовити", url=f"https://t.me/{BOT_USERNAME}?start=order_{mode}_{post_id}")]
        ]
    )

def delivery_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚚 Нова Пошта", callback_data="delivery:np")],
        [InlineKeyboardButton(text="📮 Укр Пошта", callback_data="delivery:ukr")],
        [InlineKeyboardButton(text="🛒 Rozetka", callback_data="delivery:rozetka")],
        [InlineKeyboardButton(text="📦 Justin", callback_data="delivery:justin")],
        [InlineKeyboardButton(text="✈️ Meest", callback_data="delivery:meest")],
    ])

def payment_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="💵 Накладений платіж", callback_data="pay:cod")],
        [InlineKeyboardButton(text="💳 Повна передоплата", callback_data="pay:full")],
        [InlineKeyboardButton(text="💸 Часткова передоплата (33%)", callback_data="pay:part")],
    ])

def confirm_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Підтвердити", callback_data="order:confirm")],
        [InlineKeyboardButton(text="❌ Скасувати", callback_data="order:cancel")]
    ])

# ---------------- Routers / Handlers ----------------
@router.message(CommandStart(deep_link=True))
async def cmd_start(msg: Message, state: FSMContext, command: CommandStart):
    args = command.args or ""
    if args.startswith("order_"):
        parts = args.split("_")
        if len(parts) == 3:
            mode, post_id = parts[1], parts[2]
            await state.update_data(post_message_id=post_id, mode=mode)
            await msg.answer("🧾 Розпочнемо оформлення. Введіть ваші ПІБ:")
            await state.set_state(OrderForm.pib)
            return
    await msg.answer(
        "Привіт! Це бот Taverna 👋\n"
        "Натисніть кнопку «Замовити» під постом у каналі, щоб оформити замовлення."
    )

# ---------------- Test command ----------------
@router.message(Command("publish_test"))
async def cmd_publish_test(msg: Message):
    if msg.from_user.id != ADMIN_ID:
        await msg.answer("⚠️ У вас немає прав на виконання цієї команди.")
        return
    text = (
        "🔥 <b>Тестовий пост для</b> @test_taverna\n\n"
        "Це перевірка кнопки <b>«Замовити»</b>.\n"
        "Натисніть і перевірте форму замовлення."
    )
    kb = get_order_keyboard(post_id=12345, test=True)  # test=True -> order_test_xxx
    try:
        await bot.send_message(TEST_CHANNEL, text, reply_markup=kb)
        await msg.answer("✅ Тестовий пост опубліковано в тестовому каналі.")
    except Exception as e:
        await msg.answer(f"⚠️ Помилка при публікації: {e}")

@router.message(Command("refresh_cache"))
async def cmd_refresh_cache(msg: Message):
    if msg.from_user.id != ADMIN_ID:
        await msg.answer("⚠️ У вас немає прав на виконання цієї команди.")
        return
    """Примусово оновлює кеш вигрузки товарів"""
    await msg.answer("⏳ Оновлюю кеш вигрузки...")
    text = await load_products_export(force=True)
    if text:
        await msg.answer("✅ Кеш оновлено успішно.")
    else:
        await msg.answer("⚠️ Помилка при оновленні кешу. Перевір логи.")

# --- ПІБ ---
@router.message(OrderForm.pib)
async def state_pib(msg: Message, state: FSMContext):
    if len(msg.text.split()) < 3:
        await msg.answer("❌ Введіть повне ПІБ (Прізвище Ім'я По-батькові).")
        return
    await state.update_data(pib=msg.text)
    await msg.answer("Введіть телефон (у форматі +380XXXXXXXXX):")
    await state.set_state(OrderForm.phone)

# --- Телефон ---
@router.message(OrderForm.phone)
async def state_phone(msg: Message, state: FSMContext):
    phone = msg.text.strip()
    if not re.match(r"^\+380\d{9}$", phone):
        await msg.answer("❌ Телефон має бути у форматі +380XXXXXXXXX.")
        return
    await state.update_data(phone=phone)
    await msg.answer("Введіть артикул або назву товару:")
    await state.set_state(OrderForm.article)

async def load_products_export(force: bool = False) -> Optional[str]:
    """
    Завантажує вигрузку з MYDROP_EXPORT_URL (YML/JSON) з кешем.
    Якщо force=True — качає заново навіть якщо кеш ще актуальний.
    """
    global PRODUCTS_CACHE
    now = datetime.now()

    # Використати кеш, якщо він свіжий
    if not force and PRODUCTS_CACHE["last_update"] and (now - PRODUCTS_CACHE["last_update"]).seconds < CACHE_TTL:
        return PRODUCTS_CACHE["data"]

    export_url = os.getenv("MYDROP_EXPORT_URL")
    if not export_url:
        logger.error("❌ MYDROP_EXPORT_URL не налаштований")
        return None

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(export_url, timeout=20) as resp:
                if resp.status != 200:
                    logger.warning("⚠️ Export URL error %s", resp.status)
                    return None
                text = await resp.text()

                PRODUCTS_CACHE["last_update"] = now
                PRODUCTS_CACHE["data"] = text

                # збережемо у файл (бекап)
                cache_file = Path(ORDERS_DIR) / "products_cache.xml"
                cache_file.write_text(text, encoding="utf-8")

                logger.info("✅ Завантажено нову вигрузку (%d символів)", len(text))
                return text
    except Exception as e:
        logger.error("Помилка завантаження вигрузки: %s", e)

        # fallback — беремо з кеш-файлу
        cache_file = Path(ORDERS_DIR) / "products_cache.xml"
        if cache_file.exists():
            return cache_file.read_text(encoding="utf-8")

        return None

# --- Артикул або назва ---
import io
import xml.etree.ElementTree as ET
from typing import Optional, Dict, Any

def apply_markup(price: Optional[float]) -> Optional[int]:
    """Додає +33% до ціни і округлює до гривні (int)."""
    try:
        if price is None:
            return None
        return int(round(float(price) * 1.33))
    except Exception:
        return None

async def check_article_or_name(query: str) -> Optional[Dict[str, Any]]:
    """
    Шукає товар по артикулу або назві у вигрузці (MYDROP_EXPORT_URL).
    Повертає dict з полями:
      - name, sku, drop_price (float|None), retail_price (float|None),
      - final_price (int|None) — клієнтська ціна = drop_price*1.33 округлено,
      - stock (str), sizes (list[str]) або None,
      - suggestion (bool) якщо це частковий збіг.
    Використовує ET.iterparse для мінімального використання пам'яті.
    """
    q = str(query or "").strip().lower()
    if not q:
        return None

    text = await load_products_export()
    if not text:
        return None

    try:
        it = ET.iterparse(io.StringIO(text), events=("end",))
        for event, elem in it:
            # нормалізація тега (без namespace)
            tag = elem.tag
            if tag.endswith("offer") or tag.endswith("item") or tag.endswith("product"):
                offer_id = (elem.attrib.get("id") or "").strip()
                vendor_code = (elem.findtext("vendorCode") or elem.findtext("sku") or "").strip()
                name = (elem.findtext("name") or elem.findtext("title") or "").strip()
                price_text = elem.findtext("price") or ""
                try:
                    drop_price = float(price_text) if price_text.strip() else None
                except Exception:
                    drop_price = None
                # retail price (RRC) може бути в різних полях
                rrc_text = elem.findtext("rrc") or elem.findtext("retail") or elem.findtext("oldprice") or None
                try:
                    retail_price = float(rrc_text) if rrc_text and str(rrc_text).strip() else None
                except Exception:
                    retail_price = None

                # кількість у наявності
                quantity_text = elem.findtext("quantity_in_stock")
                stock_qty = None
                if quantity_text and quantity_text.strip().isdigit():
                    stock_qty = int(quantity_text.strip())

                # якщо нема кількості — fallback на available
                stock_attr = elem.attrib.get("available", "true").lower()
                stock = "Є" if stock_attr in ("true", "1", "yes") else "Немає"

                # size params: шукаємо param name=... які містять 'size' або 'розмір'
                sizes = []
                for p in elem.findall("param"):
                    pname = p.attrib.get("name", "").lower()
                    if "size" in pname or "розмір" in pname or "размер" in pname:
                        if (p.text or "").strip():
                            sizes.append(p.text.strip())

                # --- 1) точний пошук по артикулу (id або vendorCode) ---
                if q == offer_id.lower() or (vendor_code and q == vendor_code.lower()):
                    elem.clear()
                    return {
                        "name": name or offer_id,
                        "sku": vendor_code or offer_id,
                        "drop_price": drop_price,
                        "retail_price": retail_price,
                        "final_price": apply_markup(drop_price) if drop_price is not None else None,
                        "stock": stock,
                        "stock_qty": stock_qty,
                        "sizes": sizes or None
                    }

                # --- 2) точний пошук по назві ---
                if name and q == name.lower():
                    elem.clear()
                    return {
                        "name": name,
                        "sku": vendor_code or offer_id,
                        "drop_price": drop_price,
                        "retail_price": retail_price,
                        "final_price": apply_markup(drop_price) if drop_price is not None else None,
                        "stock": stock,
                        "stock_qty": stock_qty,
                        "sizes": sizes or None
                    }

                # --- 3) частковий пошук по назві (перший збіг) ---
                if name and q in name.lower() and len(q) >= 3:
                    elem.clear()
                    return {
                        "suggestion": True,
                        "name": name,
                        "sku": vendor_code or offer_id,
                        "drop_price": drop_price,
                        "retail_price": retail_price,
                        "final_price": apply_markup(drop_price) if drop_price is not None else None,
                        "stock": stock,
                        "sizes": sizes or None
                    }

                # очищення для економії пам'яті
                elem.clear()
        # кінець ітерації
    except Exception as e:
        logger.exception("XML parse error in check_article_or_name: %s", e)

    return None

# --- FSM: отримання артикулу або назви ---
@router.message(OrderForm.article)
async def state_article(msg: Message, state: FSMContext):
    query = msg.text.strip()
    await msg.chat.do("typing")
    product = await check_article_or_name(query)

    if not product:
        await msg.answer("❌ Не знайдено товар. Спробуйте ще раз (артикул або частина назви) або напишіть 'підтримка'.")
        return

    stock_text = (
    f"{product['stock']} ({product['stock_qty']} шт.)"
    if product.get("stock_qty") is not None
    else product["stock"]
)

    # Якщо це лише пропозиція (частковий збіг)
    if product.get("suggestion"):
        sizes_text = f"\n📏 Розміри: {', '.join(product['sizes'])}" if product.get("sizes") else ""
        await msg.answer(
            f"🤔 Можливо ви мали на увазі:\n"
            f"🔖 <b>{product['name']}</b>\n"
            f"🆔 Артикул: <b>{product['sku']}</b>\n"
            f"📦 Наявність: <b>{stock_text}</b>\n"
            f"💰 Орієнтовна ціна (з націнкою): {product.get('final_price') or '—'} грн\n"
            f"💵 Дроп ціна: {product.get('drop_price') or '—'} грн"
            f"{sizes_text}\n\n"
            "Якщо це те, що треба — введіть артикул для підтвердження замовлення."
        )
        return

    # Якщо точний збіг
    sizes_text = f"\n📏 Розміри: {', '.join(product['sizes'])}" if product.get("sizes") else ""
    await state.update_data(
        article=product["sku"],
        product_name=product["name"],
        stock=product["stock"],
        stock_qty=product.get("stock_qty"),
        price=product["final_price"]
    )
    await msg.answer(
        f"✅ Знайдено товар:\n"
        f"🔖 <b>{product['name']}</b>\n"
        f"🆔 Артикул: <b>{product['sku']}</b>\n"
        f"📦 Наявність: <b>{stock_text}</b>\n"
        f"💰 Ціна для клієнта: {product.get('final_price') or '—'} грн\n"
        f"💵 Дроп ціна: {product.get('drop_price') or '—'} грн"
        f"{sizes_text}\n\n"
        "👉 Введіть кількість товару (число):",
    )
    await state.set_state(OrderForm.amount)

# --- Кількість товару ---
@router.message(OrderForm.amount)
async def state_amount(msg: Message, state: FSMContext):
    try:
        qty = int(msg.text.strip())
        if qty < 1:
            raise ValueError
    except ValueError:
        await msg.answer("❌ Введіть правильне число (мінімум 1).")
        return

    data = await state.get_data()
    max_stock = data.get("stock_qty")

    # якщо є реальна кількість у stock_qty
    if max_stock is not None and qty > max_stock:
        await msg.answer(
            f"⚠️ Доступна кількість цього товару: <b>{max_stock} шт.</b>\n"
            f"Будь ласка, введіть іншу кількість:"
        )
        return  # залишаємо у цьому ж стані

    # якщо кількість доступна — зберігаємо
    await state.update_data(amount=qty)
    await msg.answer("Оберіть службу доставки:", reply_markup=delivery_keyboard())
    await state.set_state(OrderForm.delivery)

# --- Доставка ---
@router.callback_query(F.data.startswith("delivery:"))
async def cb_delivery(cb: CallbackQuery, state: FSMContext):
    delivery = cb.data.split(":")[1]
    await state.update_data(delivery=delivery)
    if delivery == "np":
        await cb.message.answer("Введіть місто для доставки (Нова Пошта):")
        await state.set_state(OrderForm.address)
    else:
        await cb.message.answer("Введіть адресу/відділення доставки:")
        await state.set_state(OrderForm.address)
    await cb.answer()

@router.message(OrderForm.address)
async def state_address(msg: Message, state: FSMContext):
    await state.update_data(address=msg.text)
    await msg.answer("Оберіть тип оплати:", reply_markup=payment_keyboard())
    await state.set_state(OrderForm.payment)

# --- Оплата ---
@router.callback_query(F.data.startswith("pay:"))
async def cb_payment(cb: CallbackQuery, state: FSMContext):
    payment = cb.data.split(":")[1]
    await state.update_data(payment=payment)
    await cb.message.answer("Додайте примітку (або напишіть 'нема'):")
    await state.set_state(OrderForm.note)
    await cb.answer()

# --- Примітка ---
@router.message(OrderForm.note)
async def state_note(msg: Message, state: FSMContext):
    note = msg.text.strip()
    await state.update_data(note=note)
    await msg.answer("Перевірте дані та підтвердіть замовлення:", reply_markup=confirm_keyboard())
    await state.set_state(OrderForm.confirm)

# --- Підтвердження ---
@router.callback_query(F.data == "order:confirm")
async def cb_order_confirm(cb: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    order_text = (
        "📦 НОВЕ ЗАМОВЛЕННЯ\n\n"
        f"👤 ПІБ: {data.get('pib')}\n"
        f"📞 Телефон: {data.get('phone')}\n"
        f"🔖 Товар: {data.get('product_name')} (SKU: {data.get('article')})\n"
        f"📦 Наявність: {data.get('stock')} шт.\n"
        f"🔢 Кількість: {data.get('amount', 1)} шт.\n"
        f"🚚 Служба: {data.get('delivery')}\n"
        f"📍 Адреса/відділення: {data.get('address')}\n"
        f"💳 Тип оплати: {data.get('payment')}\n"
        f"📝 Примітка: {data.get('note')}\n"
        f"🕒 Час: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
    )
    await cb.message.edit_text(order_text)
    await cb.answer()

    if data.get("mode") == "test":
        link = f"https://mydrop.com.ua/orders/new?prefill={json.dumps(data)}"
        kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🔗 Відкрити форму MyDrop", url=link)]])
        await bot.send_message(ADMIN_ID, f"Тестове замовлення:\n{order_text}", reply_markup=kb)
    else:
        asyncio.create_task(create_mydrop_order(data, notify_chat=ADMIN_ID))

    await state.clear()

@router.callback_query(F.data == "order:cancel")
async def cb_order_cancel(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    await cb.message.edit_text("Замовлення скасовано.")
    await cb.answer()

# ---------------- MyDrop integration ----------------
async def create_mydrop_order(payload: Dict[str, Any], notify_chat: Optional[int] = None):
    """
    Формує та відправляє замовлення в MyDrop (dropshipper endpoint).
    Використовує MYDROP_ORDERS_URL (POST) і заголовок X-API-KEY = MYDROP_API_KEY
    payload: словник зі стейту FSM (має містити pib, phone, article, product_name, stock, delivery, address, payment, note, mode)
    """
    orders_url = os.getenv("MYDROP_ORDERS_URL")
    api_key = os.getenv("MYDROP_API_KEY")
    if not orders_url or not api_key:
        logger.error("MYDROP_ORDERS_URL or MYDROP_API_KEY not configured")
        if notify_chat:
            await bot.send_message(notify_chat, "⚠️ MYDROP_ORDERS_URL або MYDROP_API_KEY не налаштовані на сервері.")
        return None

    # Сформуємо products масив згідно з docs (для dropshipper endpoint)
    article = payload.get("article")
    product_name = payload.get("product_name") or payload.get("title") or article or "Товар"
    amount = int(payload.get("amount", 1) or 1)
    # Якщо у state немає ціни — можна вказати 0 або намагатись витягти drop_price, але для безпечності ставимо 0
    price = payload.get("price") or 0
    # vendor_name необов'язкове — можна підставити SUPPLIER_NAME
    vendor_name = os.getenv("SUPPLIER_NAME") or payload.get("vendor_name") or None

    product_obj = {
        "product_title": product_name,
        "sku": article,
        "price": price,
        "amount": amount
    }
    if vendor_name:
        product_obj["vendor_name"] = vendor_name

    # Формуємо body
    body = {
        "name": payload.get("pib"),
        "phone": payload.get("phone"),
        "products": [product_obj],
    }

    # додаткові поля доставки
    if payload.get("delivery"):
        body["delivery_service"] = payload.get("delivery")
    if payload.get("address"):
        # якщо NP — може бути місто + warehouse_number; тут в state address зберігається те, що ввів користувач
        body["warehouse_number"] = payload.get("address")
    if payload.get("note"):
        body["description"] = payload.get("note")
    if payload.get("mode") == "test":
        body["order_source"] = "Bot Test"

    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json"
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(orders_url, json=body, headers=headers, timeout=20) as resp:
                text = await resp.text()
                try:
                    data = await resp.json()
                except Exception:
                    data = {"raw": text}
                if 200 <= resp.status < 300:
                    logger.info("MyDrop order created: %s", data)
                    if notify_chat:
                        # зберемо коротку інфу для адміна
                        await bot.send_message(notify_chat, f"✅ Замовлення відправлено в MyDrop.\nВідповідь: {json.dumps(data, ensure_ascii=False)}")
                    return data
                else:
                    logger.error("MyDrop order error %s: %s", resp.status, text)
                    if notify_chat:
                        await bot.send_message(notify_chat, f"❌ Помилка при створенні замовлення в MyDrop (status {resp.status}):\n{text}")
                    return None
    except Exception as e:
        logger.exception("Error creating MyDrop order: %s", e)
        if notify_chat:
            await bot.send_message(notify_chat, f"❌ Виняток при відправці в MyDrop: {e}")
        return None

# ---------------- Telethon client ----------------
telethon_client: Optional[TelegramClient] = None
if api_id and api_hash:
    session_path = SESSION_NAME
    try:
        telethon_client = TelegramClient(session_path, api_id, api_hash)
        logger.info("Telethon client initialized (session=%s)", session_path)
    except Exception:
        logger.exception("Failed init Telethon client")
        telethon_client = None
else:
    logger.warning("Telethon not configured (TG_API_ID/TG_API_HASH missing)")
    telethon_client = None

# ---------------- Main ----------------
async def main():
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()
    logger.info("Starting aiogram polling...")
    await setup_commands()

    # Завантажуємо кеш з файлу, якщо є
    cache_file = Path(ORDERS_DIR) / "products_cache.xml"
    if cache_file.exists():
        try:
            PRODUCTS_CACHE["data"] = cache_file.read_text(encoding="utf-8")
            PRODUCTS_CACHE["last_update"] = datetime.fromtimestamp(cache_file.stat().st_mtime)
            logger.info("Loaded products cache from file (size=%d)", len(PRODUCTS_CACHE['data'] or ''))
        except Exception as e:
            logger.exception("Failed to load products cache file: %s", e)

    await dp.start_polling(bot)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Bot stopped.")
