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
import re
import io
import collections
import aiohttp
import xml.etree.ElementTree as ET
import math
from typing import Optional, List, Tuple, Dict, Any
from collections import defaultdict
from dotenv import load_dotenv
from flask import Flask, request
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone, timedelta
from google.cloud import storage
from aiogram import Bot, Dispatcher, Router, F, types
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import StatesGroup, State
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery, BotCommand

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

REVIEW_CHAT = int(os.getenv("REVIEW_CHAT", str(ADMIN_ID)))
BUCKET_NAME = os.getenv("GCS_BUCKET", "taverna-bot-storage")

# ---------------- Cache for MyDrop products ----------------
PRODUCTS_CACHE = {
    "last_update": None,
    "data": None
}
CACHE_TTL = 900  # 15 хвилин (900 секунд)

PRODUCTS_EXPORT_CACHE: Optional[str] = None

# ---------------- Index for fast lookup ----------------
PRODUCTS_INDEX = {
    "by_sku": {},
    "by_offer": {},
    "by_name": {},
    "all_products": []
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
    Парсимо XML і будуємо індекс товарів:
      - by_sku: ключі (normalized, raw_lower, raw_no_leading_zeros) -> product dict
      - by_name: token -> [product dicts]
      - all_products: список усіх товарів
    Додаємо пошук артикулу з <param> і — як fallback — із опису/назви.
    """
    global PRODUCTS_INDEX
    PRODUCTS_INDEX = {"by_sku": {}, "by_name": {}, "all_products": []}
    try:
        it = ET.iterparse(io.StringIO(text), events=("end",))
        for event, elem in it:
            tag = _local_tag(elem.tag).lower()
            if not (tag.endswith("offer") or tag.endswith("item") or tag.endswith("product")):
                elem.clear()
                continue

            offer_id = (elem.attrib.get("id") or "").strip()
            vendor_code = _find_first_text(elem, ["vendorcode", "vendor_code", "sku", "articul", "article", "code"])
            name = _find_first_text(elem, ["name", "title", "product", "model", "productname", "product_name"]) or offer_id
            drop_price = _find_first_numeric(elem, ["price", "drop", "cost", "value", "price_uah"])
            retail_price = _find_first_numeric(elem, ["rrc", "retail", "msrp", "oldprice"])

            # Наявність і кількість
            stock_qty = None
            qtxt = _find_first_text(elem, ["quantity", "quantity_in_stock", "stock", "available_quantity", "count"])
            if qtxt:
                m = re.search(r'\d+', qtxt.replace(" ", ""))
                if m:
                    try:
                        stock_qty = int(m.group(0))
                    except:
                        stock_qty = None

            available = (elem.attrib.get("available") or "").lower() in ["true", "1", "yes", "да"]

            # Опис, фото
            description = _find_first_text(elem, ["description"])
            pictures = [p.text.strip() for p in elem.findall(".//picture") if p.text]

            # sizes and raw_skus
            sizes = []
            raw_skus = []

            # парсимо <param>
            for p in elem.findall(".//param"):
                pname = (p.attrib.get("name") or "").lower()
                pval = (p.text or "").strip()
                if not pval:
                    continue

                if any(k in pname for k in ("артикул", "артікул", "sku", "код", "vendorcode", "vendor_code", "article")):
                    # може бути список або просто значення
                    for s in re.split(r'[;,/]', pval):
                        s = s.strip()
                        if s:
                            raw_skus.append(s)
                    if not vendor_code:
                        vendor_code = pval.strip()
                    continue

                if any(k in pname for k in ("размер", "розмір", "size", "розміри")):
                    for s in re.split(r'[;,/]', pval):
                        s = s.strip()
                        if s:
                            sizes.append(s)
                    continue

                if any(k in pname for k in ("цена", "дроп", "price")):
                    try:
                        drop_price = float(pval.replace(",", ".").replace(" ", ""))
                    except:
                        pass
                    continue

            # також дивимось на внутрішні варіації/variant/offer sku attributes
            for v in list(elem.findall(".//offer")) + list(elem.findall(".//variant")) + list(elem.findall(".//item")):
                vsku = (v.attrib.get("sku") or _find_first_text(v, ["sku", "vendorcode", "articul"]) or "").strip()
                if vsku:
                    raw_skus.append(vsku)

            # fallback: витягнути артикул із опису/назви, якщо vendor_code ще немає
            if not vendor_code and description:
                m = re.search(r'(?:артикул|артікул|sku|код|article)[\s\:\-]*([0-9]{2,10})', description, flags=re.I)
                if m:
                    vendor_code = m.group(1).strip()

            # унікалізація raw_skus
            raw_skus = [s for s in dict.fromkeys([r for r in raw_skus if r])]

            # основний ключ (normalized)
            main_key = vendor_code or offer_id or (raw_skus[0] if raw_skus else "")
            sku_normalized = normalize_sku(main_key or "")

            product = {
                "offer_id": offer_id,
                "sku": sku_normalized,
                "raw_skus": raw_skus,
                "raw_sku": raw_skus[0] if raw_skus else (vendor_code or offer_id or ""),
                "vendor_code": vendor_code,
                "name": name,
                "description": description,
                "pictures": pictures,
                "sizes": sizes,
                "drop_price": float(drop_price) if drop_price is not None else None,
                "retail_price": float(retail_price) if retail_price is not None else None,
                "stock_qty": stock_qty,
                "available": available,
            }
            PRODUCTS_INDEX["all_products"].append(product)

            # індексуємо під кількома ключами для надійного пошуку
            candidates = set()
            if sku_normalized:
                candidates.add(sku_normalized)
            if offer_id:
                candidates.add(normalize_sku(offer_id) or offer_id.lower())
            if vendor_code:
                candidates.add(normalize_sku(vendor_code) or vendor_code.lower())
            for r in raw_skus:
                candidates.add(normalize_sku(r) or r.strip().lower())
                candidates.add(r.strip().lower())
                candidates.add(r.strip().lstrip("0"))

            for key in candidates:
                if key:
                    PRODUCTS_INDEX["by_sku"][key] = product

            # index by name tokens
            for tok in re.findall(r'\w{3,}', (name or "").lower()):
                PRODUCTS_INDEX["by_name"].setdefault(tok, []).append(product)

            elem.clear()

        # лог once
        total = len(PRODUCTS_INDEX["all_products"])
        sample = [(p.get("raw_sku"), p.get("sku")) for p in PRODUCTS_INDEX["all_products"][:5]]
        logger.debug("Product index built: %s products total. First 5 SKUs (raw,norm): %s", total, sample)

    except Exception:
        logger.exception("Failed to build products index")

def find_product_by_sku(sku: str):
    norm = normalize_sku(sku)

    # 1. Шукаємо по offer_id (старий спосіб)
    if norm in product_index:
        return product_index[norm]

    # 2. Шукаємо по vendorCode (артикулу)
    for prod in all_products.values():
        if prod.get("vendorCode") and normalize_sku(prod["vendorCode"]) == norm:
            return prod

    # 3. Якщо нічого не знайшли
    return None

# ---------------- Cache for MyDrop products ----------------
CART_TTL_SECONDS = 15 * 60  # 15 хвилин

def _cart_blob(user_id: int):
    client = storage.Client()
    bucket = client.bucket(BUCKET_NAME)
    return bucket.blob(f"carts/{user_id}.json")


def load_cart(user_id: int) -> dict:
    """
    Завантажує кошик користувача з GCS.
    Якщо кошик прострочений або його немає → повертає порожній.
    """
    blob = _cart_blob(user_id)
    if not blob.exists():
        return {"created_at": datetime.now(timezone.utc).isoformat(), "items": []}

    data = json.loads(blob.download_as_text())
    created_at = datetime.fromisoformat(data.get("created_at"))

    if datetime.now(timezone.utc) - created_at > timedelta(seconds=CART_TTL_SECONDS):
        # кошик прострочений — видаляємо
        blob.delete()
        return {"created_at": datetime.now(timezone.utc).isoformat(), "items": []}

    return data


def save_cart(user_id: int, cart: dict):
    """
    Зберігає кошик у GCS.
    """
    blob = _cart_blob(user_id)
    blob.upload_from_string(json.dumps(cart, ensure_ascii=False), content_type="application/json")


def add_to_cart(user_id: int, product: dict, size: str, amount: int):
    """
    Додає товар у кошик користувача.
    """
    cart = load_cart(user_id)

    item = {
        "sku": product.get("sku"),
        "name": product.get("name"),
        "size": size,
        "amount": amount,
        "unit_price": product.get("drop_price") or 0,
        "line_total": (product.get("drop_price") or 0) * amount
    }

    cart["items"].append(item)
    cart["created_at"] = datetime.now(timezone.utc).isoformat()

    save_cart(user_id, cart)
    return cart

# ---------------- global async loop holder ----------------
# буде заповнений в main()
ASYNC_LOOP: Optional[asyncio.AbstractEventLoop] = None

# ---------------- id Telegram ----------------
@router.message(Command("get_chatid"))
async def cmd_get_chatid(msg: Message):
    chat = await bot.get_chat("@test_taverna")
    await msg.answer(f"ID каналу: {chat.id}")

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
async def push_flow(state: FSMContext, state_name: str):
    data = await state.get_data()
    stack = data.get("flow_stack") or []
    stack.append(state_name)
    await state.update_data(flow_stack=stack)

async def pop_flow(state: FSMContext):
    data = await state.get_data()
    stack = data.get("flow_stack") or []
    if stack:
        stack.pop()
    await state.update_data(flow_stack=stack)
    return stack[-1] if stack else None

def build_nav_kb(extra_buttons: Optional[List[List[InlineKeyboardButton]]] = None) -> InlineKeyboardMarkup:
    """
    Повертає клавіатуру з кнопками: (опційні верхні кнопки) + Назад + Скасувати.
    extra_buttons — список рядків кнопок (кожний рядок — list[InlineKeyboardButton])
    """
    kb_rows: List[List[InlineKeyboardButton]] = []
    if extra_buttons:
        kb_rows.extend(extra_buttons)
    kb_rows.append([InlineKeyboardButton("⬅️ Назад", callback_data="flow:back_to_start")])
    kb_rows.append([InlineKeyboardButton("❌ Скасувати замовлення", callback_data="flow:cancel_order")])
    return InlineKeyboardMarkup(inline_keyboard=kb_rows)

def format_grouped_product(product, group_products):
    """Формує повідомлення для групового товару з усіма розмірами"""
    text = f"📦 {product['name']}\n"
    text += f"Артикул: {product.get('vendorCode', '-')}\n"
    text += f"💰 Ціна: {product['price']} грн\n\n"

    text += "📏 Доступні розміри:\n"
    for p in group_products:
        size = None
        for param in p.get("params", []):
            if param.get("name") == "Размер":
                size = param.get("value")
        qty = p.get("quantity_in_stock", 0)
        avail = "✅" if p.get("available") and qty > 0 else "❌"
        text += f"{size}: {avail} (залишок {qty})\n"

    return text

@router.callback_query(F.data == "flow:back_to_start")
async def cb_flow_back(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    await cb.message.answer("Повернулись на початок. Введіть артикул або натисніть кнопку Замовити під постом.", reply_markup=None)
    await cb.answer()

def get_order_keyboard(post_id: int, test: bool = False, sku: Optional[str] = None):
    mode = "test" if test else "client"
    deep = f"order_{mode}_{post_id}"
    if sku:
        # додаємо дубль "__sku_<sku>" щоб не ламати розбір
        deep = f"{deep}__sku_{sku}"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🛒 Замовити", url=f"https://t.me/{BOT_USERNAME}?start={deep}")]
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
def cart_path_for_user(user_id):
    return Path(ORDERS_DIR) / f"cart_{user_id}.json"

def load_cart(user_id):
    p = cart_path_for_user(user_id)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except:
            return {"items": []}
    return {"items": []}

def save_cart(user_id, cart):
    p = cart_path_for_user(user_id)
    p.write_text(json.dumps(cart, ensure_ascii=False), encoding="utf-8")

async def add_to_cart(user_id: int, product: dict, amount: int, selected_sizes: dict):
    cart = load_cart(user_id)
    # структура item: {sku, name, price, drop_price, amount, sizes}
    item = {
        "sku": product.get("sku") or product.get("offer_id"),
        "name": product.get("name"),
        "price": product.get("final_price") or product.get("retail_price") or 0,
        "drop_price": product.get("drop_price"),
        "amount": amount,
        "sizes": selected_sizes or {}
    }
    cart["items"].append(item)
    save_cart(user_id, cart)
    return cart

async def build_cart_summary_text(cart):
    lines = []
    total = 0
    for i, it in enumerate(cart.get("items", []), start=1):
        price = it.get("price") or 0
        qty = int(it.get("amount") or 1)
        subtotal = price * qty
        total += subtotal
        sizes = "; ".join([f"{k}:{v}" for k,v in (it.get("sizes") or {}).items()]) or "-"
        lines.append(f"{i}. {it['name']} ({it['sku']})\n   Розміри: {sizes}\n   Ціна за 1: {price} грн • Кількість: {qty} • Сума: {subtotal} грн")
    body = "\n\n".join(lines) if lines else "Поки що кошик порожній."
    body += f"\n\n🔔 Загальна сума: {total} грн"
    return body, total

async def send_or_update_cart_footer(chat_id: int, user_id: int, bot: Bot, state: FSMContext):
    data = await state.get_data()
    footer_msg_id = data.get("cart_footer_msg_id")
    cart = load_cart(user_id)
    text, total = await build_cart_summary_text(cart)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"🧺 ТУТ ВАША КОРЗИНА — Загальна сума: {total} грн", callback_data="cart:open")],
    ])
    try:
        if footer_msg_id:
            await bot.edit_message_text(text=f"🧺 Кошик • Загальна сума: {total} грн", chat_id=chat_id, message_id=footer_msg_id, reply_markup=kb)
        else:
            m = await bot.send_message(chat_id, f"🧺 Кошик • Загальна сума: {total} грн", reply_markup=kb)
            await state.update_data(cart_footer_msg_id=m.message_id)
    except Exception:
        # fallback: send new
        m = await bot.send_message(chat_id, f"🧺 Кошик • Загальна сума: {total} грн", reply_markup=kb)
        await state.update_data(cart_footer_msg_id=m.message_id)

@router.callback_query(F.data == "cart:open")
async def cb_cart_open(cb: CallbackQuery, state: FSMContext):
    cart = load_cart(cb.from_user.id)
    text, total = await build_cart_summary_text(cart)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton("✅ Оформити замовлення", callback_data="cart:checkout")],
        [InlineKeyboardButton("➕ Продовжити вибір", callback_data="choose:continue")],
        [InlineKeyboardButton("❌ Повністю скасувати", callback_data="cart:clear")],
    ])
    await cb.message.answer(text, reply_markup=kb)
    await cb.answer()

@router.callback_query(F.data == "cart:clear")
async def cb_cart_clear(cb: CallbackQuery, state: FSMContext):
    save_cart(cb.from_user.id, {"items": []})
    await state.update_data(cart_footer_msg_id=None)
    await cb.message.answer("Кошик очищено.")
    await cb.answer()

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
USER_CART_MSG: Dict[int, Dict[str, Any]] = {}

def ensure_cart(chat_id: int):
    if chat_id not in USER_CARTS:
        USER_CARTS[chat_id] = []

async def ensure_or_update_cart_footer(chat_id: int):
    """
    Якщо footer існує — редагуємо його, інакше створюємо нове повідомлення з кнопкою перегляду корзини.
    """
    cart = get_cart_items(chat_id)
    total = cart_total(cart)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"🛒 Тут знаходиться ваша КОРЗИНА — Загальна сума: {total} грн", callback_data="cart:view")],
    ])
    meta = USER_CART_MSG.get(chat_id)
    if meta:
        try:
            await bot.edit_message_text(f"🛒 Ваша корзина — Загальна сума: {total} грн", chat_id=meta["chat_id"], message_id=meta["message_id"], reply_markup=kb)
            return
        except Exception:
            # якщо edit помер — створимо нове
            USER_CART_MSG.pop(chat_id, None)

    # create new footer message
    sent = await bot.send_message(chat_id, f"🛒 Ваша корзина — Загальна сума: {total} грн", reply_markup=kb)
    USER_CART_MSG[chat_id] = {"chat_id": sent.chat.id, "message_id": sent.message_id}

@router.callback_query(F.data == "cart:view")
async def cart_view(cb: CallbackQuery, state: FSMContext):
    chat_id = cb.from_user.id
    items = get_cart_items(chat_id)
    text = format_cart_contents(items)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Повністю скасувати замовлення", callback_data="cart:clear")],
        [InlineKeyboardButton(text="Продовжити оформлення", callback_data="cart:continue")],
    ])
    await cb.message.answer(text, reply_markup=kb)
    await cb.answer()

@router.callback_query(F.data == "cart:clear")
async def cart_clear(cb: CallbackQuery, state: FSMContext):
    chat_id = cb.from_user.id
    clear_cart(chat_id)
    # видаляємо footer якщо був
    meta = USER_CART_MSG.pop(chat_id, None)
    if meta:
        try:
            await bot.delete_message(meta["chat_id"], meta["message_id"])
        except:
            pass
    await cb.message.answer("❌ Замовлення повністю скасовано. Можете почати оформлення заново.")
    await cb.answer()

def add_to_cart(chat_id: int, item: Dict[str, Any]) -> None:
    """Додає item до USER_CARTS[chat_id]. item keys: name, sku, price, qty, sizes"""
    USER_CARTS.setdefault(chat_id, []).append(item)

def clear_cart(chat_id: int) -> None:
    USER_CARTS.pop(chat_id, None)
    # також видаляємо запис про footer, якщо є
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
            except Exception:
                # якщо не вдалося перетворити — ігноруємо
                pass
    return total

def format_cart_contents(cart_items: List[Dict[str, Any]]) -> str:
    if not cart_items:
        return "🛒 Ваша корзина порожня."
    lines = ["🧾 Вміст корзини:"]
    for i, it in enumerate(cart_items, 1):
        sizes = it.get("sizes") or {}
        if isinstance(sizes, dict):
            sizes_txt = ", ".join([f"{k}: {v}" for k, v in sizes.items()]) if sizes else "—"
        else:
            sizes_txt = str(sizes) if sizes else "—"
        price = it.get("price") or "—"
        qty = int(it.get("qty") or 1)
        try:
            subtotal = int(price) * qty
        except Exception:
            try:
                subtotal = int(float(price)) * qty
            except Exception:
                subtotal = "—"
        lines.append(f"{i}. {it.get('name','Товар')} ({sizes_txt}) — {price} грн × {qty} = {subtotal}")
    total = cart_total(cart_items)
    lines.append(f"\n💰 Загальна сума: {total} грн.")
    lines.append("\n❌ Для повного скасування натисніть: /clear_cart (або відповідну кнопку в інтерфейсі)")
    return "\n".join(lines)

# ---------------- Routers / Handlers ----------------
# --- Replace all other CommandStart handlers with this single unified handler ---
async def _present_product_and_ask_confirm(msg: Message, state: FSMContext, product: Dict[str, Any]):
    """
    Допоміжна функція: показує фото/назву товару, зберігає product у state як last_found_product
    і виводить кнопки: ✅ Підтвердити | ⬅️ Назад
    Встановлює стан OrderForm.article (щоб далі обробляти підтвердження/вибір).
    """
    await state.update_data(last_found_product=product, article=product.get("sku") or product.get("sku") or "")
    # спробуємо надіслати перше фото (якщо є)
    pic = product.get("picture") or product.get("image") or product.get("images") or None
    caption = (
        f"🔖 <b>{product.get('name') or 'Товар'}</b>\n"
        f"🆔 Артикул: <b>{product.get('sku') or '-'}</b>\n"
        f"📦 Наявність: <b>{product.get('stock') or '—'}</b>\n"
        f"💰 Орієнтовна ціна (з націнкою): {product.get('final_price') or '—'} грн\n"
        f"💵 Дроп ціна: {product.get('drop_price') or '—'} грн\n"
    )
    kb = build_nav_kb(extra_buttons=[
        [InlineKeyboardButton("✅ Підтвердити", callback_data="article:confirm")]
])
    if pic:
        try:
            # якщо picture - list, візьмемо перший
            if isinstance(pic, (list, tuple)) and pic:
                pic_url = pic[0]
            else:
                pic_url = pic
            await msg.answer_photo(photo=pic_url, caption=caption, parse_mode=ParseMode.HTML, reply_markup=kb)
        except Exception:
            # fallback на текстове повідомлення
            await msg.answer(caption, parse_mode=ParseMode.HTML, reply_markup=kb)
    else:
        await msg.answer(caption, parse_mode=ParseMode.HTML, reply_markup=kb)

    await state.set_state(OrderForm.article)
    return

def format_currency(value: Optional[float]) -> str:
    if value is None:
        return "— грн"
    try:
        v = int(round(float(value)))
        return f"{v:,}".replace(",", " ") + " грн"
    except Exception:
        return str(value) + " грн"

def format_product_message(product: dict, mode: str = "client", include_intro: bool = True) -> str:
    """
    Формує текст для повідомлення бота по продукту.
    - product: dict з ключами sku, vendor_code, name, description, sizes, stock_qty, drop_price
    - mode: "test" або "client"
    - include_intro: якщо True — додати заголовок "Розпочнемо оформлення..."
    """
    sku_line = product.get("sku") or product.get("vendor_code") or product.get("offer_id") or "—"
    vendor_code = product.get("vendor_code") or sku_line
    name = product.get("name") or "—"
    desc = (product.get("description") or "").strip()
    sizes_list = product.get("sizes") or []
    sizes_text = ", ".join(sizes_list) if sizes_list else "—"
    stock_qty = product.get("stock_qty")
    stock_qty = int(stock_qty) if stock_qty is not None else 0
    stock_text = "Є ✅" if stock_qty > 0 else "Немає ❌"
    drop_price = product.get("drop_price")
    final_price = None
    if drop_price is not None:
        final_price = aggressive_round(drop_price * 1.33)

    lines = []
    if include_intro:
        lines.append("🧾 Розпочнемо оформлення. Ось вибраний товар:")
    lines.append("✅ Знайдено товар:")
    lines.append(f"📌 Артикул: {sku_line}")
    lines.append(f"📛 Назва: {name}")
    if desc:
        # короткий опис (щоб не бамкати довгим текстом)
        lines.append(f"📝 Опис: {desc[:400]}{'...' if len(desc) > 400 else ''}")
    lines.append(f"📦 Наявність: {stock_text} (кількість: {stock_qty})")
    lines.append(f"📏 Розміри: {sizes_text}")
    if mode == "test":
        lines.append(f"💵 Дроп ціна: {drop_price if drop_price is not None else '—'} грн")
        lines.append(f"💰 Орієнтовна ціна (з націнкою): {final_price if final_price is not None else '—'} грн")
    else:
        lines.append(f"💰 Ціна для клієнта: {final_price if final_price is not None else '—'} грн")
    return "\n".join(lines)

# alias (якщо десь викликають render_product_text)
def render_product_text(product: dict, mode: str = "client", include_intro: bool = True) -> str:
    return format_product_message(product, mode=mode, include_intro=include_intro)

# Wrapper для сумісності з ранішнім кодом
def render_product_text(product: dict, mode: str = "client", include_intro: bool = True) -> str:
    return format_product_message(product, mode=mode, include_intro=include_intro)

@router.message(CommandStart())
async def cmd_start(msg: Message, state: FSMContext, command: CommandStart):
    """
    /start
    Підтримує deep links:
      /start order_<mode>_<post_id>
      /start order_<mode>_<post_id>__sku_<sku>
    mode == "test" -> тестовий (admin/publish_test)
    """
    args = (command.args or "").strip()

    # якщо немає deep link
    if not args:
        await msg.answer(
            "Привіт! Це бот Taverna 👋\n"
            "Натисніть кнопку «Замовити» під постом у каналі, щоб оформити замовлення."
        )
        return

    # парсимо sku, якщо є
    sku = None
    if "__sku_" in args:
        main, sku_part = args.split("__sku_", 1)
        args = main
        sku = sku_part.strip()

    parts = args.split("_")
    if len(parts) >= 3 and parts[0] == "order":
        mode = parts[1]
        post_id = parts[2]
        await state.update_data(post_message_id=post_id, mode=mode)
        logger.info("Start deep link: mode=%s post_id=%s sku=%s", mode, post_id, sku)

        if sku:
            sku_norm = normalize_sku(sku)
            product = find_product_by_sku(sku_norm)
            logger.debug(
                "Deep link lookup result. SKU=%s (norm=%s), found=%s",
                sku, sku_norm, bool(product)
            )

            if not product:
                await msg.answer("⚠️ Товар з таким артикулом не знайдено. Введіть артикул або назву вручну.")
                await state.set_state(OrderForm.article)
                return

            # Якщо це група товарів → показуємо список розмірів
            if product.get("group_id"):
                group_products = [
                    p for p in all_products.values()
                    if p.get("group_id") == product["group_id"]
                ]
                text = format_grouped_product(product, group_products)

                kb_rows = []
                row = []
                for gp in group_products:
                    size = None
                    for param in gp.get("params", []):
                        if param.get("name") == "Размер":
                            size = param.get("value")
                    if size:
                        row.append(InlineKeyboardButton(
                            text=str(size),
                            callback_data=f"choose_size:{gp['sku']}:{size}"
                        ))
                        if len(row) >= 4:
                            kb_rows.append(row); row = []
                if row:
                    kb_rows.append(row)

                kb_rows.append([InlineKeyboardButton("⬅️ Назад", callback_data="flow:back_to_start")])
                kb = InlineKeyboardMarkup(inline_keyboard=kb_rows)

                pics = product.get("pictures") or []
                if pics:
                    await msg.answer_photo(pics[0], caption=text, reply_markup=kb)
                else:
                    await msg.answer(text, reply_markup=kb)

                await state.set_state(OrderForm.size)
                await state.update_data(last_product=product)
                return

            # Якщо групи немає → стандартна логіка
            text = render_product_text(product, mode, include_intro=True)
            sizes = product.get("sizes") or []

            if sizes:
                kb_rows = []
                row = []
                for i, s in enumerate(sizes):
                    row.append(InlineKeyboardButton(
                        text=str(s),
                        callback_data=f"choose_size:{product['sku']}:{s}"
                    ))
                    if (i + 1) % 4 == 0:
                        kb_rows.append(row); row = []
                if row:
                    kb_rows.append(row)
                kb_rows.append([InlineKeyboardButton("⬅️ Назад", callback_data="flow:back_to_start")])
                kb = InlineKeyboardMarkup(inline_keyboard=kb_rows)

                pics = product.get("pictures") or []
                if pics:
                    await msg.answer_photo(pics[0], caption=text, reply_markup=kb)
                else:
                    await msg.answer(text, reply_markup=kb)

                await state.set_state(OrderForm.size)
                await state.update_data(last_product=product)
                return
            else:
                pics = product.get("pictures") or []
                if pics:
                    await msg.answer_photo(pics[0], caption=text, reply_markup=build_nav_kb())
                else:
                    await msg.answer(text, reply_markup=build_nav_kb())

                await state.set_state(OrderForm.amount)
                await state.update_data(last_product=product)
                return

        # якщо sku не було → йдемо в звичайний flow (з ПІБ)
        await msg.answer(
            "📝 Ви почали оформлення замовлення.\nВведіть ваші ПІБ:",
            reply_markup=build_nav_kb()
        )
        await state.set_state(OrderForm.pib)
        return

@router.message(Command("publish_test"))
async def publish_test(msg: Message):
    """
    Тестовий пост у канал з deep link для SKU 1056 (Гольф чорний).
    """
    test_kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="🛒 Замовити Гольф чорний (тест)",
            url="https://t.me/taverna_bot?start=order_test_12345__sku_1056"  # заміни taverna_bot на юзернейм твого бота
        )]
    ])

    text = (
        "🧪 Тестовий пост для перевірки товару:\n\n"
        "👕 Гольф чорний\n"
        "📌 Артикул: 1056\n"
        "💵 Ціна: 350 грн"
    )

    await bot.send_message(
        chat_id=-1001234567890,  # 🔴 заміни на ID твого тестового каналу
        text=text,
        reply_markup=test_kb
    )
    await msg.answer("✅ Тестовий пост опубліковано в каналі.")

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
    kb = get_order_keyboard(post_id=12345, sku="0999", test=True)
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
            await msg.answer("Введіть телефон\n(У форматі: +38(0ХХ)ХХХ ХХ ХХ , 38(0ХХ)ХХХ ХХ ХХ , (0ХХ)ХХХ ХХ ХХ):")
            await push_flow(state, OrderForm.phone)
            await state.set_state(OrderForm.phone)
            return
        else:
            await msg.answer("Нема збереженої пропозиції для підтвердження. Будь ласка, введіть ПІБ у форматі: Прізвище Ім'я По-батькові.")
            return

    parts = text.split()
    if len(parts) != 3:
        await msg.answer("❌ Введіть повністю ваше ПІБ -\n(У форматі: Прізвище Ім'я По-батькові - 3 слова):")
        return

    # перевіряємо, чи всі частини написані кирилицею / містять принаймні 2 символи
    if not all(is_cyrillic_word(p) for p in parts):
        await msg.answer("❌ Кожна частина ПІБ має бути українськими літерами (дозволені дефіси та апостроф).\nСпробуйте ще раз.")
        return

    # якщо третя частина має суфікс по-батькові — приймаємо
    if looks_like_patronymic(parts[2]):
        # приймаємо як валідний ПІБ
        normalized = " ".join([p.strip().title() for p in parts])
        await state.update_data(pib=normalized)
        await msg.answer(
    "📱 Введіть ваш номер телефону\n(У форматі: +38(0ХХ)ХХХ ХХ ХХ , 38(0ХХ)ХХХ ХХ ХХ , (0ХХ)ХХХ ХХ ХХ):",
    reply_markup=build_nav_kb()
)
        await push_flow(state, OrderForm.phone)
        await state.set_state(OrderForm.phone)
        return

    # якщо третя НЕ виглядає як по-батькові, спробуємо запропонувати перестановку, якщо є ознаки по-батькові в іншому місці
    suggested = suggest_reorder_pib(parts)
    if suggested:
        # збережемо пропозицію в state та запропонуємо підтвердження
        await state.update_data(pib_suggestion=suggested)
        await msg.answer(
            f"⚠️ Схоже, по-батькові не на третьому місці.\n"
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
        await msg.answer("❌ Телефон має бути у форматі -\n( +38(0ХХ)ХХХ ХХ ХХ; 38(0ХХ)ХХХ ХХ ХХ; (0ХХ)ХХХ ХХ ХХ ):.")
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
    global PRODUCTS_EXPORT_CACHE
    if PRODUCTS_EXPORT_CACHE and not force:
        return PRODUCTS_EXPORT_CACHE
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(MYDROP_EXPORT_URL) as resp:   # 🔄 тут заміна
                text = await resp.text()
                if not text:
                    raise RuntimeError("Empty export")
                PRODUCTS_EXPORT_CACHE = text
                PRODUCTS_CACHE["last_update"] = datetime.utcnow()   # 🔄 оновлення кешу
                PRODUCTS_CACHE["data"] = text
                logger.info("✅ Завантажено нову вигрузку (%d символів)", len(text))
                build_products_index_from_xml(text)
                return text
    except Exception:
        logger.exception("Помилка завантаження вигрузки")
        return None

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

def _find_first_text(elem, tags: list[str]) -> Optional[str]:
    """
    Шукає перший тег з текстом серед можливих назв.
    Повертає текст або None.
    """
    for t in tags:
        child = elem.find(f".//{t}")
        if child is not None and child.text:
            return child.text.strip()
    return None

def _find_first_numeric(elem, tags: List[str]) -> Optional[float]:
    """
    Шукає перший тег з числом серед можливих назв.
    Повертає float або None.
    """
    for t in tags:
        # шукаємо як піделемент (case-insensitive локальний тег)
        for child in elem.findall(f".//{t}"):
            if child is None or not child.text:
                continue
            txt = child.text.strip().replace(",", ".").replace(" ", "")
            try:
                return float(txt)
            except Exception:
                # якщо не вдалось, пробуємо витягнути число regex-ом
                m = re.search(r"[\d]+(?:[.,]\d+)?", child.text)
                if m:
                    try:
                        return float(m.group(0).replace(",", "."))
                    except:
                        continue
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
    Fast search using PRODUCTS_INDEX if available; otherwise fallback to iterparse.
    Returns product dict or None.
    """
    q = str(query or "").strip()
    if not q:
        return None
    qlow = q.lower().strip()

    # ensure we have index
    if not PRODUCTS_INDEX.get("all_products"):
        text = await load_products_export(force=False)
        if not text:
            return None

    # 1) exact offer_id match
    prod = PRODUCTS_INDEX["by_offer"].get(qlow)
    if prod:
        return prod

    # 2. точний пошук по SKU (враховуємо 0999 vs 999)
    candidates = [qlow]
    if qlow.isdigit():
        candidates.append(qlow.lstrip("0"))  # "0999" -> "999"
    for cand in candidates:
        prod = PRODUCTS_INDEX["by_sku"].get(cand)
        if prod:
            return prod

    # 3) numeric query -> try sku by stripped numeric
    if re.fullmatch(r"\d{2,}", qlow):
        # try zero-padded / same
        k = qlow.lstrip("0")
        for candidate in (qlow, k):
            p = PRODUCTS_INDEX["by_sku"].get(candidate)
            if p:
                return p

    # 4) name exact or substring search: attempt token matching
    qtokens = re.findall(r"[0-9A-Za-z\u0400-\u04FF\-\+]{2,}", qlow)
    if qtokens:
        # try to find products that contain all tokens (intersection)
        sets = []
        for t in qtokens:
            s = PRODUCTS_INDEX["by_name"].get(t)
            if s:
                sets.append(s)
        if sets:
            # intersection of token sets (convert to sku keys)
            candidates = None
            for s in sets:
                if candidates is None:
                    candidates = set(s)
                else:
                    candidates &= set(s)
            # build candidate list of product dicts
            if candidates:
                # find first candidate product in by_sku/by_offer
                for key in candidates:
                    # key might be sku or offer or name token; try lookup
                    p = PRODUCTS_INDEX["by_sku"].get(key) or PRODUCTS_INDEX["by_offer"].get(key)
                    if p:
                        # mark as suggestion if not exact
                        if qlow in (p.get("name","").lower(), p.get("sku","").lower(), p.get("offer_id","").lower()):
                            p["suggestion"] = False
                        else:
                            p["suggestion"] = True
                        return p

    # 5) fallback: full-text scan of name substrings (cheap)
    qshort = qlow
    for p in PRODUCTS_INDEX["all_products"]:
        name = (p.get("name") or "").lower()
        if qshort == name or (qshort in name and len(qshort) >= 3):
            p["suggestion"] = True if qshort not in (p.get("sku","").lower(), p.get("offer_id","").lower()) else False
            return p

    # 6) last resort: try heavy iterparse as before (copy previous behavior)
    try:
        text = PRODUCTS_CACHE.get("data")
        if not text:
            text = await load_products_export()
            if not text:
                return None
        it = ET.iterparse(io.StringIO(text), events=("end",))
        for event, elem in it:
            tag = _local_tag(elem.tag).lower()
            if not (tag.endswith("offer") or tag.endswith("item") or tag.endswith("product")):
                elem.clear()
                continue
            offer_id = (elem.attrib.get("id") or "").strip()
            name = _find_first_text(elem, ["name", "title", "product", "model"]) or ""
            vendor_code = _find_first_text(elem, ["vendorcode", "vendor_code", "sku", "articul", "article", "code"]) or ""
            searchable = " ".join([offer_id.lower(), vendor_code.lower(), name.lower()])
            if qlow in searchable and len(qlow) >= 2:
                # use existing parsing within this block to assemble product dict
                # (for brevity, re-use small subset)
                drop_price = _find_first_numeric(elem, ["price", "cost", "drop", "drop_price"])
                retail_price = _find_first_numeric(elem, ["rrc", "retail", "oldprice"])
                stock_qty = None
                qtxt = _find_first_text(elem, ["quantity_in_stock", "quantity", "stock_qty", "stock", "available_quantity", "count", "amount"])
                if qtxt:
                    qd = re.findall(r'\d+', qtxt.replace(" ", ""))
                    if qd:
                        try: stock_qty = int(qd[0])
                        except: stock_qty = None
                p = {
                  "name": name, "sku": vendor_code or offer_id,
                  "offer_id": offer_id,
                  "drop_price": float(drop_price) if drop_price is not None else None,
                  "retail_price": float(retail_price) if retail_price is not None else None,
                  "final_price": apply_markup(drop_price) if drop_price is not None else None,
                  "stock_text": None, "stock_qty": stock_qty
                }
                elem.clear()
                p["suggestion"] = True
                return p
            elem.clear()
    except Exception:
        logger.exception("fallback iterparse failed in check_article_or_name")

    return None

# ---------------- Helpers: component size search ----------------
COMPONENT_KEYWORDS = ["шап", "шапка", "рукав", "рукави", "рукавиц", "рукавич", "баф", "балаклав", "комплект"]

async def show_product_and_ask_quantity(msg: Message, state: FSMContext, product: Dict[str, Any]):
    """
    Показує фото, назву товару, ціни (дроп і з націнкою),
    доступні розміри або запитує кількість.
    Зберігає у state базову інформацію про product.
    """
    # збережемо в state основні поля
    await state.update_data(
        article=product.get("sku"),
        product_name=product.get("name"),
        stock=product.get("stock_text"),
        stock_qty=product.get("stock_qty"),
        price=product.get("final_price"),
        components=product.get("components")
    )

    # визначимо режим
    sdata = await state.get_data()
    mode = sdata.get("mode", "client")

    def _price_block(prod):
        drop_price = prod.get("drop_price")
        final_price = prod.get("final_price") or (apply_markup(drop_price) if drop_price else None)

        if mode == "test":
            return (
                f"💰 Орієнтовна ціна (з націнкою): {final_price or '—'} грн\n"
                f"💵 Дроп ціна: {drop_price or '—'} грн\n"
            )
        else:
            return f"💰 Ціна для клієнта: {final_price or '—'} грн\n"

    # Надішлемо фото, якщо є
    pic = product.get("picture")
    try:
        if pic:
            pic_url = pic[0] if isinstance(pic, (list, tuple)) else pic
            await bot.send_photo(
                msg.chat.id,
                photo=pic_url,
                caption=(
                    f"📌 <b>{product.get('name') or 'Товар'}</b>\n"
                    f"🆔 Артикул: <b>{product.get('sku') or '—'}</b>"
                ),
                parse_mode=ParseMode.HTML
            )
    except Exception:
        pass  # якщо не вдалось фото — ігноруєм

    stock_text = product.get("stock_text") or "—"
    components = product.get("components")
    sizes = product.get("sizes") or []

    # Якщо є компоненти (наприклад, розміри з опціями)
    if components:
        first = components[0]
        opts = first.get("options") or []
        if opts:
            kb = build_size_keyboard(0, opts)
            await msg.answer(
                f"✅ Знайдено товар:\n"
                f"📌 <b>{product.get('name')}</b>\n"
                f"🆔 Артикул: <b>{product.get('sku') or '—'}</b>\n"
                f"📦 Наявність: <b>{stock_text}</b>\n"
                f"{_price_block(product)}\n"
                f"📏 Виберіть розмір для: <b>{first.get('name') or 'Розмір'}</b>",
                reply_markup=kb
            )
            await state.set_state(OrderForm.size)
            return

    # Якщо немає компонентів — просто показуємо і просимо кількість
    sizes_text = f"\n📏 Розміри: {', '.join(sizes)}" if sizes else ""
    await msg.answer(
        f"✅ Знайдено товар:\n"
        f"📌 <b>{product.get('name')}</b>\n"
        f"🆔 Артикул: <b>{product.get('sku') or '—'}</b>\n"
        f"📦 Наявність: <b>{stock_text}</b>\n"
        f"{_price_block(product)}"
        f"{sizes_text}\n\n"
        "👉 Введіть кількість товару (число):",
    reply_markup=build_nav_kb()
)
    await state.set_state(OrderForm.amount)

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

def aggressive_round(price: float) -> int:
    """
    Aggressive rounding (round up) to 'nice' numbers:
      - <100 -> nearest 5
      - <1000 -> nearest 10
      - <5000 -> nearest 50
      - >=5000 -> nearest 100
    Always rounds UP (ceil) to favor business rounding rules you described.
    """
    if price is None:
        return None
    p = float(price)
    if p < 100:
        base = 5
    elif p < 1000:
        base = 10
    elif p < 5000:
        base = 50
    else:
        base = 100
    return int(math.ceil(p / base) * base)

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
    query = msg.text.strip()

    product = None
    method = None

    # підтримка підтвердження "так"
    if query.lower() == "так":
        data = await state.get_data()
        last_suggestion = data.get("last_suggestion")
        if last_suggestion:
            product = last_suggestion
            method = "last_suggestion"
        else:
            await msg.answer("Нема запропонованого товару для підтвердження — введіть артикул або назву.")
            return
    else:
        # пробуємо знайти по SKU/назві
        product, method = find_product_by_sku(query)
        if product and product.get("suggestion"):
            await state.update_data(last_suggestion=product)

    # показуємо typing
    await bot.send_chat_action(msg.chat.id, "typing")

    if not product:
        await msg.answer("❌ Не знайдено товар. Спробуйте ще раз (артикул або частина назви) або напишіть 'підтримка'.", reply_markup=build_nav_kb())
        return

    # --- режим роботи (test / client) ---
    state_data = await state.get_data()
    mode = state_data.get("mode", "client")

    # якщо це suggestion — пропонуємо підтвердження з кнопкою
    if product.get("suggestion"):
        confirm_hint = "Якщо це те, що треба — натисніть ✅ Підтвердити. Або введіть інший артикул/назву."
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton("✅ Підтвердити", callback_data="article:confirm_exact")],
            [InlineKeyboardButton("⬅️ Назад", callback_data="flow:back_to_start")]
        ])
        text = format_product_message(product, mode=mode, include_intro=False) + "\n\n" + confirm_hint
        if product.get("pictures"):
            await msg.answer_photo(product["pictures"][0], caption=text, reply_markup=kb)
        else:
            await msg.answer(text, reply_markup=kb)
        await state.update_data(last_suggestion=product)
        return

    # --- якщо товар знайдено напряму ---
    text = format_product_message(product, mode=mode, include_intro=True)
    sizes = product.get("sizes") or []

    if sizes:
        buttons = [[InlineKeyboardButton(text=size, callback_data=f"choose_size:{product['sku']}:{size}")] for size in sizes]
        buttons.append([InlineKeyboardButton("⬅️ Назад", callback_data="flow:back_to_start")])
        kb = InlineKeyboardMarkup(inline_keyboard=buttons)
        if product.get("pictures"):
            await msg.answer_photo(product["pictures"][0], caption=text, reply_markup=kb)
        else:
            await msg.answer(text, reply_markup=kb)
        await state.update_data(last_product=product)
        await state.set_state(OrderForm.size)
        return
    else:
        # якщо розмірів нема — запитуємо кількість відразу
        if product.get("pictures"):
            await msg.answer_photo(product["pictures"][0], caption=text, reply_markup=build_nav_kb())
        else:
            await msg.answer(text, reply_markup=build_nav_kb())
        await state.update_data(last_product=product)
        await state.set_state(OrderForm.amount)
        return

def render_product_text(product: dict, mode: str = "client", include_intro: bool = True) -> str:
    """
    Формуємо красивий текст для повідомлення ботом за product dict.
    """
    sku_line = product.get("sku") or product.get("raw_sku") or "—"
    vendor_code = product.get("vendor_code") or sku_line
    name = product.get("name") or "—"
    desc = product.get("description") or ""
    sizes = ", ".join(product.get("sizes", [])) if product.get("sizes") else "—"
    stock_qty = product.get("stock_qty") or 0
    stock_text = "Є ✅" if stock_qty > 0 else "Немає ❌"
    drop_price = product.get("drop_price")
    final_price = None
    if drop_price:
        final_price = aggressive_round(drop_price * 1.33)

    lines = []
    if include_intro:
        lines.append("🧾 Розпочнемо оформлення. Ось вибраний товар:")
    lines.append("✅ Знайдено товар:")
    lines.append(f"📌 Артикул: {sku_line}")
    lines.append(f"📛 Назва: {name}")
    if desc:
        # trim long descriptions
        lines.append(f"📝 Опис: {desc[:400]}{'...' if len(desc) > 400 else ''}")
    lines.append(f"📦 Наявність: {stock_text} (кількість: {stock_qty})")
    lines.append(f"📏 Розміри: {sizes}")
    if mode == "test":
        lines.append(f"💵 Дроп ціна: {drop_price if drop_price is not None else '—'} грн")
        lines.append(f"💰 Орієнтовна ціна (з націнкою): {final_price if final_price is not None else '—'} грн")
    else:
        lines.append(f"💰 Ціна для клієнта: {final_price if final_price is not None else '—'} грн")
    return "\n".join(lines)

@router.callback_query(lambda c: c.data.startswith("choose_size:"))
async def choose_size_handler(callback: CallbackQuery, state: FSMContext):
    try:
        _, raw_sku, size = callback.data.split(":", 2)
    except ValueError:
        await callback.answer("Невірні дані.", show_alert=True)
        return

    product, method = find_product_by_sku(raw_sku)
    if not product:
        await callback.answer("⚠️ Товар не знайдено.", show_alert=True)
        return

    sku_norm = product.get("sku") or product.get("raw_sku") or raw_sku
    # зберігаємо вибір користувача
    await state.update_data(selected_size=size, sku=sku_norm, last_selected_product=product)

    # показуємо кнопку продовжити / назад
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Продовжити", callback_data=f"size:continue:{sku_norm}")],
        [InlineKeyboardButton(text="⬅️ Назад", callback_data="flow:back_to_start")]
    ])

    await callback.message.answer(f"Ви вибрали розмір: {size}. Натисніть ✅ Продовжити, щоб ввести кількість.", reply_markup=kb)
    await callback.answer()

@router.callback_query(lambda c: c.data.startswith("size:continue:"))
async def size_continue_handler(cb: CallbackQuery, state: FSMContext):
    try:
        _, _, sku = cb.data.split(":", 2)
    except ValueError:
        await cb.answer("Невірні дані.", show_alert=True)
        return
    await state.update_data(sku=sku)
    await cb.message.answer("👉 Введіть кількість товару (число):",
    reply_markup=build_nav_kb()
)
    await state.set_state(OrderForm.amount)
    await cb.answer()

# Обробник вибору розміру
@router.callback_query(lambda c: c.data and c.data.startswith("choose_size:"))
async def cb_choose_size(query: CallbackQuery, state: FSMContext):
    # формат: choose_size:<sku>:<size>
    try:
        _, sku, size = query.data.split(":", 2)
    except Exception:
        await query.answer("Невірні дані", show_alert=True)
        return

    product, method = find_product_by_sku(sku)
    if not product:
        await query.answer("Товар не знайдено", show_alert=True)
        return

    # зберігаємо вибраний розмір
    await state.update_data(last_product=product, chosen_size=size)
    # видаляємо клавіатуру розмірів
    try:
        await query.message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass

    await query.message.answer(f"Ви обрали розмір: {size}\n\n👉 Введіть кількість товару (число):",
    reply_markup=build_nav_kb()
)
    await state.set_state(OrderForm.amount)
    await query.answer()

# Обробник натискання "підтвердити" з suggestion
@router.callback_query(lambda c: c.data == "article:confirm")
async def cb_article_confirm(query: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    product = data.get("last_suggestion")
    if not product:
        await query.answer("Нема товару для підтвердження", show_alert=True)
        return

    # якщо є розміри — переводимо на вибір розміру, інакше — на введення кількості
    sizes = product.get("sizes") or []
    if sizes:
        buttons = [[InlineKeyboardButton(text=size, callback_data=f"choose_size:{product['sku']}:{size}")] for size in sizes]
        kb = build_nav_kb(extra_buttons=buttons)
        if product.get("pictures"):
            await query.message.answer_photo(product["pictures"][0], caption=format_product_message(product, mode=(await state.get_data()).get("mode", "client"), include_intro=False), reply_markup=kb)
        else:
            await query.message.answer(format_product_message(product, mode=(await state.get_data()).get("mode", "client"), include_intro=False), reply_markup=kb)
        await state.set_state(OrderForm.size)
        await query.answer()
        return
    else:
        await query.message.answer(format_product_message(product, mode=(await state.get_data()).get("mode", "client"), include_intro=False) + "\n\n👉 Введіть кількість товару (число):",
    reply_markup=build_nav_kb()
)
        await state.set_state(OrderForm.amount)
        await query.answer()
        return

async def cb_suggest_back(cb: CallbackQuery, state: FSMContext):
    # ask to enter article/name again
    await state.update_data(last_suggestion=None)
    await cb.message.answer("🔙 Повернулись назад. Введіть артикул або назву товару:")
    await state.set_state(OrderForm.article)
    await cb.answer()

# CART helpers (store in state or in memory for multi-session)
def render_cart_text(cart_items: list):
    """
    cart_items: list of dict {sku, name, size_text, qty, unit_price}
    """
    if not cart_items:
        return "🛒 Ваша корзина порожня."
    lines = ["🛒 Ваша корзина:"]
    total = 0
    for it in cart_items:
        unit = it.get("unit_price") or 0
        qty = int(it.get("qty") or 1)
        sum_item = unit * qty
        total += sum_item
        lines.append(f"- {it.get('name')} ({it.get('size_text','-')}) — {unit} грн × {qty} = {sum_item} грн")
    lines.append(f"\n🔢 Загальна сума: {total} грн")
    lines.append("\n❌ Натисніть щоб повністю скасувати замовлення: /cancel_order")
    return "\n".join(lines)

def cart_footer_kb(total: int):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"🛒 ВАША КОРЗИНА — Загальна: {total} грн", callback_data="cart:show")],
        [InlineKeyboardButton(text="❌ Повністю скасувати замовлення", callback_data="cart:clear")]
    ])

# Add small handlers:
@router.callback_query(F.data == "cart:view")
async def cb_cart_view(cb: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    cart_items = data.get("cart_items") or []
    text = render_cart_text(cart_items)
    await cb.message.answer(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Повністю скасувати замовлення", callback_data="cart:clear")],
        [InlineKeyboardButton(text="↩️ Продовжити оформлення", callback_data="cart:continue")]
    ]))
    await cb.answer()

@router.callback_query(F.data == "cart:clear")
async def cb_cart_clear(cb: CallbackQuery, state: FSMContext):
    await state.update_data(cart_items=[])
    await cb.message.answer("🗑️ Замовлення скасовано і корзина очищена.")
    await cb.answer()

@router.callback_query(F.data == "cart:continue")
async def cb_cart_continue(cb: CallbackQuery, state: FSMContext):
    # Continue checkout: e.g., ask for delivery
    await cb.message.answer("Продовжуємо оформлення — оберіть службу доставки:", reply_markup=delivery_keyboard())
    await state.set_state(OrderForm.delivery)
    await cb.answer()

async def resolve_callback_chat_id(cb: CallbackQuery, state: Optional[FSMContext] = None) -> Optional[int]:
    """
    Безпечний спосіб дістати chat_id у callback'ах.
    Перевага: намагаємось взяти з state.data['chat_id'], якщо нема — беремо cb.from_user.id, якщо і цього нема — cb.message.chat.id.
    Повертає None якщо нічого не вдалось дістати.
    """
    data = {}
    try:
        if state is not None:
            data = await state.get_data() or {}
    except Exception:
        # state може бути None або недоступний у цьому контексті
        data = {}

    chat_id = data.get("chat_id")
    if not chat_id:
        # пріоритет — відправник callback (звичайний випадок)
        try:
            chat_id = cb.from_user.id
        except Exception:
            chat_id = None

    # fallback — якщо callback прив'язаний до повідомлення в чаті
    if not chat_id:
        try:
            chat_id = cb.message.chat.id
        except Exception:
            chat_id = None

    return chat_id

async def add_product_to_cart(state: FSMContext, product: dict, size_text: str, qty: int, chat_id: Optional[int] = None):
    """Додає товар у кошик, зберігає у state і оновлює (або створює) footer-повідомлення з підсумком.

    - state: FSMContext поточного користувача
    - product: dict (має містити принаймні 'sku','name','final_price')
    - size_text: текст розмірів/опцій для цієї позиції
    - qty: кількість (int)
    - chat_id: необов'язково — chat id для редагування/створення footer; якщо не передано, спробуємо взяти з state
    """
    data = await state.get_data()
    # знайдемо chat_id: найперше від переданого параметру, інакше з state
    chat_id = chat_id or data.get("chat_id") or data.get("user_chat_id") or data.get("pib_chat")

    cart = data.get("cart_items") or []
    try:
        unit_price = int(round(float(product.get("final_price") or 0)))
    except Exception:
        unit_price = 0

    item = {
        "sku": product.get("sku") or "",
        "name": product.get("name") or product.get("title") or "Товар",
        "size_text": size_text or "—",
        "qty": int(qty or 1),
        "unit_price": unit_price
    }
    cart.append(item)
    await state.update_data(cart_items=cart)

    # підсумок
    total = sum(int(it.get("unit_price", 0)) * int(it.get("qty", 1)) for it in cart)

    # Оновлюємо футер: пріоритет - ensure_or_update_cart_footer(chat_id) (якщо визначена),
    # інакше робимо fallback з USER_CART_MSG / cart_footer_kb.
    try:
        if chat_id is None:
            logger.warning("add_product_to_cart: chat_id not found in state or args — footer не буде відредаговано")
            return

        # якщо в коді є функція ensure_or_update_cart_footer — використовуємо її
        if "ensure_or_update_cart_footer" in globals():
            await ensure_or_update_cart_footer(chat_id)
            return

        # fallback: вручну створюємо/редагуємо footer
        kb = cart_footer_kb(total) if "cart_footer_kb" in globals() else InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=f"🧾 ТУТ ВАША КОРЗИНА — Загальна: {total} грн", callback_data="cart:view")],
        ])

        meta = USER_CART_MSG.get(chat_id)
        if meta:
            try:
                await bot.edit_message_text(
                    f"🧾 Ваша корзина — Загальна сума: {total} грн",
                    chat_id=meta["chat_id"],
                    message_id=meta["message_id"],
                    reply_markup=kb
                )
                return
            except Exception:
                USER_CART_MSG.pop(chat_id, None)

        sent = await bot.send_message(chat_id, f"🧾 Ваша корзина — Загальна сума: {total} грн", reply_markup=kb)
        USER_CART_MSG[chat_id] = {"chat_id": sent.chat.id, "message_id": sent.message_id}
    except Exception:
        logger.exception("add_product_to_cart: failed to update/send footer")

# --- Обробник вибору розміру через inline-кнопки (оновлений UX: Continue / Edit) ---
@router.callback_query(F.data == "sizes:continue")
async def cb_sizes_continue(cb: CallbackQuery, state: FSMContext):
    # користувач підтвердив розміри — просимо кількість
    await cb.answer()
    await cb.message.answer("👉 Введіть кількість товару (число):",
    reply_markup=build_nav_kb()
)
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

@router.callback_query(F.data == "article:confirm")
async def cb_article_confirm(cb: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    product = data.get("last_suggestion") or data.get("last_found_product")
    if not product:
        await cb.answer("Нема товару для підтвердження.")
        return
    # Зберігаємо в state і переходимо до вибору розмірів/кількості
    await state.update_data(article=product.get("sku") or product.get("offer_id"), product_name=product.get("name"), components=product.get("components"), price=product.get("final_price"), drop_price=product.get("drop_price"))
    await cb.message.answer("Товар підтверджено. Далі — вибір розмірів (якщо є) або кількості.")
    # позиція: повторити логіку в state_article для початку size/amount flow
    # наприклад викликати функцію start_size_flow(cb.message, state, product)
    await cb.answer()

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

def load_cart(chat_id: int) -> Dict[str, Any]:
    """Повертає dict {'items': [...]}. Якщо немає — повертає {'items':[]}."""
    try:
        f = Path(ORDERS_DIR) / f"cart_{chat_id}.json"
        if f.exists():
            return json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("load_cart failed for %s", chat_id)
    return {"items": []}

def save_cart(chat_id: int, cart_obj: Dict[str, Any]) -> None:
    try:
        f = Path(ORDERS_DIR) / f"cart_{chat_id}.json"
        f.write_text(json.dumps(cart_obj, ensure_ascii=False), encoding="utf-8")
    except Exception:
        logger.exception("save_cart failed for %s", chat_id)

# ---------- Unified async function to add product to cart ----------
async def add_product_to_cart(state: FSMContext, product: Dict[str, Any], size_text: str, qty: int, chat_id: Optional[int] = None) -> Dict[str, Any]:
    """
    Додає товар у корзину користувача.
    - state: FSMContext (щоб працювати з даними сесії)
    - product: dict із ключами name, sku, final_price (або price)
    - size_text: рядок/опис розмірів (наприклад: "Штани: 48, Футболка: M")
    - qty: кількість (int)
    - chat_id: необов'язково — якщо не переданий, спробуємо знайти у state.data
    Повертає оновлений cart dict (structure {'items': [...]})
    """
    data = await state.get_data()
    # визначаємо chat_id
    c_id = chat_id or data.get("chat_id") or data.get("user_chat_id") or (data.get("from_user_id") if data.get("from_user_id") else None)
    if not c_id:
        # на випадок, коли немає chat_id — від user object з state або помилка
        # спробуємо з message context з state (зазвичай хендлери викликають цю функцію всередині message/callback, тому має бути доступ)
        # якщо немає — кидаємо ValueError
        raise ValueError("chat_id not found: передайте chat_id у виклик add_product_to_cart або збережіть його у state")

    # сформуємо item
    unit_price = product.get("final_price") or product.get("price") or 0
    try:
        unit_price = int(unit_price)
    except Exception:
        try:
            unit_price = int(float(unit_price))
        except Exception:
            unit_price = 0

    item = {
        "sku": product.get("sku") or "",
        "name": product.get("name") or "",
        "sizes": size_text or "—",
        "qty": int(qty),
        "unit_price": unit_price,
        "drop_price": product.get("drop_price"),
        "added_at": datetime.now().isoformat()
    }

    # завантажимо існуючу корзину, додамо позицію, збережемо
    cart_obj = load_cart(c_id)
    items = cart_obj.get("items") or []
    items.append(item)
    cart_obj["items"] = items
    save_cart(c_id, cart_obj)

    # оновлюємо в state (щоб інші частини коду бачили поточну корзину)
    await state.update_data(cart_items=items)

    # оновлюємо/створюємо футер-кнопку корзини в чаті
    try:
        await ensure_or_update_cart_footer(c_id)
    except Exception:
        logger.exception("Failed to update_or_send_cart_footer after add_product_to_cart for %s", c_id)

    return cart_obj

@router.callback_query(F.data == "suggest:confirm")
async def suggest_confirm(cb: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    last = data.get("last_suggestion")
    if not last:
        await cb.answer("Нема даних для підтвердження.")
        return
    # treat last as confirmed product
    await state.update_data(article=last.get("sku") or last.get("offer_id"), product_name=last.get("name"), components=last.get("components"), price=last.get("final_price"), stock=last.get("stock"))
    await cb.message.answer("✅ Товар підтверджено. Продовжимо оформлення.")
    # продовжити: якщо є компоненти — показати перший, інакше запит кількості
    comps = last.get("components") or []
    if comps:
        first = comps[0]
        opts = first.get("options") or []
        if opts:
            kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=str(opt), callback_data=f"size:0:{i}")] for i,opt in enumerate(opts)] + [[InlineKeyboardButton(text="❌ Скасувати", callback_data="order:cancel")]])
            await cb.message.answer(f"📏 Виберіть розмір для: <b>{first['name']}</b>", reply_markup=kb)
            await state.set_state(OrderForm.size)
            await cb.answer()
            return
    # інакше — питати кількість
    await cb.message.answer("👉 Введіть кількість товару (число):",
    reply_markup=build_nav_kb()
)
    await state.set_state(OrderForm.amount)
    await cb.answer()

@router.callback_query(F.data == "nav:enter_article")
async def nav_enter_article(cb: CallbackQuery, state: FSMContext):
    await state.set_state(OrderForm.article)
    await cb.message.answer("🔍 Введіть артикул або назву товару для пошуку:")
    await cb.answer()

@router.callback_query(F.data == "nav:back_to_article")
async def nav_back_to_article(cb: CallbackQuery, state: FSMContext):
    await state.set_state(OrderForm.article)
    await cb.message.answer("↩️ Повернулися — введіть артикул або назву товару:")
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
                "👉 Введіть кількість товару (число):",
    reply_markup=build_nav_kb()
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
        "👉 Введіть кількість товару (число):",
    reply_markup=build_nav_kb()
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
        await cb.message.answer("Повернулись.📝 Введіть ваше ПІБ:",
    reply_markup=build_nav_kb()
)
    elif to == "phone":
        await push_flow(state, OrderForm.phone)
        await state.set_state(OrderForm.phone)
        await cb.message.answer("Повернулись.📱 Введіть телефон:",
    reply_markup=build_nav_kb()
)
    elif to == "article":
        await state.set_state(OrderForm.article)
        await cb.message.answer("Повернулись. Введіть 🆔 артикул або  🔖 назву товару:",
    reply_markup=build_nav_kb()
)
    elif to == "amount":
        await state.set_state(OrderForm.amount)
        await cb.message.answer("Повернулись. Введіть кількість товару:",
    reply_markup=build_nav_kb()
)
    else:
        await state.set_state(OrderForm.article)
        await cb.message.answer("Повернулись. Введіть 🆔 артикул або  🔖 назву товару:",
    reply_markup=build_nav_kb()
)
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
                "👉 Введіть кількість товару (число):",
    reply_markup=build_nav_kb()
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
        "👉 Введіть кількість товару (число):",
    reply_markup=build_nav_kb()
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
        await cb.message.answer("Повернулись.📝 Введіть ваше ПІБ:",
    reply_markup=build_nav_kb()
)
    elif to == "phone":
        await state.set_state(OrderForm.phone)
        await cb.message.answer("Повернулись.📱 Введіть телефон:",
    reply_markup=build_nav_kb()
)
    elif to == "article":
        await state.set_state(OrderForm.article)
        await cb.message.answer("Повернулись. Введіть 🆔 артикул або  🔖 назву товару:",
    reply_markup=build_nav_kb()
)
    elif to == "amount":
        await state.set_state(OrderForm.amount)
        await cb.message.answer("Повернулись. Введіть кількість товару:",
    reply_markup=build_nav_kb()
)
    else:
        await state.set_state(OrderForm.article)
        await cb.message.answer("Повернулись. Введіть 🆔 артикул або  🔖 назву товару:",
    reply_markup=build_nav_kb()
)
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

# ---------------- Cart: clear ----------------
@router.callback_query(F.data == "cart:clear")
async def cart_clear(cb: CallbackQuery, state: FSMContext):
    # Беремо chat id з cb (надійно), не використовуємо walrus
    chat_id = None
    try:
        data = await state.get_data()
    except Exception:
        data = {}

    chat_id = data.get("chat_id") or (cb.from_user.id if hasattr(cb, "from_user") else None)
    if chat_id is None:
        # fallback: якщо не вдалось визначити - використаємо cb.message.chat.id
        try:
            chat_id = cb.message.chat.id
        except Exception:
            chat_id = None

    if chat_id is not None:
        clear_cart(chat_id)

        # видаляємо footer повідомлення, якщо воно збережено
        meta = USER_CART_MSG.pop(chat_id, None)
        if meta:
            try:
                await bot.delete_message(meta.get("chat_id", chat_id), meta.get("message_id"))
            except Exception:
                # не критично — ігноруємо
                pass

    await cb.message.answer("❌ Замовлення повністю скасовано. Можете почати оформлення заново.")
    await cb.answer()

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
        lines.append(
            f"{i}. {it.get('name','Товар')} ({sizes_txt}) — {price} грн × {qty} = "
            f"{int(price)*int(qty) if isinstance(price,(int,float)) or str(price).isdigit() else '—'}"
        )
    total = cart_total(cart_items)
    lines.append(f"\n💰 Загальна сума: {total} грн.")
    lines.append("\nДля повного скасування натисніть: ❌ Повністю скасувати замовлення")
    return "\n".join(lines)

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
        await msg.answer("📍 Введіть адресу або відділення служби доставки:", reply_markup=build_nav_kb())
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
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton("Оплата при отриманні", callback_data="payment:cod")],
        [InlineKeyboardButton("Передплата на карту", callback_data="payment:prepay")],
] + build_nav_kb().inline_keyboard)
    await msg.answer("💳 Оберіть спосіб оплати:", reply_markup=kb)
    await state.set_state(OrderForm.note)
    await cb.answer()

# --- Примітка ---
@router.message(OrderForm.note)
async def state_note(msg: Message, state: FSMContext):
    note = msg.text.strip()
    await state.update_data(note=note)
    await msg.answer(
    "📝 Додайте примітку до замовлення\n(або натисніть 'Пропустити'):",
    reply_markup=build_nav_kb(extra_buttons=[
        [InlineKeyboardButton("⏭ Пропустити", callback_data="notes:skip")]
    ])
)
    await state.set_state(OrderForm.confirm)

# --- Підтвердження (оновлений — показує selected_sizes якщо є) ---
@router.callback_query(F.data == "order:confirm")
async def cb_order_confirm(cb: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    mode = data.get("mode", "client")
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

    # показуємо підсумок користувачу
    try:
        await cb.message.edit_text(order_text, reply_markup=None)
    except Exception:
        await cb.message.answer(order_text)
    await cb.answer()

    # TEST mode: не відправляємо в MyDrop, а надсилаємо адміну для перевірки/підтвердження
    if mode == "test":
        payload_for_prefill = dict(data)
        payload_for_prefill["selected_sizes"] = selected_sizes
        # формуємо посилання для відкриття у MyDrop (наприклад)
        link = f"https://mydrop.com.ua/orders/new?prefill={json.dumps(payload_for_prefill, ensure_ascii=False)}"
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔗 Відкрити форму MyDrop (prefill)", url=link)]
        ])
        # Надсилаємо адміну повний текст для перевірки + посилання на prefill
        await bot.send_message(REVIEW_CHAT, f"🛠 Перевірка замовлення (TEST MODE):\n\n{order_text}", reply_markup=kb)
        # повідомляємо користувачу
        await bot.send_message(cb.from_user.id, "✅ Замовлення надіслано адміністратору для перевірки. Ви отримаєте відповідь незабаром.")
        # Очистити state (але зберегти, якщо потрібно)
        await state.clear()
        return

    # CLIENT mode: створюємо замовлення в MyDrop як раніше (фонова задача)
    payload = dict(data)
    payload["selected_sizes"] = selected_sizes
    asyncio.create_task(create_mydrop_order(payload, notify_chat=ADMIN_ID))
    await bot.send_message(cb.from_user.id, "✅ Замовлення відправлено. Очікуйте підтвердження.")
    await state.clear()

@router.callback_query(F.data == "order:cancel")
async def cb_order_cancel(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    await cb.message.edit_text("Замовлення скасовано.")
    await cb.answer()

@router.callback_query(F.data.startswith("article:confirm_exact"))
async def cb_confirm_exact(call: CallbackQuery, state: FSMContext):
    """
    Обробка підтвердження товару після точного пошуку.
    Якщо є розміри → показуємо вибір розміру.
    Якщо немає → одразу питаємо кількість.
    """
    data = await state.get_data()
    product = data.get("last_product")

    if not product:
        await call.answer("⚠️ Продукт не знайдено у стані. Почніть заново.", show_alert=True)
        await state.set_state(OrderForm.article)
        return

    # --- підготовка тексту ---
    mode = data.get("mode", "client")
    text = format_product_message(product, mode=mode, include_intro=True)

    sizes = product.get("sizes") or []
    if sizes:
        # будуємо клавіатуру з кнопками розмірів
        buttons = [[InlineKeyboardButton(text=size,
                                         callback_data=f"choose_size:{product['sku']}:{size}")]
                   for size in sizes]
        buttons.append([InlineKeyboardButton("⬅️ Назад", callback_data="flow:back_to_start")])
        kb = InlineKeyboardMarkup(inline_keyboard=buttons)

        if product.get("pictures"):
            await call.message.answer_photo(product["pictures"][0], caption=text, reply_markup=kb)
        else:
            await call.message.answer(text, reply_markup=kb)

        await state.set_state(OrderForm.size)
    else:
        # якщо немає розмірів → одразу питаємо кількість
        if product.get("pictures"):
            await call.message.answer_photo(product["pictures"][0], caption=text)
        else:
            await call.message.answer(text)

        await state.set_state(OrderForm.amount)

    await call.answer()

@router.message(OrderForm.confirm)
async def state_confirm(msg: Message, state: FSMContext):
    data = await state.get_data()

    # збираємо всі дані з state (спрощено для прикладу)
    pib = data.get("pib", "—")
    phone = data.get("phone", "—")
    product = data.get("last_product", {})
    size = data.get("size", "—")
    amount = data.get("amount", 1)
    address = data.get("address", "—")

    sku = product.get("sku") or product.get("raw_sku") or "—"
    name = product.get("name") or "—"
    final_price = aggressive_round((product.get("drop_price") or 0) * 1.33) * int(amount)

    summary = (
        "🧾 Підсумок замовлення:\n\n"
        f"👤 ПІБ: {pib}\n"
        f"📱 Телефон: {phone}\n"
        f"📌 Артикул: {sku}\n"
        f"📛 Назва: {name}\n"
        f"📏 Розмір: {size}\n"
        f"🔢 Кількість: {amount}\n"
        f"🏠 Адреса: {address}\n\n"
        f"💰 Сума до сплати: {final_price} грн"
    )

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton("✅ Підтвердити замовлення", callback_data="confirm:ok")],
    ] + build_nav_kb().inline_keyboard)

    if product.get("pictures"):
        await msg.answer_photo(product["pictures"][0], caption=summary, reply_markup=kb)
    else:
        await msg.answer(summary, reply_markup=kb)

@router.callback_query(F.data == "confirm:ok")
async def cb_confirm_ok(call: CallbackQuery, state: FSMContext):
    data = await state.get_data()

    # TODO: інтеграція з MyDrop (або тестовий лог для початку)
    logger.info("✅ Замовлення підтверджено: %s", data)

    await call.message.answer("✅ Дякуємо! Ваше замовлення прийнято.")
    await state.clear()

@router.callback_query(F.data == "article:confirm_exact")
async def cb_article_confirm_exact(call: CallbackQuery, state: FSMContext):
    await call.answer()
    data = await state.get_data()
    product = data.get("last_suggestion") or data.get("last_product")
    if not product:
        await call.message.answer("Нема товару для підтвердження.")
        return

    sizes = product.get("sizes") or []
    if sizes:
        # показати вибір розміру
        buttons = [[InlineKeyboardButton(text=size, callback_data=f"choose_size:{product['sku']}:{size}")] for size in sizes]
        buttons.append([InlineKeyboardButton("⬅️ Назад", callback_data="flow:back_to_start")])
        kb = InlineKeyboardMarkup(inline_keyboard=buttons)
        await call.message.answer("Оберіть розмір:", reply_markup=kb)
        await state.update_data(last_product=product)
        await state.set_state(OrderForm.size)
    else:
        # без розмірів — питаємо кількість
        await call.message.answer("👉 Введіть кількість товару (число):", reply_markup=build_nav_kb())
        await state.update_data(last_product=product)
        await state.set_state(OrderForm.amount)

@router.callback_query(F.data == "flow:back_to_start")
async def cb_back_to_start(call: CallbackQuery, state: FSMContext):
    await call.answer()
    prev = await pop_flow(state)
    if prev:
        # prev — це ім'я стану, встановлюємо його
        await state.set_state(prev)
        await call.message.answer("Повертаюсь назад...")
    else:
        await call.message.answer("Нема куди повертатися — починаємо спочатку.")
        await state.clear()

@router.callback_query(F.data == "flow:cancel_order")
async def cb_cancel_order(call: CallbackQuery, state: FSMContext):
    await call.answer()
    await state.clear()
    await call.message.answer("❌ Замовлення скасовано. Якщо бажаєте — почніть знову /start.")

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
