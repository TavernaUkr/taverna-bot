# -*- coding: utf-8 -*-
"""
Bot with FSM (real & test modes)
Webhook mode (Flask) — feed raw updates into aiogram dispatcher thread-safely.
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
from flask import Flask, request
from urllib.parse import urlparse, parse_qs

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

# Telethon optional
from telethon import TelegramClient

app = Flask(__name__)

# ---------------- Config & Env ----------------
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("taverna")
logger.setLevel(logging.DEBUG)

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
        "SERVICE_ACCOUNT_JSON", "USE_GDRIVE", "GDRIVE_FOLDER_ID", "TEST_MODE", "WEBHOOK_URL"
    ]
    for var in env_vars:
        value = os.getenv(var)
        if value:
            # mask potentially sensitive values (show only first 4 chars + ...)
            if var.upper().endswith(("KEY", "TOKEN", "SECRET", "PASSWORD")) or var in ("BOT_TOKEN", "SERVICE_ACCOUNT_JSON", "MYDROP_API_KEY", "NP_API_KEY"):
                masked = (str(value)[:4] + "...(masked)")
            else:
                masked = str(value) if len(str(value)) < 60 else str(value)[:57] + "..."
            print(f"✅ {var} = {masked}")
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

WEBHOOK_PATH = "/webhook"
WEBHOOK_URL = os.getenv("WEBHOOK_URL")

# ---------------- Cache for MyDrop products ----------------
PRODUCTS_CACHE = {
    "last_update": None,
    "data": None
}
CACHE_TTL = 900  # 15 хвилин (900 секунд)

# ---------------- Index for fast lookup ----------------
PRODUCTS_INDEX = {
    "built_at": None,     # datetime when index was built
    "by_sku": {},         # exact sku (lower) -> product summary
    "by_offer": {},       # offer_id (lower) -> product summary
    "names": [],          # list of (lower_name, product_summary) for substring suggestions
}
INDEX_TTL = 1800  # 30 хвилин — перевобудовувати періодично

def normalize_sku(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    s = str(s).strip().lower()
    # remove spaces and leading zeros for numeric-like skus
    s = re.sub(r'\s+', '', s)
    if s.isdigit():
        return str(int(s))  # "0099" -> "99"
    # keep alnum + - _
    return re.sub(r'[^a-z0-9\-_]', '', s)

def build_products_index_from_xml(text: str):
    """
    Проходимо весь xml і будуємо простий індекс:
      - by_sku: normalized sku -> product dict
      - by_name: token -> [product dicts]

    Викликається один раз після load_products_export.
    """
    global PRODUCTS_INDEX
    PRODUCTS_INDEX = {"by_sku": {}, "by_name": {}, "all_products": []}
    try:
        it = ET.iterparse(io.StringIO(text), events=("end",))
        for event, elem in it:
            tag = _local_tag(elem.tag).lower()
            if not (tag.endswith("offer") or tag.endswith("item") or tag.endswith("product")):
                elem.clear(); continue

            offer_id = (elem.attrib.get("id") or "").strip()
            vendor_code = _find_first_text(elem, ["vendorcode", "vendor_code", "sku", "articul", "article", "code"])
            name = _find_first_text(elem, ["name", "title", "product", "model", "productname", "product_name"]) or offer_id
            drop_price = _find_first_numeric(elem, ["price","drop","cost","value","price_uah"])  # helper, see below
            retail_price = _find_first_numeric(elem, ["rrc","retail","msrp","oldprice"])
            stock_qty = None
            qtxt = _find_first_text(elem, ["quantity", "quantity_in_stock", "stock", "available_quantity", "count"])
            if qtxt:
                m = re.search(r'\d+', qtxt.replace(" ", ""))
                if m:
                    try:
                        stock_qty = int(m.group(0))
                    except:
                        stock_qty = None
            sku = normalize_sku(vendor_code or offer_id or "")
            product = {
                "offer_id": offer_id,
                "sku": sku,
                "vendor_code": vendor_code,
                "name": name,
                "drop_price": float(drop_price) if drop_price is not None else None,
                "retail_price": float(retail_price) if retail_price is not None else None,
                "stock_qty": stock_qty,
                "components": None  # keep raw for now; you can re-run your components extractor if needed
            }
            PRODUCTS_INDEX["all_products"].append(product)
            if sku:
                PRODUCTS_INDEX["by_sku"][sku] = product
            # index name tokens
            for tok in re.findall(r'\w{3,}', (name or "").lower()):
                PRODUCTS_INDEX["by_name"].setdefault(tok, []).append(product)
            elem.clear()
    except Exception:
        logger.exception("Failed to build products index")

# ---------------- global async loop holder ----------------
# буде заповнений в main()
ASYNC_LOOP: Optional[asyncio.AbstractEventLoop] = None

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
        logger.info("✅ Bot commands set")
    except Exception:
        logger.exception("Cannot set bot commands (non-fatal).")

# ---------------- FSM ----------------
class OrderForm(StatesGroup):
    pib = State()
    phone = State()
    article = State()
    size = State()
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

# Замінити стару size_keyboard на сумісну версію (виробляє callback_data "size:<comp_idx>:<opt_idx>")
def size_keyboard(sizes: List[str], component_index: int = 0) -> InlineKeyboardMarkup:
    """
    Сумісний з новим обробником callback'ів:
    - формує callback_data у форматі "size:<component_index>:<option_index>"
    - додає кнопку 'Скасувати'
    """
    kb = InlineKeyboardMarkup(row_width=3)
    buttons = [
        InlineKeyboardButton(text=str(s), callback_data=f"size:{component_index}:{i}")
        for i, s in enumerate(sizes)
    ]
    if buttons:
        kb.add(*buttons)
    kb.add(InlineKeyboardButton(text="❌ Скасувати", callback_data="order:cancel"))
    return kb

# ---------------- Cart helpers & footer button ----------------
def format_price(v):
    try:
        return int(v) if v is not None else 0
    except:
        try:
            return int(float(v))
        except:
            return 0

async def add_item_to_cart(state: FSMContext, item: dict):
    """
    item = {
      'sku': '4165105s2',
      'name': 'Комплект ...',
      'size': 'M',
      'amount': 2,
      'price': 745,  # price per 1 (final_price)
      'drop_price': 560.0
    }
    """
    data = await state.get_data()
    cart = data.get("cart", [])
    # додаємо як нову позицію (не агрегація) — можна оновити логіку по ключу sku+size
    cart.append(item)
    await state.update_data(cart=cart)

async def get_cart_summary(state: FSMContext) -> (str, int):
    data = await state.get_data()
    cart = data.get("cart", [])
    if not cart:
        return "🛒 Кошик порожній.", 0
    lines = []
    total = 0
    for i, it in enumerate(cart, 1):
        name = it.get("name") or it.get("sku") or "Товар"
        size = it.get("size") or "-"
        amount = int(it.get("amount", 1))
        price = format_price(it.get("price"))
        subtotal = price * amount
        total += subtotal
        lines.append(f"{i}. {name} ({size}) — {price} грн × {amount} = {subtotal} грн")
    text = "🧾 Ваша корзина:\n\n" + "\n".join(lines) + f"\n\n🔢 Загальна сума: {total} грн"
    return text, total

def cart_footer_keyboard(total: int) -> InlineKeyboardMarkup:
    """
    Кнопка, що показується внизу (постійна) з загальною сумою.
    """
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"🛒 ТУТ ЗНАХОДИТЬСЯ ВАША КОРЗИНА! Загальна сума — {total} грн", callback_data="cart:open")],
    ])
    return kb

def cart_control_keyboard():
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Оформити замовлення", callback_data="cart:checkout")],
        [InlineKeyboardButton(text="❌ Повністю скасувати замовлення", callback_data="cart:clear")],
        [InlineKeyboardButton(text="↩️ Повернутись", callback_data="flow:back:article")],
    ])
    return kb

USER_CART_MSG = {}  # chat_id -> message_id

def build_cart_footer(chat_id: int, cart_items: List[Dict[str,Any]]):
    total = cart_total(cart_items)
    text = f"🛒 ТУТ ЗНАХОДИТЬСЯ ВАША КОРЗИНА! Загальна сума — {total} грн."
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"🧾 Відкрити корзину — {total} ₴", callback_data="cart:open")],
    ])
    return text, kb

async def update_or_send_cart_footer(chat_id: int, bot_instance=None):
    """
    Оновлює існуюче футер-повідомлення або надсилає нове.
    bot_instance: за замовчуванням використовує глобальний bot
    """
    bot_obj = bot_instance or bot
    cart_items = get_cart_items(chat_id)
    text, kb = build_cart_footer(chat_id, cart_items)
    if chat_id in USER_CART_MSG:
        msg_id = USER_CART_MSG[chat_id]
        try:
            await bot_obj.edit_message_text(text, chat_id, msg_id, reply_markup=kb)
            return
        except Exception:
            # якщо редагування не вдалось — видаляємо старий id і відправимо нове
            USER_CART_MSG.pop(chat_id, None)
    try:
        m = await bot_obj.send_message(chat_id, text, reply_markup=kb)
        USER_CART_MSG[chat_id] = getattr(m, "message_id", None)
    except Exception:
        logger.exception("Failed to send/update cart footer for chat %s", chat_id)

# ---------------- Cart storage & helpers ----------------
# chat_id -> list[ {name, sku, price, qty, sizes (dict)} ]
USER_CARTS: Dict[int, List[Dict[str, Any]]] = {}

def add_to_cart(chat_id: int, item: Dict[str, Any]) -> None:
    """Додає item до USER_CARTS[chat_id]. item must have keys: name, sku, price, qty, sizes"""
    USER_CARTS.setdefault(chat_id, []).append(item)

def clear_cart(chat_id: int) -> None:
    USER_CARTS.pop(chat_id, None)
    # також видалимо запис про footer, якщо є
    USER_CART_MSG.pop(chat_id, None)

def get_cart_items(chat_id: int) -> List[Dict[str, Any]]:
    return USER_CARTS.get(chat_id, [])

def cart_total(cart_items: List[Dict[str, Any]]) -> int:
    total = 0
    for it in cart_items:
        price = it.get("price") or 0
        qty = int(it.get("qty") or 1)
        try:
            total += int(price) * qty
        except Exception:
            try:
                total += int(float(price)) * qty
            except:
                pass
    return total

def format_cart_contents(cart_items: List[Dict[str, Any]]) -> str:
    if not cart_items:
        return "🛒 Ваша корзина порожня."
    lines = ["🧾 Вміст корзини:"]
    for i, it in enumerate(cart_items, 1):
        sizes = it.get("sizes") or {}
        sizes_txt = ", ".join([f"{k}:{v}" for k, v in sizes.items()]) if sizes else "—"
        price = it.get("price") or "—"
        qty = it.get("qty") or 1
        subtotal = (int(price) if isinstance(price, (int, float, str)) and str(price).isdigit() else price)
        lines.append(f"{i}. {it.get('name','Товар')} ({sizes_txt}) — {price} грн × {qty} = {int(price)*int(qty) if isinstance(price,(int,float)) or str(price).isdigit() else '—'}")
    total = cart_total(cart_items)
    lines.append(f"\n💰 Загальна сума: {total} грн.")
    lines.append("\nДля повного скасування натисніть: ❌ Повністю скасувати замовлення")
    return "\n".join(lines)

# ---------------- Routers / Handlers ----------------
# замініть існуючий @router.message(CommandStart(deep_link=True)) handler на цей
@router.message(CommandStart())
async def cmd_start(msg: Message, state: FSMContext, command: CommandStart):
    """
    Підтримує як звичайний /start, так і deep link виду:
      /start order_<mode>_<post_id>
    """
    args = command.args or ""
    # якщо є deep link виду order_<mode>_<post_id>
    if args.startswith("order_"):
        parts = args.split("_")
        if len(parts) == 3:
            mode, post_id = parts[1], parts[2]
            await state.update_data(post_message_id=post_id, mode=mode)
            await msg.answer("🧾 Розпочнемо оформлення. Введіть ваші ПІБ:")
            await state.set_state(OrderForm.pib)
            return

    # стандартна відповідь на /start без аргументів
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
    kb = get_order_keyboard(post_id=12345, test=True)
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
    await msg.answer("⏳ Оновлюю кеш вигрузки...")
    text = await load_products_export(force=True)
    if text:
        await msg.answer("✅ Кеш оновлено успішно.")
    else:
        await msg.answer("⚠️ Помилка при оновленні кешу. Перевір логи.")

# --- FSM: отримання ПІБ ---
@router.message(OrderForm.pib)
async def state_pib(msg: Message, state: FSMContext):
    text = (msg.text or "").strip()
    # Якщо користувач відповідає "так" — можлива автоматична підтверджена перестановка
    if text.lower() == "так":
        data = await state.get_data()
        suggested = data.get("pib_suggestion")
        if suggested:
            # приймаємо запропоновану перестановку
            await state.update_data(pib=suggested)
            await state.remove_data("pib_suggestion")
            await msg.answer(f"✅ ПІБ прийнято: {suggested}")
            await msg.answer("Введіть телефон (у форматі +380XXXXXXXXX, 380XXXXXXXXX або 0XXXXXXXXX):")
            await state.set_state(OrderForm.phone)
            return
        else:
            await msg.answer("Нема збереженої пропозиції для підтвердження. Будь ласка, введіть ПІБ у форматі: Прізвище Ім'я По-батькові.")
            return

    parts = text.split()
    if len(parts) != 3:
        await msg.answer("❌ Введіть повністю ваше ПІБ у форматі: Прізвище Ім'я По-батькові (3 слова).")
        return

    # перевіряємо, чи всі частини написані кирилицею / містять принаймні 2 символи
    if not all(is_cyrillic_word(p) for p in parts):
        await msg.answer("❌ Кожна частина ПІБ має бути українськими літерами (дозволені дефіси та апостроф). Спробуйте ще раз.")
        return

    # якщо третя частина має суфікс по-батькові — приймаємо
    if looks_like_patronymic(parts[2]):
        # приймаємо як валідний ПІБ
        normalized = " ".join([p.strip().title() for p in parts])
        await state.update_data(pib=normalized)
        await msg.answer("Введіть телефон (у форматі +380XXXXXXXXX, 380XXXXXXXXX або 0XXXXXXXXX):")
        await state.set_state(OrderForm.phone)
        return

    # якщо третя НЕ виглядає як по-батькові, спробуємо запропонувати перестановку, якщо є ознаки по-батькові в іншому місці
    suggested = suggest_reorder_pib(parts)
    if suggested:
        # збережемо пропозицію в state та запропонуємо підтвердження
        await state.update_data(pib_suggestion=suggested)
        await msg.answer(
            f"⚠️ Схоже, по-батькове не на третьому місці.\n"
            f"Ви ввели: <b>{text}</b>\n"
            f"Можливо ви мали на увазі: <b>{suggested}</b>\n"
            "Якщо це вірно — напишіть «так», і я збережу ПІБ. Інакше введіть ПІБ у форматі Прізвище Ім'я По-батькові."
        )
        return

    # якщо не змогли нічого запропонувати — попросимо переформулювати
    await msg.answer(
        "❌ Третя частина не схожа на по-батькові. Будь ласка, введіть ПІБ у форматі: Прізвище Ім'я По-батькові.\n"
        "Приклад: Петренко Іван Олександрович"
    )
    return

# --- Телефон (validated) ---
# Мобільні та стаціонарні коди — можна доповнювати в разі потреби
VALID_MOBILE_CODES = {
    "67", "68", "96", "97", "98",
    "50", "66", "95", "99", "75",
    "63", "73", "93",
    "91", "92", "94",
}

VALID_LANDLINE_CODES = {
    "44","32","48","56","57","61","43","41","38","55","54","35","31","47","37","46",
    "372","322","342","352","362","412","432","512","522","532","562","572","642","652",
    "0312","0372","0342","0622"
}

@router.message(OrderForm.phone)
async def state_phone(msg: Message, state: FSMContext):
    phone = msg.text.strip()
    digits = None

    if m := re.fullmatch(r"^\+380(\d{9})$", phone):
        digits = m.group(1)
    elif m := re.fullmatch(r"^380(\d{9})$", phone):
        digits = m.group(1)
    elif m := re.fullmatch(r"^0(\d{9})$", phone):
        digits = m.group(1)

    if not digits:
        await msg.answer("❌ Телефон має бути у форматі:\n+380XXXXXXXXX, 380XXXXXXXXX або 0XXXXXXXXX.")
        return

    operator_code = digits[:2]
    land2 = digits[:2]
    land3 = digits[:3]
    land4 = digits[:4]

    if operator_code in VALID_MOBILE_CODES or land2 in VALID_LANDLINE_CODES or land3 in VALID_LANDLINE_CODES or land4 in VALID_LANDLINE_CODES:
        normalized_phone = f"+380{digits}"
        await state.update_data(phone=normalized_phone)
        await msg.answer("Введіть артикул або назву товару:")
        await state.set_state(OrderForm.article)
        return

    await msg.answer(f"❌ Невідомий код оператора/міста ({digits[:4]}...). Введіть дійсний український номер.")
    return

async def load_products_export(force: bool = False) -> Optional[str]:
    """
    Завантажує вигрузку з MYDROP_EXPORT_URL (YML/JSON) з кешем.
    Додатково: після успішного завантаження будує базовий індекс для швидкого пошуку.
    """
    global PRODUCTS_CACHE, PRODUCTS_INDEX
    now = datetime.now()

    # Використати кеш, якщо він свіжий
    if not force and PRODUCTS_CACHE["last_update"] and (now - PRODUCTS_CACHE["last_update"]).seconds < CACHE_TTL:
        # перевіримо чи індекс свіжий
        if PRODUCTS_INDEX["built_at"] and (now - PRODUCTS_INDEX["built_at"]).seconds < INDEX_TTL:
            return PRODUCTS_CACHE["data"]
        # інакше побудуємо індекс поверх існуючого кешу
        text_existing = PRODUCTS_CACHE["data"]
        if text_existing:
            try:
                build_products_index(text_existing)
            except Exception:
                logger.exception("Index build failed from cache (non-fatal)")
            return text_existing

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

                # побудуємо індекс (синхронно тут; швидка побудова)
                try:
                    build_products_index(text)
                except Exception:
                    logger.exception("Index build failed (non-fatal)")

                return text
    except Exception as e:
        logger.exception("Помилка завантаження вигрузки: %s", e)

        # fallback — беремо з кеш-файлу
        cache_file = Path(ORDERS_DIR) / "products_cache.xml"
        if cache_file.exists():
            text = cache_file.read_text(encoding="utf-8")
            # спробуємо побудувати індекс з файлу
            try:
                build_products_index(text)
            except Exception:
                logger.exception("Index build from cache file failed")
            return text

        return None

def _normalize_text(s: Optional[str]) -> str:
    return (s or "").strip().lower()

def build_products_index(xml_text: str):
    """
    Проходимо по фіду один раз і будуємо простий індекс:
      - exact SKU -> product summary
      - offer_id -> product summary
      - list of (lower_name, product_summary) для швидких substring suggestions
    """
    global PRODUCTS_INDEX
    if not xml_text:
        return
    try:
        by_sku = {}
        by_offer = {}
        names = []

        it = ET.iterparse(io.StringIO(xml_text), events=("end",))
        for event, elem in it:
            tag = _local_tag(elem.tag).lower()
            if not (tag.endswith("offer") or tag.endswith("item") or tag.endswith("product")):
                elem.clear()
                continue

            offer_id = (elem.attrib.get("id") or "").strip()

            # спробуємо отримати sku через різні теги/атрибути
            sku = None
            # 1) атрибут vendorCode / id already handled as offer_id
            # 2) елементи всередині: vendorCode, sku, articul, article, code
            for t in ("vendorCode", "vendorcode", "sku", "articul", "article", "code"):
                try:
                    val = elem.findtext(t)
                    if val and val.strip():
                        sku = val.strip()
                        break
                except Exception:
                    continue

            # name / title
            name = (elem.findtext("name") or elem.findtext("title") or "").strip()

            # drop_price грубо
            drop_price = None
            for ptag in ("drop_price", "drop", "price", "price_uah", "priceuah"):
                try:
                    ptxt = (elem.findtext(ptag) or "")
                    if ptxt and ptxt.strip():
                        drop_price = float(ptxt.replace(",", "."))
                        break
                except:
                    continue

            # stock qty
            stock_qty = None
            qtxt = (elem.findtext("quantity_in_stock") or elem.findtext("quantity") or elem.findtext("stock") or "")
            if qtxt:
                m = re.search(r'\d+', qtxt.replace(" ", ""))
                if m:
                    try:
                        stock_qty = int(m.group(0))
                    except:
                        stock_qty = None

            # prepare summary
            summary = {
                "offer_id": offer_id,
                "sku": sku or "",
                "name": name or "",
                "drop_price": drop_price,
                "stock_qty": stock_qty,
            }

            if sku:
                by_sku[_normalize_text(sku)] = summary
            if offer_id:
                by_offer[_normalize_text(offer_id)] = summary
            if name:
                names.append((_normalize_text(name), summary))

            elem.clear()

        PRODUCTS_INDEX["by_sku"] = by_sku
        PRODUCTS_INDEX["by_offer"] = by_offer
        PRODUCTS_INDEX["names"] = names
        PRODUCTS_INDEX["built_at"] = datetime.now()
        logger.info("✅ Built products index (items: sku=%d, offers=%d, names=%d)", len(by_sku), len(by_offer), len(names))
    except Exception:
        logger.exception("Failed to build_products_index")

# ---------------- ПІБ: валідація / евристика ----------------
PATRONYMIC_SUFFIXES = [
    "ович", "евич", "овна", "івна", "ївна", "овна", "ич", "івич", "ійович", "овський", "овська"
    # додайте інші, якщо потрібно
]

def is_cyrillic_word(word: str) -> bool:
    """Проста перевірка: слово складається з кириличних літер, дефісів або апострофа, мінімум 2 символи."""
    if not word or len(word.strip()) < 2:
        return False
    return bool(re.fullmatch(r"[А-ЯҐЄІЇа-яґєії'\-]+", word.strip()))

def looks_like_patronymic(word: str) -> bool:
    """Чи слово виглядає як по-батькові (за суфіксом)"""
    if not word:
        return False
    w = word.lower()
    for suf in PATRONYMIC_SUFFIXES:
        if w.endswith(suf):
            return True
    return False

def suggest_reorder_pib(parts: List[str]) -> Optional[str]:
    """
    Якщо хочемо запропонувати перестановку для формату Прізвище Ім'я По-батькові:
    застосуємо просту евристику — знайдемо частину, яка виглядає як по-батькові,
    і переставимо її в кінець; якщо нічого не виявлено — повернемо None.
    """
    # знаходимо індекс частини, схожої на по-батькові
    patron_idx = None
    for i, p in enumerate(parts):
        if looks_like_patronymic(p):
            patron_idx = i
            break
    if patron_idx is None:
        return None

    # якщо по-батькові вже на третьому місці — нічого не міняємо
    if patron_idx == 2:
        return None

    # формуємо пропозицію: помістити patronymic на третє місце
    if patron_idx == 1:
        # припускаємо, що порядок Name Patronymic Surname => запропонуємо Surname Name Patronymic
        suggested = [parts[2], parts[0], parts[1]]
    elif patron_idx == 0:
        # Patronymic Surname Name => запропонуємо Surname Name Patronymic
        suggested = [parts[1], parts[2], parts[0]]
    else:
        return None

    # перевіримо чи всі частини результату виглядають прийнятно
    if all(is_cyrillic_word(x) for x in suggested):
        return " ".join(suggested)
    return None

# --- Артикул або назва ---
import io
import re
from html import unescape
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

# ---------------- improved check_article_or_name ----------------
def _local_tag(tag: str) -> str:
    """Повертає локальне ім'я тега без namespace."""
    if not tag:
        return ""
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag

def local(tag: str) -> str:
    return _local_tag(tag)

def _find_first_numeric_text(elem, candidates):
    """Шукає перший під-елемент з тегом в candidates, який може бути числом (float)."""
    for child in elem.iter():
        name = _local_tag(child.tag).lower()
        if any(c in name for c in candidates):
            txt = (child.text or "").strip()
            try:
                if txt:
                    return float(txt)
            except Exception:
                # спробуємо витягти цифри в тексті, наприклад "1 234.56" або "1234,56"
                t = txt.replace(" ", "").replace(",", ".")
                try:
                    return float(t)
                except Exception:
                    continue
    return None

def _find_first_text(elem, candidates):
    """Шукає перший під-елемент з тегом в candidates та повертає його текст."""
    for child in elem.iter():
        name = _local_tag(child.tag).lower()
        if any(name == c for c in candidates) or any(c in name for c in candidates):
            txt = (child.text or "").strip()
            if txt:
                return txt
    return None

def parse_components_from_description(desc: str):
    """
    Простий парсер, що витягує компоненти/опції з description.
    Повертає список компонентів у форматі: [{"name": "Розмір", "options": ["S","M","L"]}, ...]
    """
    if not desc:
        return None
    out = []
    # знаходимо патерни типу "Розмір: S, M, L" або "Size: 55-57, 58-60"
    lines = re.split(r'[\n\r]+', desc)
    for line in lines:
        if ':' not in line:
            continue
        left, right = line.split(':', 1)
        key = left.strip()
        vals = re.split(r'[;,/\\\|\s]+', right.strip())
        opts = []
        for v in vals:
            vv = v.strip()
            if not vv:
                continue
            # приймаємо буквені і цифрові розміри
            if re.match(r'^[XSMLxlm0-9\-]+$', vv):
                opts.append(vv)
        if opts:
            out.append({"name": key, "options": sorted(set(opts), key=lambda x: x)})
    return out if out else None

async def check_article_or_name(query: str) -> Optional[Dict[str, Any]]:
    """
    Robust parser: спочатку пробуємо index (швидко), якщо не знайшли — fallback до повного iterparse.
    Повертає product summary або None.
    """
    q = str(query or "").strip()
    if not q:
        return None
    qlow = q.lower()

    # ensure feed loaded (lazy)
    text = PRODUCTS_CACHE.get("data")
    if not text:
        text = await load_products_export()
    if not text:
        return None

    # 1) Exact matches via index (very fast)
    if PRODUCTS_INDEX.get("built_at"):
        # offer id
        p = PRODUCTS_INDEX["by_offer"].get(qlow)
        if p:
            p2 = dict(p)
            p2.update({"final_price": apply_markup(p.get("drop_price")) if p.get("drop_price") else None, "suggestion": False})
            return p2
        # sku
        p = PRODUCTS_INDEX["by_sku"].get(qlow)
        if p:
            p2 = dict(p)
            p2.update({"final_price": apply_markup(p.get("drop_price")) if p.get("drop_price") else None, "suggestion": False})
            return p2
        # exact name
        for name_lower, summary in PRODUCTS_INDEX["names"]:
            if qlow == name_lower:
                p2 = dict(summary)
                p2.update({"final_price": apply_markup(summary.get("drop_price")) if summary.get("drop_price") else None, "suggestion": False})
                return p2
        # substring suggestions (first match)
        if len(qlow) >= 3:
            for name_lower, summary in PRODUCTS_INDEX["names"]:
                if qlow in name_lower:
                    p2 = dict(summary)
                    p2.update({"final_price": apply_markup(summary.get("drop_price")) if summary.get("drop_price") else None, "suggestion": True})
                    return p2

    # 2) Fallback: detailed iterparse (full logic)
    try:
        it = ET.iterparse(io.StringIO(text), events=("end",))
        for event, elem in it:
            tag = _local_tag(elem.tag).lower()
            if not (tag.endswith("offer") or tag.endswith("item") or tag.endswith("product")):
                elem.clear()
                continue

            offer_id = (elem.attrib.get("id") or "").strip()
            vendor_code = _find_first_text(elem, ["vendorcode", "vendor_code", "vendor", "sku", "articul", "article", "code"])
            if vendor_code and vendor_code.strip() in ("", "-", "null", "none"):
                vendor_code = None
            name = _find_first_text(elem, ["name", "title", "product", "model", "productname", "product_name"])
            # numeric extraction helpers
            def find_num(cands):
                for child in elem.iter():
                    name_tag = _local_tag(child.tag).lower()
                    if any(c in name_tag for c in cands):
                        txt = (child.text or "").strip()
                        if not txt:
                            continue
                        try:
                            return float(txt)
                        except:
                            t = txt.replace(" ", "").replace(",", ".")
                            try:
                                return float(t)
                            except:
                                continue
                return None

            drop_price = find_num(["price", "cost", "drop", "drop_price", "sellprice", "amount", "value", "price_uah", "priceuah"])
            retail_price = find_num(["rrc", "retail", "oldprice", "retail_price", "msrp", "price_rrc"])

            # stock qty detection
            stock_qty = None
            qtxt = _find_first_text(elem, ["quantity_in_stock", "quantity", "stock_qty", "stock", "available_quantity", "count", "amount"])
            if qtxt:
                qd = re.findall(r'\d+', qtxt.replace(" ", ""))
                if qd:
                    try:
                        stock_qty = int(qd[0])
                    except:
                        stock_qty = None

            stock_attr = elem.attrib.get("available", "").lower() if isinstance(elem.attrib, dict) else ""
            stock_text = None
            if stock_qty is not None:
                stock_text = f"Є ({stock_qty} шт.)"
            elif stock_attr:
                stock_text = "Є" if stock_attr in ("true", "1", "yes") else "Немає"
            else:
                av = _find_first_text(elem, ["available", "in_stock", "stock", "наличие"])
                stock_text = av or "Немає"

            # components parsing (as before)
            sizes_from_param = []
            components_from_params = []
            for p in elem.iter():
                pt = _local_tag(p.tag).lower()
                if "param" in pt or pt in ("attribute", "property", "option"):
                    pname_raw = p.attrib.get("name", "") if isinstance(p.attrib, dict) else ""
                    pname = (pname_raw or "").strip() or _local_tag(p.tag)
                    ptext = (p.text or "").strip()
                    opts = []
                    opts += re.findall(r'\b\d{2,3}-\d{2,3}\b', ptext)
                    opts += re.findall(r'\b(?:XS|S|M|L|XL|XXL|XXXL)\b', ptext, flags=re.I)
                    opts += re.findall(r'\b\d{2}\b', ptext)
                    if re.search(r'універсал', ptext, flags=re.I):
                        opts.append('універсальний')
                    if not opts and re.search(r'\b(шт\.?|шт|так|є|available|есть)\b', ptext, flags=re.I):
                        opts = ['шт.']
                    if opts:
                        seen = set()
                        final = []
                        for o in opts:
                            o2 = str(o).strip()
                            if not o2:
                                continue
                            if o2.lower() in seen:
                                continue
                            seen.add(o2.lower())
                            final.append(o2)
                        components_from_params.append({"name": pname, "options": final})
                    elif pname:
                        components_from_params.append({"name": pname, "options": []})
                if "size" in pt or "размер" in pt or "розмір" in pt:
                    if (p.text or "").strip():
                        parts = re.split(r'[;,/\\\n]+', p.text or "")
                        for part in parts:
                            v = part.strip()
                            if v:
                                sizes_from_param.append(v)

            desc_text = _find_first_text(elem, ["description", "desc"]) or ""
            components_from_desc = None
            try:
                components_from_desc = parse_components_from_description(desc_text)
            except Exception:
                components_from_desc = None

            if components_from_desc:
                components = components_from_desc
            elif components_from_params:
                components = components_from_params
            elif sizes_from_param:
                components = [{"name": "Розмір", "options": sizes_from_param}]
            else:
                components = None

            sku = (vendor_code or offer_id or "").strip()
            if sku in ("", "-"):
                sku = offer_id

            product = {
                "name": name or offer_id or vendor_code or "",
                "sku": sku,
                "drop_price": float(drop_price) if drop_price is not None else None,
                "retail_price": float(retail_price) if retail_price is not None else None,
                "final_price": apply_markup(drop_price) if drop_price is not None else None,
                "stock": stock_text or "Немає",
                "stock_qty": stock_qty,
                "stock_text": stock_text or "Немає",
                "sizes": sizes_from_param or None,
                "components": components
            }

            # matching logic (exact id, sku, exact name, substring)
            if offer_id and qlow == offer_id.lower():
                elem.clear()
                return product
            if product.get("sku") and qlow == product["sku"].lower():
                elem.clear()
                return product
            if name and qlow == name.lower():
                elem.clear()
                return product
            if name and qlow in name.lower() and len(qlow) >= 3:
                product["suggestion"] = True
                elem.clear()
                return product

            elem.clear()
    except Exception:
        logger.exception("XML parse error in check_article_or_name (fallback)")
    return None

# ---------------- Helpers: component size search ----------------
COMPONENT_KEYWORDS = ["шап", "шапка", "рукав", "рукави", "рукавиц", "рукавич", "баф", "балаклав", "комплект"]

# ЗАМІНІТЬ СТАРУ РЕАЛІЗАЦІЮ find_component_sizes НА ЦЮ:
async def find_component_sizes(product_name: str) -> Dict[str, List[str]]:
    """
    Повертає мапу компонент->list_of_sizes.
    Якщо кеш фіда порожній — автопідвантажуємо.
    Робимо помірковано: namespace-стійкий парсер через iterparse.
    """
    # автопідвантажити фід, якщо порожній
    if not PRODUCTS_CACHE.get("data"):
        await load_products_export(force=False)

    text = PRODUCTS_CACHE.get("data")
    res: Dict[str, List[str]] = {}
    if not text:
        return res

    name_lower = (product_name or "").lower()

    # які компоненти шукаємо — за ключовими словами в назві продукту
    to_search = [kw for kw in COMPONENT_KEYWORDS if kw in name_lower]
    if not to_search:
        to_search = COMPONENT_KEYWORDS.copy()

    try:
        it = ET.iterparse(io.StringIO(text), events=("end",))
        for event, elem in it:
            tag = _local_tag(elem.tag).lower()
            if not (tag.endswith("offer") or tag.endswith("item") or tag.endswith("product")):
                elem.clear()
                continue

            prod_name = (_find_first_text(elem, ["name", "title"]) or "").strip().lower()
            if not prod_name:
                elem.clear()
                continue

            # чи підпадає продукт під наші ключі?
            matched_components = [kw for kw in to_search if kw in prod_name]
            if not matched_components:
                elem.clear()
                continue

            sizes = set()
            for p in elem.iter():
                pt = _local_tag(p.tag).lower()
                # param-like tags
                if "param" in pt or pt in ("attribute", "property", "option"):
                    pname = (p.attrib.get("name") or "").lower() if isinstance(p.attrib, dict) else ""
                    ptext = (p.text or "").strip()
                    if not ptext:
                        continue
                    # якщо ім'я параметру натякає на розмір — беремо всі сегменти
                    if any(x in pname for x in ("size", "размер", "розмір", "разм")) or pname.strip() in ("размер", "size", "розмір"):
                        for seg in re.split(r'[;,/\\\s]+', ptext):
                            if seg:
                                sizes.add(seg.strip())
                        continue
                    # шукаємо формати "44-46", буквені розміри, двозначні числа
                    for r in re.findall(r'\b\d{2,3}-\d{2,3}\b', ptext):
                        sizes.add(r)
                    for r in re.findall(r'\b(?:XS|S|M|L|XL|XXL|XXXL)\b', ptext, flags=re.I):
                        sizes.add(r.upper())

            # fallback: шукати розміри у назві продукту
            if not sizes:
                for r in re.findall(r"\b\d{2,3}-\d{2,3}\b", prod_name):
                    sizes.add(r)
                for l in re.findall(r"\b([XSML]{1,3})\b", prod_name.upper()):
                    sizes.add(l)

            if sizes:
                for comp in matched_components:
                    res.setdefault(comp, []).extend(list(sizes))

            elem.clear()

        # унікалізуємо і сортуємо опції
        for k, v in list(res.items()):
            uniq = sorted(set(x.strip() for x in v if x and x.strip()))
            if uniq:
                res[k] = uniq
            else:
                res.pop(k, None)

    except Exception:
        logger.exception("Error while scanning product feed for component sizes")

    return res

# ---------------- Helpers: size buttons + handlers (replace state_article + cb_size) ----------------
def build_size_keyboard(component_index: int, sizes: List[str]) -> InlineKeyboardMarkup:
    """
    Повертає InlineKeyboardMarkup з кнопками розмірів.
    callback_data: "size:<component_index>:<size_index>"
    """
    kb = InlineKeyboardMarkup(row_width=3)
    buttons = [
        InlineKeyboardButton(text=str(s), callback_data=f"size:{component_index}:{i}")
        for i, s in enumerate(sizes)
    ]
    if buttons:
        kb.add(*buttons)
    # кнопка скасування, посилає callback який вже обробляється у order:cancel
    kb.add(InlineKeyboardButton(text="❌ Скасувати замовлення", callback_data="order:cancel"))
    return kb

# --- FSM: отримання артикулу або назви (updated: support component size selection) ---
@router.message(Command("debug_find"))
async def cmd_debug_find(msg: Message):
    if msg.from_user.id != ADMIN_ID:
        await msg.answer("⚠️ Тільки адміністратору.")
        return
    parts = (msg.text or "").split(maxsplit=1)
    if len(parts) < 2:
        await msg.answer("Використання: /debug_find <query>")
        return
    q = parts[1].strip()
    text = await load_products_export(force=True)
    if not text:
        await msg.answer("⚠️ Фід пустий.")
        return

    found = []
    try:
        # використовуємо і ту ж logiку: iterparse і збір мінімального summary
        it = ET.iterparse(io.StringIO(text), events=("end",))
        qlow = q.lower()
        for event, elem in it:
            tag = _local_tag(elem.tag).lower()
            if not (tag.endswith("offer") or tag.endswith("item") or tag.endswith("product")):
                continue

            offer_id = (elem.attrib.get("id") or "").strip()
            vendor_code = _find_first_text(elem, ["vendorcode", "vendor_code", "sku", "articul", "article", "code"]) or ""
            name = _find_first_text(elem, ["name", "title", "product", "model"]) or ""
            desc = _find_first_text(elem, ["description", "desc"]) or ""
            searchable = " ".join([offer_id.lower(), vendor_code.lower(), name.lower(), desc.lower()])
            if qlow in searchable:
                child_map = []
                for c in list(elem):
                    ln = _local_tag(c.tag)
                    txt = (c.text or "").strip()
                    child_map.append(f"{ln}={txt[:120]}")
                summary = f"id={offer_id} | sku={vendor_code or '-'} | name={name or '-'}"
                found.append(summary + "\n" + "; ".join(child_map))
                if len(found) >= 10:
                    elem.clear()
                    break
            elem.clear()
    except Exception:
        logger.exception("debug_find failed")
    if not found:
        await msg.answer("No matches")
    else:
        await msg.answer("Matches:\n\n" + "\n\n".join(found))

@router.message(OrderForm.article)
async def state_article(msg: Message, state: FSMContext):
    query = (msg.text or "").strip()
    # якщо user написав 'так' — це означає підтвердження останньої suggestion (назви)
    if query.lower() == "так":
        data = await state.get_data()
        last_suggestion = data.get("last_suggestion")
        if last_suggestion:
            product = last_suggestion
        else:
            await msg.answer("Нема запропонованого товару для підтвердження — введіть артикул або назву.")
            return
    else:
        # звичайний шлях: викликаємо check_article_or_name (один раз)
        product = await check_article_or_name(query)
        if product and product.get("suggestion"):
            # збережемо останню підказку в state, щоб юзер міг підтвердити "так"
            await state.update_data(last_suggestion=product)

    await msg.chat.do("typing")

    if not product:
        await msg.answer("❌ Не знайдено товар. Спробуйте ще раз (артикул або частина назви) або напишіть 'підтримка'.")
        return

    stock_text = product.get("stock_text", product.get("stock", "Немає"))

    # --- заміна suggestion повідомлення на варіант з кнопками ---
    if product.get("suggestion"):
        sizes_text = f"\n📏 Розміри: {', '.join(product.get('sizes') or [])}" if product.get("sizes") else ""
        sku_line = product.get("sku") or "—"
        # зберігаємо останню suggestion у state (щоб confirm callback міг її взяти)
        await state.update_data(last_suggestion=product)

        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="✅ Підтвердити", callback_data="suggest:confirm")],
            [InlineKeyboardButton(text="🔍 Ввести артикул/назву", callback_data="nav:enter_article")],
            [InlineKeyboardButton(text="↩️ Назад", callback_data="nav:back_to_article")],
        ])

        await msg.answer(
            f"🤔 Можливо ви мали на увазі:\n"
            f"🔖 <b>{product.get('name')}</b>\n"
            f"🆔 Артикул: <b>{sku_line}</b>\n"
            f"📦 Наявність: <b>{stock_text}</b>\n"
            f"💰 Орієнтовна ціна (з націнкою): {product.get('final_price') or '—'} грн\n"
            f"💵 Дроп ціна: {product.get('drop_price') or '—'} грн"
            f"{sizes_text}\n\n",
            reply_markup=kb
        )
        return

    # Якщо точний збіг — зберігаємо базові дані
    # Зберігаємо components як є (щоб callback handlers бачили ту ж структуру)
    await state.update_data(
        article=product.get("sku"),
        product_name=product.get("name"),
        stock=product.get("stock"),
        stock_qty=product.get("stock_qty"),
        price=product.get("final_price"),
        components=product.get("components") or []
    )

    # Якщо є компоненти => починаємо послідовно питати розміри через inline-кнопки
    components = product.get("components") or []
    if components:
        await state.update_data(selected_sizes={})
        comp0 = components[0]
        opts = comp0.get("options") or []
        if not opts:
            # якщо немає опцій, одразу просимо кількість
            await msg.answer(
                f"✅ Знайдено товар:\n"
                f"🔖 <b>{product.get('name')}</b>\n"
                f"🆔 Артикул: <b>{product.get('sku')}</b>\n"
                f"📦 Наявність: <b>{stock_text}</b>\n"
                f"💰 Ціна для клієнта: {product.get('final_price') or '—'} грн\n"
                f"💵 Дроп ціна: {product.get('drop_price') or '—'} грн\n\n"
                "👉 Введіть кількість товару (число):"
            )
            await state.set_state(OrderForm.amount)
            return

        # build inline keyboard for options (reuse build_size_keyboard)
        kb = build_size_keyboard(0, opts)
        await msg.answer(
            f"✅ Знайдено товар:\n"
            f"🔖 <b>{product.get('name')}</b>\n"
            f"🆔 Артикул: <b>{product.get('sku')}</b>\n"
            f"📦 Наявність: <b>{stock_text}</b>\n"
            f"💰 Ціна: {product.get('final_price') or '—'} грн\n\n"
            f"📏 Виберіть розмір для: <b>{comp0.get('name')}</b>",
            reply_markup=kb
        )
        await state.set_state(OrderForm.size)
        return

    # Якщо немає компонентів — як раніше запитуємо кількість
    sizes_text = f"\n📏 Розміри: {', '.join(product.get('sizes') or [])}" if product.get("sizes") else ""
    await msg.answer(
        f"✅ Знайдено товар:\n"
        f"🔖 <b>{product.get('name')}</b>\n"
        f"🆔 Артикул: <b>{product.get('sku')}</b>\n"
        f"📦 Наявність: <b>{stock_text}</b>\n"
        f"💰 Ціна для клієнта: {product.get('final_price') or '—'} грн\n"
        f"💵 Дроп ціна: {product.get('drop_price') or '—'} грн"
        f"{sizes_text}\n\n"
        "👉 Введіть кількість товару (число):",
    )
    await state.set_state(OrderForm.amount)

# --- Обробник вибору розміру через inline-кнопки (оновлений UX: Continue / Edit) ---
@router.callback_query(F.data == "sizes:continue")
async def cb_sizes_continue(cb: CallbackQuery, state: FSMContext):
    # користувач підтвердив розміри — просимо кількість
    await cb.answer()
    await cb.message.answer("👉 Введіть кількість товару (число):")
    await state.set_state(OrderForm.amount)

@router.callback_query(F.data.startswith("size:"))
async def cb_size_select(cb: CallbackQuery, state: FSMContext):
    """
    callback_data: size:{comp_index}:{opt_index}
    Зберігає вибір в state.selected_sizes, потім або питає наступний компонент,
    або показує підсумок і показує кнопки: ✅ Продовжити | ↩️ Змінити розміри | ❌ Скасувати
    """
    try:
        _, comp_idx_s, opt_idx_s = cb.data.split(":", 2)
        comp_idx = int(comp_idx_s)
        opt_idx = int(opt_idx_s)
    except Exception:
        await cb.answer("Невірні дані вибору (callback).")
        return

    data = await state.get_data()
    components = data.get("components") or []
    if comp_idx < 0 or comp_idx >= len(components):
        await cb.answer("Невірний компонент.")
        return

    comp = components[comp_idx]
    opts = comp.get("options") or []
    if opt_idx < 0 or opt_idx >= len(opts):
        await cb.answer("Невірний варіант розміру.")
        return

    chosen = opts[opt_idx]
    # зберігаємо
    selected = data.get("selected_sizes") or {}
    selected[comp['name']] = chosen
    await state.update_data(selected_sizes=selected)

    await cb.answer(f"Вибрано: {comp['name']} — {chosen}")

    # якщо є наступний компонент — питаємо його
    next_idx = comp_idx + 1
    if next_idx < len(components):
        next_comp = components[next_idx]
        next_opts = next_comp.get("options") or []
        if not next_opts:
            # пропускаємо компонент без опцій
            await state.update_data(selected_sizes=selected)
            # відправляємо повідомлення-повідомлення і пробуємо запитати наступний компонент
            await cb.message.answer(f"📏 Перехід до наступного компонента: <b>{next_comp['name']}</b>\n(опцій не знайдено — пропускаємо)")
            # тепер спробуємо показати наступний, якщо він має опції
            # знаходимо наступний з опціями
            found = False
            for j in range(next_idx + 1, len(components)):
                comp_j = components[j]
                opts_j = comp_j.get("options") or []
                if opts_j:
                    kb = build_size_keyboard(j, opts_j)
                    await cb.message.answer(f"📏 Виберіть розмір для: <b>{comp_j['name']}</b>", reply_markup=kb)
                    await state.set_state(OrderForm.size)
                    found = True
                    break
            if found:
                return
            # якщо не знайдено — будемо підсумовувати далі
        else:
            kb = build_size_keyboard(next_idx, next_opts)
            await cb.message.answer(f"📏 Виберіть розмір для: <b>{next_comp['name']}</b>", reply_markup=kb)
            await state.set_state(OrderForm.size)
            return

    # якщо це був останній компонент або інші не мають опцій — формуємо підсумок і показуємо кнопки
    selected = await state.get_data()
    selected_sizes = selected.get("selected_sizes") or {}
    if selected_sizes:
        summary = "; ".join([f"{k} — {v}" for k, v in selected_sizes.items()])
        text = f"✅ Ви вибрали: {summary}\n\nНатисніть «✅ Продовжити», щоб ввести кількість, або «↩️ Змінити розміри»."
    else:
        text = "✅ Розміри не обрані (відсутні опції).\n\nНатисніть «✅ Продовжити», щоб ввести кількість."

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Продовжити", callback_data="sizes:continue")],
        [InlineKeyboardButton(text="↩️ Змінити розміри", callback_data="sizes:edit")],
        [InlineKeyboardButton(text="❌ Скасувати замовлення", callback_data="order:cancel")],
    ])
    await cb.message.answer(text, reply_markup=kb)
    # залишаємо стан OrderForm.size до натискання 'continue'
    await state.set_state(OrderForm.size)

# --- Редагувати вибір розмірів (повторити послідовність) ---
@router.callback_query(F.data == "sizes:edit")
async def cb_sizes_edit(cb: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    components = data.get("components") or []
    if not components:
        await cb.answer("Немає компонентів для редагування.")
        return

    # Очистимо попередні вибрані розміри
    await state.update_data(selected_sizes={})
    # Показуємо перший компонент (index 0)
    first = components[0]
    opts = first.get("options") or []
    if not opts:
        # якщо немає опцій — пропускаємо до наступного, знайдемо перший з опціями
        found = False
        for j, comp in enumerate(components):
            opts_j = comp.get("options") or []
            if opts_j:
                kb = build_size_keyboard(j, opts_j)
                await cb.message.answer(f"📏 Виберіть розмір для: <b>{comp['name']}</b>", reply_markup=kb)
                found = True
                break
        if not found:
            await cb.answer("Опцій розмірів не знайдено.")
            return
        await state.set_state(OrderForm.size)
        return

    kb = build_size_keyboard(0, opts)
    await cb.message.answer(f"📏 Виберіть розмір для: <b>{first['name']}</b>", reply_markup=kb)
    await state.set_state(OrderForm.size)
    await cb.answer("Почніть заново вибір розмірів.")

# --- Confirm suggestion callback ---
@router.callback_query(F.data == "product:confirm")
async def cb_product_confirm(cb: CallbackQuery, state: FSMContext):
    """
    Підтвердження того, що suggestion — і починаємо стандартний flow як при точному збігу.
    Беремо product з last_suggestion у state.
    """
    data = await state.get_data()
    product = data.get("last_suggestion")
    if not product:
        await cb.answer("Нема запропонованого товару для підтвердження.")
        return

    # Позитив: зберігаємо у state як вибраний товар
    await state.update_data(
        article=product.get("sku"),
        product_name=product.get("name"),
        stock=product.get("stock"),
        stock_qty=product.get("stock_qty"),
        price=product.get("final_price"),
        components=product.get("components") or []
    )

    # Видаляємо last_suggestion (необов'язково)
    await state.remove_data("last_suggestion")

    # Починаємо flow: якщо є components => size selection, інакше - quantity
    components = product.get("components") or []
    stock_text = product.get("stock_text") or product.get("stock") or "Немає"

    if components:
        await state.update_data(selected_sizes={})
        comp0 = components[0]
        opts = comp0.get("options") or []
        if not opts:
            await cb.message.answer(
                f"✅ Підтверджено товар:\n"
                f"🔖 <b>{product.get('name')}</b>\n"
                f"🆔 Артикул: <b>{product.get('sku')}</b>\n"
                f"📦 Наявність: <b>{stock_text}</b>\n\n"
                "👉 Введіть кількість товару (число):"
            )
            await state.set_state(OrderForm.amount)
            await cb.answer()
            return
        kb = build_size_keyboard(0, opts)
        await cb.message.answer(
            f"✅ Підтверджено товар:\n"
            f"🔖 <b>{product.get('name')}</b>\n"
            f"🆔 Артикул: <b>{product.get('sku')}</b>\n"
            f"📦 Наявність: <b>{stock_text}</b>\n\n"
            f"📏 Виберіть розмір для: <b>{comp0.get('name')}</b>",
            reply_markup=kb
        )
        await state.set_state(OrderForm.size)
        await cb.answer()
        return

    # якщо немає компонентів
    await cb.message.answer(
        f"✅ Підтверджено товар:\n"
        f"🔖 <b>{product.get('name')}</b>\n"
        f"🆔 Артикул: <b>{product.get('sku')}</b>\n"
        f"📦 Наявність: <b>{stock_text}</b>\n"
        f"💰 Ціна для клієнта: {product.get('final_price') or '—'} грн\n"
        f"💵 Дроп ціна: {product.get('drop_price') or '—'} грн\n\n"
        "👉 Введіть кількість товару (число):"
    )
    await state.set_state(OrderForm.amount)
    await cb.answer()

# --- manual search (перевести користувача на введення артикулу/назви) ---
@router.callback_query(F.data == "flow:manual_search")
async def cb_manual_search(cb: CallbackQuery, state: FSMContext):
    await cb.message.answer("Введіть артикул або назву товару:")
    await state.set_state(OrderForm.article)
    await cb.answer()

# --- back navigation handler: callback_data = flow:back:<state_name> (e.g. flow:back:pib) ---
@router.callback_query(F.data.startswith("flow:back:"))
async def cb_flow_back(cb: CallbackQuery, state: FSMContext):
    # розбираємо куди повертатися
    try:
        _, _, to = cb.data.split(":", 2)
    except:
        await cb.answer("Невірна команда повернення.")
        return

    if to == "pib":
        await state.set_state(OrderForm.pib)
        await cb.message.answer("Повернулись. Введіть ваше ПІБ:")
    elif to == "phone":
        await state.set_state(OrderForm.phone)
        await cb.message.answer("Повернулись. Введіть телефон:")
    elif to == "article":
        await state.set_state(OrderForm.article)
        await cb.message.answer("Повернулись. Введіть артикул або назву товару:")
    elif to == "amount":
        await state.set_state(OrderForm.amount)
        await cb.message.answer("Повернулись. Введіть кількість товару:")
    else:
        await state.set_state(OrderForm.article)
        await cb.message.answer("Повернулись. Введіть артикул або назву товару:")
    await cb.answer()

# --- Confirm suggestion callback ---
@router.callback_query(F.data == "product:confirm")
async def cb_product_confirm(cb: CallbackQuery, state: FSMContext):
    """
    Підтвердження того, що suggestion — і починаємо стандартний flow як при точному збігу.
    Беремо product з last_suggestion у state.
    """
    data = await state.get_data()
    product = data.get("last_suggestion")
    if not product:
        await cb.answer("Нема запропонованого товару для підтвердження.")
        return

    # Позитив: зберігаємо у state як вибраний товар
    await state.update_data(
        article=product.get("sku"),
        product_name=product.get("name"),
        stock=product.get("stock"),
        stock_qty=product.get("stock_qty"),
        price=product.get("final_price"),
        components=product.get("components") or []
    )

    # Видаляємо last_suggestion (необов'язково)
    await state.remove_data("last_suggestion")

    # Починаємо flow: якщо є components => size selection, інакше - quantity
    components = product.get("components") or []
    stock_text = product.get("stock_text") or product.get("stock") or "Немає"

    if components:
        await state.update_data(selected_sizes={})
        comp0 = components[0]
        opts = comp0.get("options") or []
        if not opts:
            await cb.message.answer(
                f"✅ Підтверджено товар:\n"
                f"🔖 <b>{product.get('name')}</b>\n"
                f"🆔 Артикул: <b>{product.get('sku')}</b>\n"
                f"📦 Наявність: <b>{stock_text}</b>\n\n"
                "👉 Введіть кількість товару (число):"
            )
            await state.set_state(OrderForm.amount)
            await cb.answer()
            return
        kb = build_size_keyboard(0, opts)
        await cb.message.answer(
            f"✅ Підтверджено товар:\n"
            f"🔖 <b>{product.get('name')}</b>\n"
            f"🆔 Артикул: <b>{product.get('sku')}</b>\n"
            f"📦 Наявність: <b>{stock_text}</b>\n\n"
            f"📏 Виберіть розмір для: <b>{comp0.get('name')}</b>",
            reply_markup=kb
        )
        await state.set_state(OrderForm.size)
        await cb.answer()
        return

    # якщо немає компонентів
    await cb.message.answer(
        f"✅ Підтверджено товар:\n"
        f"🔖 <b>{product.get('name')}</b>\n"
        f"🆔 Артикул: <b>{product.get('sku')}</b>\n"
        f"📦 Наявність: <b>{stock_text}</b>\n"
        f"💰 Ціна для клієнта: {product.get('final_price') or '—'} грн\n"
        f"💵 Дроп ціна: {product.get('drop_price') or '—'} грн\n\n"
        "👉 Введіть кількість товару (число):"
    )
    await state.set_state(OrderForm.amount)
    await cb.answer()

# --- manual search (перевести користувача на введення артикулу/назви) ---
@router.callback_query(F.data == "flow:manual_search")
async def cb_manual_search(cb: CallbackQuery, state: FSMContext):
    await cb.message.answer("Введіть артикул або назву товару:")
    await state.set_state(OrderForm.article)
    await cb.answer()

# --- back navigation handler: callback_data = flow:back:<state_name> (e.g. flow:back:pib) ---
@router.callback_query(F.data.startswith("flow:back:"))
async def cb_flow_back(cb: CallbackQuery, state: FSMContext):
    # розбираємо куди повертатися
    try:
        _, _, to = cb.data.split(":", 2)
    except:
        await cb.answer("Невірна команда повернення.")
        return

    if to == "pib":
        await state.set_state(OrderForm.pib)
        await cb.message.answer("Повернулись. Введіть ваше ПІБ:")
    elif to == "phone":
        await state.set_state(OrderForm.phone)
        await cb.message.answer("Повернулись. Введіть телефон:")
    elif to == "article":
        await state.set_state(OrderForm.article)
        await cb.message.answer("Повернулись. Введіть артикул або назву товару:")
    elif to == "amount":
        await state.set_state(OrderForm.amount)
        await cb.message.answer("Повернулись. Введіть кількість товару:")
    else:
        await state.set_state(OrderForm.article)
        await cb.message.answer("Повернулись. Введіть артикул або назву товару:")
    await cb.answer()

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

    if max_stock is not None and qty > max_stock:
        await msg.answer(
            f"⚠️ Доступна кількість цього товару: <b>{max_stock} шт.</b>\n"
            f"Будь ласка, введіть іншу кількість:"
        )
        return

    # Збираємо item для корзини
    item = {
        "name": data.get("product_name") or data.get("article") or "Товар",
        "sku": data.get("article") or data.get("product_name") or "",
        "price": data.get("price") or data.get("final_price") or 0,
        "qty": qty,
        "sizes": data.get("selected_sizes") or {}
    }
    chat_id = msg.chat.id
    add_to_cart(chat_id, item)

        # оновлюємо/відправляємо футер корзини
    await update_or_send_cart_footer(chat_id, bot)

    # ПОВІДОМЛЕННЯ І КНОПКИ ДЛЯ ПРОДОВЖЕННЯ
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🧾 Вибрати товар на каналі", url=f"https://t.me/{BOT_USERNAME}?start=order_test_12345")],
        [InlineKeyboardButton(text="🔎 Ввести артикул/назву", callback_data="flow:back:article")],
        [InlineKeyboardButton(text="🚚 Обрати спосіб доставки / Перейти до оплати", callback_data="flow:to:delivery")]
    ])
    await msg.answer("✅ Товар додано до корзини.\nЩо бажаєте зробити далі?", reply_markup=kb)

    # Залишаємо у state лише інфо про користувача (pib, phone), видаляємо тимчасові product-поля
    keep = {k: v for k, v in (await state.get_data()).items() if k in ("pib", "phone", "mode")}
    await state.clear()
    await state.update_data(**keep)

    # чекаємо на подальший вибір користувача (якщо user натисне 'flow:to:delivery' чи 'flow:back:article' — потрібні обробники)

    # Показуємо футер-кнопку кошика з сумою
    cart_text, total = await get_cart_summary(state)
    await msg.answer(f"🛒 Ваша корзина: Загальна сума — {total} грн", reply_markup=cart_footer_keyboard(total))

    # переходимо до вибору доставки (юзер може натиснути кнопку "Оберіть спосіб доставки")
    await state.set_state(OrderForm.delivery)

# --- choose from channel / by name placeholders ---
@router.callback_query(F.data == "choose:from_channel")
async def cb_choose_from_channel(cb: CallbackQuery, state: FSMContext):
    # Тут можна направити користувача у репостований канал або пояснити, як вибрати
    await cb.message.answer("Щоб вибрати товар на каналі — відкрийте пост у каналі та натисніть кнопку «Замовити» під потрібним товаром. Якщо ви тут — можете обрати 'Вибрати товар по назві/артикулу'.")
    await cb.answer()

@router.callback_query(F.data == "choose:by_name")
async def cb_choose_by_name(cb: CallbackQuery, state: FSMContext):
    await cb.message.answer("Введіть назву або артикул товару для пошуку:")
    await state.set_state(OrderForm.article)
    await cb.answer()

# --- cart open / clear / checkout ---
@router.callback_query(F.data == "cart:open")
async def cb_cart_open(cb: CallbackQuery):
    chat_id = cb.message.chat.id
    items = get_cart_items(chat_id)
    text = format_cart_contents(items)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Оформити замовлення", callback_data="cart:checkout")],
        [InlineKeyboardButton(text="❌ Повністю скасувати замовлення", callback_data="cart:clear")],
        [InlineKeyboardButton(text="↩️ Повернутись", callback_data="flow:back:article")]
    ])
    try:
        await cb.message.answer(text, reply_markup=kb)
    except Exception:
        logger.exception("Failed to open cart for chat %s", chat_id)
    await cb.answer()

@router.callback_query(F.data == "cart:clear")
async def cb_cart_clear(cb: CallbackQuery):
    chat_id = cb.message.chat.id
    clear_cart(chat_id)
    # оновимо футер — видалимо або виведемо порожній
    try:
        await update_or_send_cart_footer(chat_id, bot)
    except Exception:
        pass
    await cb.message.answer("🧾 Корзина очищена.")
    await cb.answer()

@router.callback_query(F.data == "cart:checkout")
async def cb_cart_checkout(cb: CallbackQuery, state: FSMContext):
    # переходимо до процесу оформлення (наприклад: вибір доставки)
    # зберігаємо, що ми в режимі checkout
    await state.update_data(checkout=True)
    await cb.message.answer("Оформлення замовлення. Оберіть службу доставки:", reply_markup=delivery_keyboard())
    await state.set_state(OrderForm.delivery)
    await cb.answer()

@router.callback_query(F.data == "flow:back:article")
async def cb_flow_back_article(cb: CallbackQuery, state: FSMContext):
    await cb.answer()
    await cb.message.answer("Введіть артикул або назву товару:")
    await state.set_state(OrderForm.article)

@router.callback_query(F.data == "flow:to:delivery")
async def cb_flow_to_delivery(cb: CallbackQuery, state: FSMContext):
    await cb.answer()
    await cb.message.answer("Оберіть службу доставки:", reply_markup=delivery_keyboard())
    await state.set_state(OrderForm.delivery)

    # підсумок: показати та попросити обрати доставку/оплату (якщо ще не обрано)
    text, total = await get_cart_summary(state)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Оберіть службу доставки", callback_data="flow:delivery")],
        [InlineKeyboardButton(text="Оберіть тип оплати", callback_data="flow:payment")],
        [InlineKeyboardButton(text="Підтвердити і відправити замовлення (зараз)", callback_data="cart:confirm_send")],
        [InlineKeyboardButton(text="Назад", callback_data="flow:back:article")],
    ])
    await cb.message.answer(text + f"\n\n🔢 Підсумок до оплати: {total} грн", reply_markup=kb)
    await cb.answer()

@router.callback_query(F.data == "cart:confirm_send")
async def cb_cart_confirm_send(cb: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    cart = data.get("cart", [])
    if not cart:
        await cb.answer("Кошик порожній.")
        return

    # Формуємо payload для MyDrop/адміна
    payload = {
        "pib": data.get("pib"),
        "phone": data.get("phone"),
        "products": cart,
        "delivery": data.get("delivery"),
        "address": data.get("address"),
        "payment": data.get("payment"),
        "note": data.get("note"),
        "mode": data.get("mode", "real")
    }

    # Якщо тестовий режим — НЕ відправляємо в MyDrop, а надсилаємо вам (ADMIN_ID) на перевірку
    if data.get("mode") == "test":
        await bot.send_message(ADMIN_ID, f"🧾 Тестове замовлення (на перевірку):\n{json.dumps(payload, ensure_ascii=False, indent=2)}")
        await cb.message.answer("✅ Замовлення надіслано на перевірку адміністратору.")
        # не очищаємо cart автоматично — чекаємо підтвердження адміном
    else:
        # відправка в MyDrop асинхронно
        asyncio.create_task(create_mydrop_order(payload, notify_chat=ADMIN_ID))
        await cb.message.answer("✅ Замовлення відправлено постачальнику (MyDrop).")
        # очищаємо cart після відправки
        await state.update_data(cart=[])

    await cb.answer()

# --- Обробники кнопок вибору наступного товару та корзини ---
# --- choose from channel / by name placeholders ---
@router.callback_query(F.data == "choose:from_channel")
async def cb_choose_from_channel(cb: CallbackQuery, state: FSMContext):
    # Тут можна направити користувача у репостований канал або пояснити, як вибрати
    await cb.message.answer("Щоб вибрати товар на каналі — відкрийте пост у каналі та натисніть кнопку «Замовити» під потрібним товаром. Якщо ви тут — можете обрати 'Вибрати товар по назві/артикулу'.")
    await cb.answer()

@router.callback_query(F.data == "choose:by_name")
async def cb_choose_by_name(cb: CallbackQuery, state: FSMContext):
    await cb.message.answer("Введіть назву або артикул товару для пошуку:")
    await state.set_state(OrderForm.article)
    await cb.answer()

# --- cart open / clear / checkout ---
@router.callback_query(F.data == "cart:open")
async def cb_cart_open(cb: CallbackQuery, state: FSMContext):
    text, total = await get_cart_summary(state)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Оформити замовлення", callback_data="cart:checkout")],
        [InlineKeyboardButton(text="❌ Повністю скасувати замовлення", callback_data="cart:clear")],
    ])
    await cb.message.answer(text, reply_markup=kb)
    await cb.answer()

@router.callback_query(F.data == "cart:clear")
async def cb_cart_clear(cb: CallbackQuery, state: FSMContext):
    await state.update_data(cart=[])
    await cb.message.answer("❌ Замовлення повністю скасовано. Ви можете розпочати оформлення знову.")
    await cb.answer()

@router.callback_query(F.data == "cart:checkout")
async def cb_cart_checkout(cb: CallbackQuery, state: FSMContext):
    # Перевірка: є товари?
    data = await state.get_data()
    cart = data.get("cart", [])
    if not cart:
        await cb.answer("Кошик порожній.")
        return

    # підсумок: показати та попросити обрати доставку/оплату (якщо ще не обрано)
    text, total = await get_cart_summary(state)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Оберіть службу доставки", callback_data="flow:delivery")],
        [InlineKeyboardButton(text="Оберіть тип оплати", callback_data="flow:payment")],
        [InlineKeyboardButton(text="Підтвердити і відправити замовлення (зараз)", callback_data="cart:confirm_send")],
        [InlineKeyboardButton(text="Назад", callback_data="flow:back:article")],
    ])
    await cb.message.answer(text + f"\n\n🔢 Підсумок до оплати: {total} грн", reply_markup=kb)
    await cb.answer()

@router.callback_query(F.data == "cart:confirm_send")
async def cb_cart_confirm_send(cb: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    cart = data.get("cart", [])
    if not cart:
        await cb.answer("Кошик порожній.")
        return

    # Формуємо payload для MyDrop/адміна
    payload = {
        "pib": data.get("pib"),
        "phone": data.get("phone"),
        "products": cart,
        "delivery": data.get("delivery"),
        "address": data.get("address"),
        "payment": data.get("payment"),
        "note": data.get("note"),
        "mode": data.get("mode", "real")
    }

    # Якщо тестовий режим — НЕ відправляємо в MyDrop, а надсилаємо вам (ADMIN_ID) на перевірку
    if data.get("mode") == "test":
        await bot.send_message(ADMIN_ID, f"🧾 Тестове замовлення (на перевірку):\n{json.dumps(payload, ensure_ascii=False, indent=2)}")
        await cb.message.answer("✅ Замовлення надіслано на перевірку адміністратору.")
        # не очищаємо cart автоматично — чекаємо підтвердження адміном
    else:
        # відправка в MyDrop асинхронно
        asyncio.create_task(create_mydrop_order(payload, notify_chat=ADMIN_ID))
        await cb.message.answer("✅ Замовлення відправлено постачальнику (MyDrop).")
        # очищаємо cart після відправки
        await state.update_data(cart=[])

    await cb.answer()

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

# --- Підтвердження (оновлений — показує selected_sizes якщо є) ---
@router.callback_query(F.data == "order:confirm")
async def cb_order_confirm(cb: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    # підготуємо рядок з розмірами (якщо є)
    selected_sizes = data.get("selected_sizes") or {}
    if selected_sizes:
        sizes_text = "; ".join([f"{k} — {v}" for k, v in selected_sizes.items()])
    else:
        sizes_text = data.get("size") or "—"

    order_text = (
        "📦 НОВЕ ЗАМОВЛЕННЯ\n\n"
        f"👤 ПІБ: {data.get('pib')}\n"
        f"📞 Телефон: {data.get('phone')}\n"
        f"🔖 Товар: {data.get('product_name')} (SKU: {data.get('article')})\n"
        f"📏 Розміри: {sizes_text}\n"
        f"📦 Наявність: {data.get('stock')}\n"
        f"🔢 Кількість: {data.get('amount', 1)} шт.\n"
        f"🚚 Служба: {data.get('delivery')}\n"
        f"📍 Адреса/відділення: {data.get('address')}\n"
        f"💳 Тип оплати: {data.get('payment')}\n"
        f"📝 Примітка: {data.get('note')}\n"
        f"🕒 Час: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
    )
    # Редагуємо повідомлення (щоб користувач бачив повний підсумок)
    try:
        await cb.message.edit_text(order_text, reply_markup=None)
    except Exception:
        # якщо edit не вдався (наприклад минуло занадто багато часу) — просто відправимо нове повідомлення
        await cb.message.answer(order_text)

    await cb.answer()

    # Додаємо selected_sizes в payload для MyDrop або для адміна
    if data.get("mode") == "test":
        # Приклад: додаємо selected_sizes в prefill
        payload_for_prefill = dict(data)
        payload_for_prefill["selected_sizes"] = selected_sizes
        link = f"https://mydrop.com.ua/orders/new?prefill={json.dumps(payload_for_prefill, ensure_ascii=False)}"
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔗 Відкрити форму MyDrop", url=link)]
        ])
        await bot.send_message(ADMIN_ID, f"Тестове замовлення:\n{order_text}", reply_markup=kb)
    else:
        # Додаємо selected_sizes в payload, щоб create_mydrop_order міг їх використати (запит admin/debug)
        payload = dict(data)
        payload["selected_sizes"] = selected_sizes
        asyncio.create_task(create_mydrop_order(payload, notify_chat=ADMIN_ID))

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
    """
    orders_url = os.getenv("MYDROP_ORDERS_URL")
    api_key = os.getenv("MYDROP_API_KEY")
    if not orders_url or not api_key:
        logger.error("MYDROP_ORDERS_URL or MYDROP_API_KEY not configured")
        if notify_chat:
            await bot.send_message(notify_chat, "⚠️ MYDROP_ORDERS_URL або MYDROP_API_KEY не налаштовані на сервері.")
        return None

    article = payload.get("article")
    product_name = payload.get("product_name") or payload.get("title") or article or "Товар"
    amount = int(payload.get("amount", 1) or 1)
    price = payload.get("price") or 0
    vendor_name = os.getenv("SUPPLIER_NAME") or payload.get("vendor_name") or None

    product_obj = {
        "product_title": product_name,
        "sku": article,
        "price": price,
        "amount": amount
    }
    if vendor_name:
        product_obj["vendor_name"] = vendor_name

    # Формуємо body завжди (не всередині if)
    body = {
        "name": payload.get("pib"),
        "phone": payload.get("phone"),
        "products": [product_obj],
    }

    # додамо вибрані розміри у body (якщо є)
    if payload.get("selected_sizes"):
        body["selected_sizes"] = payload.get("selected_sizes")

    # додаткові поля доставки
    if payload.get("delivery"):
        body["delivery_service"] = payload.get("delivery")
    if payload.get("address"):
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

# ---------------- Flask app & webhook endpoint ----------------

@app.route(WEBHOOK_PATH, methods=["POST"])
def webhook():
    """
    Приймаємо JSON від Telegram — швидко шедулемо обробку в асинхронному лупі.
    ВАЖЛИВО: тут ми НЕ запускаємо asyncio.run, а використовуємо run_coroutine_threadsafe,
    щоб передати обробку в головний asyncio-луп (ASYNC_LOOP).
    """
    global ASYNC_LOOP
    try:
        update = request.get_json(force=True)
        if not ASYNC_LOOP or ASYNC_LOOP.is_closed():
            logger.warning("⚠️ ASYNC_LOOP not ready or already closed")
            return "loop not ready", 503
        if not update:
            logger.warning("⚠️ Empty update body from Telegram")
            return "no update", 400

        logger.debug("Update received: %s", update)
        asyncio.run_coroutine_threadsafe(dp.feed_raw_update(bot, update), ASYNC_LOOP)
        return "ok", 200
    except Exception as e:
        logger.exception("Webhook parsing error: %s", e)
        return "bad request", 400

@app.route("/")
def index():
    return "Bot is running!", 200

@app.route("/healthz")
def healthz():
    logger.info("🔄 Healthcheck запит отримано (keepalive ping).")
    return "ok", 200

def run_flask():
    port = int(os.getenv("PORT", "10000"))
    logging.info(f"🌐 Flask healthcheck running on port {port}")
    # У dev режимі this is fine; на продакшні - використайте gunicorn/uvicorn
    app.run(host="0.0.0.0", port=port)

# ---------------- Main ----------------
async def main():
    global ASYNC_LOOP, WEBHOOK_URL
    ASYNC_LOOP = asyncio.get_running_loop()

    # Запускаємо Flask healthcheck/webhook endpoint в окремому потоці
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()
    logger.info("Flask thread started (healthcheck + webhook endpoint).")

    # Спроба виклику startup() dispatcher'а — сумісно з різними версіями aiogram
    try:
        if hasattr(dp, "startup"):
            startup = getattr(dp, "startup")
            if asyncio.iscoroutinefunction(startup):
                await startup()
            else:
                startup()
            logger.info("Dispatcher startup() executed (if available).")
        else:
            logger.info("Dispatcher has no startup() method — skipping warmup.")
    except Exception:
        logger.exception("Dispatcher warmup failed (non-fatal).")

    # Команди бота
    try:
        await setup_commands()
    except Exception:
        logger.exception("setup_commands failed but continuing...")

    # Завантажуємо кеш із файлу (якщо є)
    cache_file = Path(ORDERS_DIR) / "products_cache.xml"
    if cache_file.exists():
        try:
            PRODUCTS_CACHE["data"] = cache_file.read_text(encoding="utf-8")
            PRODUCTS_CACHE["last_update"] = datetime.fromtimestamp(cache_file.stat().st_mtime)
            logger.info("Loaded products cache from file (size=%d)", len(PRODUCTS_CACHE['data'] or ''))
        except Exception:
            logger.exception("Failed to load products cache file")

    # Видаляємо старий webhook перед встановленням нового (нема гарантії але корисно)
    try:
        await bot.delete_webhook(drop_pending_updates=True)
    except Exception:
        logger.exception("Delete webhook failed (non-fatal)")

    # Перевірка і корекція WEBHOOK_URL
    if not WEBHOOK_URL:
        logger.error("❌ WEBHOOK_URL is not set in env. Set WEBHOOK_URL=https://<your-service>/webhook")
        sys.exit(1)

    # Додаємо шлях WEBHOOK_PATH, якщо користувач вказав лише базовий URL
    if not WEBHOOK_URL.endswith(WEBHOOK_PATH):
        WEBHOOK_URL = WEBHOOK_URL.rstrip("/") + WEBHOOK_PATH
        logger.info("Adjusted WEBHOOK_URL to %s", WEBHOOK_URL)

    # Telegram вимагає https webhook
    if not WEBHOOK_URL.startswith("https://"):
        logger.error("❌ WEBHOOK_URL must start with https://")
        sys.exit(1)

    # Ставимо webhook
    try:
        await bot.set_webhook(WEBHOOK_URL, drop_pending_updates=True)
        logger.info("✅ Webhook set to %s", WEBHOOK_URL)
    except Exception:
        logger.exception("Setting webhook failed (non-fatal).")

    logger.info("Bot ready — waiting for webhook updates...")
    # Утримуємо процес запущеним (безпечний нескінченний wait)
    try:
        await asyncio.Event().wait()
    except asyncio.CancelledError:
        logger.info("Main wait cancelled, proceeding to shutdown.")

# ---------------- Graceful shutdown helper ----------------
async def shutdown():
    logger.info("Shutdown: starting cleanup...")

    # Спробуємо видалити webhook (щоб Telegram не надсилав оновлення на недоступний URL)
    try:
        await bot.delete_webhook(drop_pending_updates=True)
        logger.info("Shutdown: webhook deleted.")
    except Exception:
        logger.exception("Shutdown: failed to delete webhook (non-fatal).")

    # Виклик shutdown для dispatcher (якщо доступний)
    try:
        shutdown_fn = getattr(dp, "shutdown", None)
        if shutdown_fn:
            if asyncio.iscoroutinefunction(shutdown_fn):
                await shutdown_fn()
            else:
                shutdown_fn()
            logger.info("Shutdown: dispatcher.shutdown() executed.")
    except Exception:
        logger.exception("Shutdown: dispatcher shutdown failed (non-fatal).")

    # Закриваємо сесію бота / ресурсів
    try:
        if hasattr(bot, "session") and getattr(bot, "session", None) is not None:
            # aiogram 3.x: bot.session exists
            try:
                await bot.session.close()
                logger.info("Shutdown: bot.session closed.")
            except Exception:
                logger.exception("Shutdown: failed to close bot.session.")
        else:
            # fallback: якщо є асинхронний close()
            close_fn = getattr(bot, "close", None)
            if close_fn:
                if asyncio.iscoroutinefunction(close_fn):
                    await close_fn()
                else:
                    close_fn()
                logger.info("Shutdown: bot.close() executed.")
    except Exception:
        logger.exception("Shutdown: failed to close bot resources (non-fatal).")

    logger.info("Shutdown: cleanup finished.")

# ---------------- Launcher ----------------
if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Received stop signal — running graceful shutdown...")
        try:
            asyncio.run(shutdown())
        except Exception:
            logger.exception("Error during shutdown routine.")
        logger.info("Bot stopped.")
    except Exception:
        logger.exception("Unhandled exception in main()")
        try:
            asyncio.run(shutdown())
        except Exception:
            logger.exception("Error during shutdown routine after unhandled exception.")
