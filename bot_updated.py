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
    full_name = msg.text.strip()
    parts = full_name.split()

    if len(parts) != 3:
        await msg.answer("❌ Введіть повністю ваше ПІБ (Прізвище Ім'я По-батькові).")
        return

    if not all(len(p) > 1 for p in parts):
        await msg.answer("❌ Кожна частина ПІБ має містити хоча б 2 символи.")
        return

    await state.update_data(pib=full_name)
    await msg.answer("Введіть телефон (у форматі +380XXXXXXXXX, 380XXXXXXXXX або 0XXXXXXXXX):")
    await state.set_state(OrderForm.phone)

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

async def check_article_or_name(query: str) -> Optional[Dict[str, Any]]:
    """
    Шукає товар по артикулу або назві у вигрузці (MYDROP_EXPORT_URL).
    Повертає dict з полями, додано:
      - components: list[{"name":str, "options": [str,...]}] або None
    Оновлено: більш стійке матчення для числових запитів (виділення цифр, підрядкове порівняння).
    """
    q_raw = str(query or "").strip()
    q = q_raw.lower()
    if not q:
        return None

    text = await load_products_export()
    if not text:
        logger.warning("check_article_or_name: products feed is empty or not loaded")
        return None

    # цифрова частина запиту (наприклад користувач ввів "1053")
    q_digits = re.sub(r'\D', '', q_raw)

    def parse_components_from_description(desc_text: str):
        if not desc_text:
            return None
        desc = re.sub(r'<br\s*/?>', '\n', desc_text, flags=re.I)
        desc = re.sub(r'<[^>]+>', '', desc)
        desc = unescape(desc).strip()

        parts = re.split(r'(?m)^([А-ЯЇЄІҐA-Za-z0-9\-\s]{2,60}):', desc)
        comps = []
        for i in range(1, len(parts), 2):
            name = parts[i].strip()
            content = parts[i+1].strip() if (i+1) < len(parts) else ""
            opts = []
            opts += re.findall(r'\b\d{2,3}-\d{2,3}\b', content)
            opts += re.findall(r'\b\d{2}\b', content)
            opts += re.findall(r'\b(?:XS|S|M|L|XL|XXL|XXXL)\b', content, flags=re.I)
            if re.search(r'універсал', content, flags=re.I):
                opts.append('універсальний')
            # dedupe preserving order
            seen = set()
            final_opts = []
            for o in opts:
                o_norm = str(o).strip()
                if not o_norm:
                    continue
                if o_norm.lower() in seen:
                    continue
                seen.add(o_norm.lower())
                final_opts.append(o_norm)
            if final_opts:
                comps.append({"name": name, "options": final_opts})
        return comps or None

    try:
        it = ET.iterparse(io.StringIO(text), events=("end",))
        for event, elem in it:
            tag = elem.tag
            if not (tag.endswith("offer") or tag.endswith("item") or tag.endswith("product")):
                elem.clear()
                continue

            offer_id = (elem.attrib.get("id") or "").strip()
            vendor_code = (elem.findtext("vendorCode") or elem.findtext("sku") or "").strip()
            name = (elem.findtext("name") or elem.findtext("title") or "").strip()
            price_text = elem.findtext("price") or ""
            try:
                drop_price = float(price_text) if price_text.strip() else None
            except Exception:
                drop_price = None
            rrc_text = elem.findtext("rrc") or elem.findtext("retail") or elem.findtext("oldprice") or None
            try:
                retail_price = float(rrc_text) if rrc_text and str(rrc_text).strip() else None
            except Exception:
                retail_price = None

            quantity_text = elem.findtext("quantity_in_stock")
            stock_qty = None
            if quantity_text and quantity_text.strip().isdigit():
                stock_qty = int(quantity_text.strip())

            stock_attr = elem.attrib.get("available", "true").lower()
            stock = "Є" if stock_attr in ("true", "1", "yes") else "Немає"

            # ------------------------------------------------------------------
            sizes_from_param = []
            components_from_params = []

            for p in elem.findall("param"):
                pname_raw = p.attrib.get("name", "") or ""
                pname = pname_raw.strip()
                ptext = (p.text or "").strip()

                low = pname.lower()
                if any(x in low for x in ("size", "розмір", "размер")) and ptext:
                    parts = re.split(r'[;,/\\\n]+', ptext)
                    for part in parts:
                        v = part.strip()
                        if v:
                            sizes_from_param.append(v)
                    continue

                if any(kw in low for kw in COMPONENT_KEYWORDS):
                    opts = []
                    opts += re.findall(r'\b\d{2,3}-\d{2,3}\b', ptext)
                    opts += re.findall(r'\b(?:XS|S|M|L|XL|XXL|XXXL)\b', ptext, flags=re.I)
                    opts += re.findall(r'\b\d{2}\b', ptext)
                    if re.search(r'універсал', ptext, flags=re.I):
                        opts.append('універсальний')
                    if not opts and re.search(r'\b(так|є|available|есть)\b', ptext, flags=re.I):
                        opts = ['шт.']
                    seen2 = set()
                    final = []
                    for o in opts:
                        o2 = str(o).strip()
                        if not o2:
                            continue
                        if o2.lower() in seen2:
                            continue
                        seen2.add(o2.lower())
                        final.append(o2)
                    components_from_params.append({"name": pname or "Компонент", "options": final})

            desc_text = elem.findtext("description") or ""
            components_from_desc = parse_components_from_description(desc_text)

            # Merge components
            components = None
            if components_from_desc:
                if components_from_params:
                    desc_names = {c["name"].lower(): c for c in components_from_desc}
                    merged = components_from_desc.copy()
                    for comp_p in components_from_params:
                        if comp_p["name"].lower() not in desc_names:
                            merged.append(comp_p)
                    components = merged
                else:
                    components = components_from_desc
            elif components_from_params:
                components = components_from_params
            elif sizes_from_param:
                components = [{"name": "Розмір", "options": list(dict.fromkeys(sizes_from_param))}]
            else:
                components = None
            # ------------------------------------------------------------------

            product = {
                "name": name or offer_id,
                "sku": vendor_code or offer_id,
                "drop_price": drop_price,
                "retail_price": retail_price,
                "final_price": apply_markup(drop_price) if drop_price is not None else None,
                "stock": stock,
                "stock_qty": stock_qty,
                "stock_text": f"{stock} ({stock_qty} шт.)" if stock_qty is not None else stock,
                "sizes": sizes_from_param or None,
                "components": components
            }

            # =============================================================================
            # Політика порівняння (додаткове, більш терпиме матчення для digits)
            # =============================================================================
            qlow = q  # already lower
            # exact id/sku match (case-insensitive)
            if qlow and (qlow == (offer_id or "").lower() or (vendor_code and qlow == vendor_code.lower())):
                elem.clear()
                logger.debug("check_article_or_name: exact match by id/sku: query=%s offer_id=%s sku=%s", q_raw, offer_id, vendor_code)
                return product

            # numeric-matching: якщо користувач ввів лише цифри, порівнюємо цифрові частини
            if q_digits:
                offer_digits = re.sub(r'\D', '', offer_id or "")
                sku_digits = re.sub(r'\D', '', vendor_code or "")
                # повний цифровий матч
                if offer_digits and q_digits == offer_digits:
                    elem.clear()
                    logger.debug("check_article_or_name: matched by digits (offer_id): %s -> %s", q_digits, offer_id)
                    return product
                if sku_digits and q_digits == sku_digits:
                    elem.clear()
                    logger.debug("check_article_or_name: matched by digits (sku): %s -> %s", q_digits, vendor_code)
                    return product
                # підрядковий цифровий матч (наприклад query '1053' у 'ART-1053')
                if offer_digits and q_digits in offer_digits:
                    elem.clear()
                    logger.debug("check_article_or_name: digits substring match (offer_id): %s in %s", q_digits, offer_digits)
                    return product
                if sku_digits and q_digits in sku_digits:
                    elem.clear()
                    logger.debug("check_article_or_name: digits substring match (sku): %s in %s", q_digits, sku_digits)
                    return product

            # match by full name or partial name (as suggestion)
            if name and qlow == name.lower():
                elem.clear()
                logger.debug("check_article_or_name: exact match by name: %s -> %s", q_raw, name)
                return product

            if name and qlow in name.lower() and len(qlow) >= 3:
                product["suggestion"] = True
                elem.clear()
                logger.debug("check_article_or_name: suggestion for query '%s' -> '%s'", q_raw, name)
                return product

            elem.clear()
        # end iterparse
    except Exception as e:
        logger.exception("XML parse error in check_article_or_name: %s", e)

    logger.debug("check_article_or_name: no match for query '%s'", q_raw)
    return None

# ---------------- Helpers: component size search ----------------
COMPONENT_KEYWORDS = ["шап", "шапка", "рукав", "рукави", "рукавиц", "рукавич", "баф", "балаклав", "комплект"]

async def find_component_sizes(product_name: str) -> Dict[str, List[str]]:
    """
    Повертає мапу компонент->list_of_sizes, наприклад:
      { "шапка": ["55-57","58-60"], "рукавиця": ["S","M","L"] }
    Алгоритм простий:
      - якщо у name товару міститься ключове слово (наприклад 'шапка' або 'комплект'),
        то скануємо весь XML і збираємо унікальні значення param, які виглядають як розміри
        (шукаємо param name містить size/размер/Розмір/Размер і беремо їх тексти).
    Повертає {} якщо нічого не знайдено або кеш пустий.
    """
    res: Dict[str, List[str]] = {}
    text = PRODUCTS_CACHE.get("data")
    if not text:
        return res

    name_lower = (product_name or "").lower()

    # визначимо, які компоненти шукати — на основі ключових слів що є в найменуванні продукту
    to_search = [kw for kw in COMPONENT_KEYWORDS if kw in name_lower]
    if not to_search:
        # Якщо без ключів у назві — все одно пробіжимося по всьому фіду
        to_search = COMPONENT_KEYWORDS.copy()

    try:
        import xml.etree.ElementTree as ET
        it = ET.iterparse(io.StringIO(text), events=("end",))
        for event, elem in it:
            tag = elem.tag
            if not (tag.endswith("offer") or tag.endswith("item") or tag.endswith("product")):
                elem.clear()
                continue

            name = (elem.findtext("name") or elem.findtext("title") or "").strip().lower()
            # якщо назва пустая — пропускаємо
            if not name:
                elem.clear()
                continue

            # перевіримо, чи назва цього оффера містить якийсь компонент з to_search
            matched_components = [kw for kw in to_search if kw in name]
            if not matched_components:
                # також можна шукати по опису або param->name, але спочатку так
                elem.clear()
                continue

            # збираємо param'и що виглядають як розмір
            sizes = set()
            for p in elem.findall("param"):
                pname = (p.attrib.get("name") or "").lower()
                if any(x in pname for x in ("size", "размер", "розмір", "разм", "размір")) or pname.strip() in ("размер", "size", "розмір"):
                    if (p.text or "").strip():
                        sizes.add((p.text or "").strip())
            # деякі фіди зберігають розміри як параметри атрибутів або прямо в name (наприклад "55-57")
            if not sizes:
                # спробуємо знайти у name фрагменти виду "55-57" або "S, M, L"
                import re
                # 55-57 style
                ranges = re.findall(r"\b\d{2,3}-\d{2,3}\b", name)
                for r in ranges:
                    sizes.add(r)
                # прості буквені розміри S, M, L (кілька)
                letters = re.findall(r"\b([XSML]{1,3})\b", name.upper())
                for l in letters:
                    sizes.add(l)

            if sizes:
                for comp in matched_components:
                    if comp not in res:
                        res[comp] = []
                    res[comp].extend(list(sizes))

            elem.clear()

        # унікалізуємо і відсортуємо
        for k, v in list(res.items()):
            uniq = sorted(set([x.strip() for x in v if x and x.strip()]))
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
@router.message(OrderForm.article)
async def state_article(msg: Message, state: FSMContext):
    query = msg.text.strip()
    await msg.chat.do("typing")
    product = await check_article_or_name(query)

    if not product:
        await msg.answer("❌ Не знайдено товар. Спробуйте ще раз (артикул або частина назви) або напишіть 'підтримка'.")
        return

    stock_text = product["stock_text"]

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

    # Якщо точний збіг — зберігаємо базові дані
    await state.update_data(
        article=product["sku"],
        product_name=product["name"],
        stock=product["stock"],
        stock_qty=product.get("stock_qty"),
        price=product["final_price"],
        components=product.get("components")  # можуть бути None або список компонентів
    )

    # Якщо є компоненти => починаємо послідовно питати розміри через inline-кнопки
    components = product.get("components")
    if components:
        # ініціалізуємо selected_sizes як порожній dict
        await state.update_data(selected_sizes={})
        # ask first component
        comp0 = components[0]
        opts = comp0.get("options") or []
        if not opts:
            # якщо немає опцій, просто переходьмо до наступного кроку (quantity)
            await msg.answer(
                f"✅ Знайдено товар:\n"
                f"🔖 <b>{product['name']}</b>\n"
                f"🆔 Артикул: <b>{product['sku']}</b>\n"
                f"📦 Наявність: <b>{stock_text}</b>\n"
                f"💰 Ціна для клієнта: {product.get('final_price') or '—'} грн\n"
                f"💵 Дроп ціна: {product.get('drop_price') or '—'} грн\n\n"
                "👉 Введіть кількість товару (число):"
            )
            await state.set_state(OrderForm.amount)
            return

        # build inline keyboard for options
        kb = InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text=str(opt), callback_data=f"size:0:{i}")]
                for i, opt in enumerate(opts)
            ] + [
                [InlineKeyboardButton(text="❌ Скасувати", callback_data="order:cancel")]
            ]
        )
        await msg.answer(
            f"✅ Знайдено товар:\n"
            f"🔖 <b>{product['name']}</b>\n"
            f"🆔 Артикул: <b>{product['sku']}</b>\n"
            f"📦 Наявність: <b>{stock_text}</b>\n"
            f"💰 Ціна: {product.get('final_price') or '—'} грн\n\n"
            f"📏 Виберіть розмір для: <b>{comp0['name']}</b>",
            reply_markup=kb
        )
        await state.set_state(OrderForm.size)
        return

    # Якщо немає компонентів — як раніше запитуємо кількість
    sizes_text = f"\n📏 Розміри: {', '.join(product['sizes'])}" if product.get("sizes") else ""
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

# --- Обробник вибору розміру через inline-кнопки (оновлений UX: Continue / Edit) ---
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
