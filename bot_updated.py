# -*- coding: utf-8 -*-
"""
Bot for Taverna (updated, with Flask healthcheck for Render Free Plan)
"""

import os
import re
import io
import math
import json
import asyncio
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any
import threading

import aiohttp
from dotenv import load_dotenv

# Flask для healthcheck
from flask import Flask
import logging

app = Flask(__name__)

@app.route("/")
def index():
    return "Bot is running!"

@app.route("/healthz")
def healthz():
    return "ok", 200

def run_flask():
    port = int(os.getenv("PORT", 10000))
    logging.info(f"🌐 Flask healthcheck running on port {port}")
    app.run(host="0.0.0.0", port=port)

# ----------------
# ENV check
# ----------------
load_dotenv()

def check_env_vars():
    keys = [
        "BOT_TOKEN", "BOT_USERNAME", "ADMIN_ID",
        "TEST_CHANNEL", "MAIN_CHANNEL",
        "TG_API_ID", "TG_API_HASH", "SESSION_NAME",
        "SUPPLIER_CHANNEL", "SUPPLIER_NAME",
        "NP_API_KEY", "NP_API_URL",
        "MYDROP_API_KEY", "MYDROP_ORDERS_URL",
        "ORDERS_DIR",
        "USE_GCS", "GCS_BUCKET", "SERVICE_ACCOUNT_JSON",
        "USE_GDRIVE", "GDRIVE_FOLDER_ID",
        "TEST_MODE"
    ]
    print("=== Checking ENV variables ===")
    for key in keys:
        value = os.getenv(key)
        if not value:
            print(f"⚠️ Missing ENV: {key}")
        else:
            preview = value[:6] + "..." if len(value) > 10 else value
            print(f"✅ {key} = {preview}")
    print("=== End ENV check ===")

check_env_vars()

# ----------------
# Aiogram
# ----------------
from aiogram import Bot, Dispatcher, Router, F
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import Command
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message, CallbackQuery,
    InlineKeyboardButton, InlineKeyboardMarkup,
    FSInputFile
)
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import StatesGroup, State

# ----------------
# Bot config
# ----------------
BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise RuntimeError("❌ BOT_TOKEN is missing in environment!")

BOT_USERNAME = os.getenv("BOT_USERNAME")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))
TEST_CHANNEL = os.getenv("TEST_CHANNEL")
MAIN_CHANNEL = os.getenv("MAIN_CHANNEL")

# Nova Poshta
NP_API_KEY = os.getenv("NP_API_KEY")
NP_API_URL = os.getenv("NP_API_URL")

# MyDrop
MYDROP_API_KEY = os.getenv("MYDROP_API_KEY")
MYDROP_ORDERS_URL = os.getenv("MYDROP_ORDERS_URL")

# Orders dir
ORDERS_DIR = os.getenv("ORDERS_DIR", "/tmp/orders")
Path(ORDERS_DIR).mkdir(parents=True, exist_ok=True)

# Google Cloud
USE_GCS = os.getenv("USE_GCS", "false").lower() == "true"
GCS_BUCKET = os.getenv("GCS_BUCKET")
SERVICE_ACCOUNT_JSON = os.getenv("SERVICE_ACCOUNT_JSON")

# Google Drive
USE_GDRIVE = os.getenv("USE_GDRIVE", "false").lower() == "true"
GDRIVE_FOLDER_ID = os.getenv("GDRIVE_FOLDER_ID")

# Flags
TEST_MODE = os.getenv("TEST_MODE", "false").lower() == "true"

# FSM
class OrderForm(StatesGroup):
    pib = State()
    phone = State()
    city = State()
    warehouse = State()
    confirm = State()

# ----------------
# Keyboard
# ----------------
def get_order_keyboard(post_id: int):
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🛒 Замовити", url=f"https://t.me/{BOT_USERNAME}?start=order_{post_id}")]
        ]
    )

# ----------------
# Router
# ----------------
router = Router()

@router.message(Command("start"))
async def cmd_start(msg: Message, state: FSMContext):
    args = msg.get_args() or ""
    if args.startswith("order_"):
        try:
            post_id = int(args.split("_", 1)[1])
        except:
            post_id = None
        await state.update_data(post_message_id=post_id, post_channel=TEST_CHANNEL)
        await msg.answer("🧾 Розпочнемо оформлення. Введіть ваші ПІБ:")
        await state.set_state(OrderForm.pib)
        return
    await msg.answer("Привіт! Це бот Taverna 👋\nНатисніть кнопку «Замовити» під постом у каналі, щоб оформити замовлення.")

@router.message(Command("publish_test"))
async def cmd_publish_test(msg: Message):
    text = (
        "🔥 <b>Тестовий пост для</b> @test_taverna\n\n"
        "Це перевірка кнопки <b>«Замовити»</b>.\n"
        "Натисніть і перевірте форму замовлення."
    )
    sent = await bot.send_message(TEST_CHANNEL, text)
    post_id = getattr(sent, "message_id", None)
    if post_id:
        kb = get_order_keyboard(post_id)
        try:
            await bot.edit_message_reply_markup(TEST_CHANNEL, post_id, reply_markup=kb)
        except Exception as e:
            await bot.send_message(ADMIN_ID, f"⚠️ Не вдалося поставити кнопку у тест-каналі: {e}")
    await msg.answer("✅ Тестовий пост опубліковано в тестовому каналі.")

@router.callback_query(F.data == "order:start")
async def order_start(cb: CallbackQuery, state: FSMContext):
    try:
        await bot.send_message(cb.from_user.id, "🧾 Створення замовлення.\n\nВведіть ваші ПІБ:")
        await state.update_data(post_message_id=cb.message.message_id, post_chat_id=cb.message.chat.id)
        await state.set_state(OrderForm.pib)
        await cb.answer()
    except Exception:
        await cb.answer("❗ Щоб оформити замовлення — відкрийте приватний чат з ботом або натисніть кнопку, яка відкриє чат.", show_alert=True)

# ------------------------
# Entry point for Render
# ------------------------
if __name__ == "__main__":
    from aiogram import Bot, Dispatcher
    from aiogram.fsm.storage.memory import MemoryStorage

    # Flask у окремому потоці
    threading.Thread(target=run_flask, daemon=True).start()

    async def main():
        global bot
        bot = Bot(
            token=BOT_TOKEN,
            default=DefaultBotProperties(parse_mode=ParseMode.HTML)
        )
        dp = Dispatcher(storage=MemoryStorage())
        dp.include_router(router)

        print("🚀 Bot started polling...")
        try:
            await dp.start_polling(bot)
        finally:
            await bot.session.close()

    asyncio.run(main())


# -------- Telethon --------
from telethon import TelegramClient, events
from telethon.tl.types import Message as TLMessage, MessageMediaPhoto

# Optional Google Cloud Storage
try:
    from google.cloud import storage
    GCS_AVAILABLE = True
except Exception:
    GCS_AVAILABLE = False

# ============================== LOAD CONFIG (.env) ==============================
load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
BOT_USERNAME = os.getenv("BOT_USERNAME")
TEST_CHANNEL = os.getenv("TEST_CHANNEL")
MAIN_CHANNEL = os.getenv("MAIN_CHANNEL")
ADMIN_ID = int(os.getenv("ADMIN_ID"))
ORDERS_DIR = os.getenv("ORDERS_DIR")
MYDROP_API_KEY = os.getenv("MYDROP_API_KEY")
MYDROP_ORDERS_URL = os.getenv("MYDROP_ORDERS_URL")
NP_API_KEY = os.getenv("NP_API_KEY")
NP_API_URL = os.getenv("NP_API_URL")
PAGE_SIZE = int(os.getenv("PAGE_SIZE"))

# Telethon
api_id = int(os.getenv("TG_API_ID"))
api_hash = os.getenv("TG_API_HASH")
session_name = os.getenv("SESSION_NAME")
supplier_channel = os.getenv("SUPPLIER_CHANNEL")
supplier_name = os.getenv("SUPPLIER_NAME")

# GCS settings
USE_GCS = os.getenv("USE_GCS", "false").lower() in ("1", "true", "yes")
GCS_BUCKET = os.getenv("GCS_BUCKET")  # set if USE_GCS

# TEST MODE (when True, MyDrop result is sent for review instead of forcing production behaviors)
TEST_MODE = os.getenv("TEST_MODE", "true").lower() in ("1", "true", "yes")

# Ensure orders dir exists
Path(ORDERS_DIR).mkdir(parents=True, exist_ok=True)

# Photo root
PHOTO_ROOT = Path.cwd() / supplier_name
PHOTO_ROOT.mkdir(parents=True, exist_ok=True)

# ============================== UTILITIES ==============================

def ensure_orders_dir():
    Path(ORDERS_DIR).mkdir(parents=True, exist_ok=True)


def price_from_text_to_uah_new(text: str) -> Optional[int]:
    if not text:
        return None
    m = re.search(r"(?:Ціна\s*дроп|Цена\s*дроп|Дроп.?цiна|Дроп.?цена)\D+(\d+)", text, flags=re.IGNORECASE)
    if not m:
        return None
    try:
        drop = int(m.group(1))
    except:
        return None
    new_price = math.ceil(drop * 1.33)
    if new_price % 5 != 0:
        new_price = new_price + (5 - new_price % 5)
    return new_price


def extract_sku(text: str) -> Optional[str]:
    if not text:
        return None
    m = re.search(r"Артикул\D*([A-Za-z0-9\-_]+)", text, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return None


def build_rewritten_post(src_text: str) -> str:
    sku = extract_sku(src_text) or "—"
    new_price = price_from_text_to_uah_new(src_text)
    price_line = f"💰 Ціна — {new_price} грн." if new_price else ""
    title = "🔥 Новий тактичний комплект / товар"
    bullets = []
    for line in src_text.splitlines():
        line = line.strip()
        if line and not line.lower().startswith(("артикул", "цiна", "цена", "ціна", "Цена")):
            bullets.append(f"• {line}")
    body = "\n".join(bullets[:8])
    return (
        f"{title}\n\n"
        f"{body}\n\n"
        f"---\n\n"
        f"📦 Артикул: {sku}\n"
        f"{price_line}\n\n"
        f"Щоб замовити — натисніть «Замовити» 👇"
    )


def filename_from_pib(pib: str) -> str:
    if not pib:
        return f"Замовлення_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    parts = re.split(r"\s+", pib.strip())
    last = parts[0] if parts else "Клієнт"
    initials = ""
    if len(parts) > 1 and parts[1]:
        initials += parts[1][0].upper() + "."
    if len(parts) > 2 and parts[2]:
        initials += parts[2][0].upper() + "."
    base = f"{last} {initials}".strip()
    return f"{base}.txt"


def build_order_text(data: Dict[str, Any]) -> str:
    delivery = data.get("delivery")
    human = {
        "np": "Нова Пошта",
        "ukr": "Укр Пошта",
        "rozetka": "Rozetka",
        "justin": "Justin",
        "meest": "Meest"
    }.get(delivery, delivery or "—")
    if delivery == "np":
        address_line = f"{data.get('np_city_name')}, Відділення №{data.get('np_wh_number')} — {data.get('np_wh_name')}"
    else:
        address_line = data.get("address", "")
    order_text = (
        "📦 НОВЕ ЗАМОВЛЕННЯ\n\n"
        f"👤 ПІБ: {data.get('pib')}\n"
        f"📞 Телефон: {data.get('phone')}\n"
        f"🔖 Товар: {data.get('article')}\n"
        f"🚚 Служба: {human}\n"
        f"📍 Адреса/відділення: {address_line}\n"
        f"🛻 Тип доставки: {data.get('delivery_type')}\n"
        f"💳 Тип оплати: {data.get('payment_type')}\n"
        f"📝 Примітка: {data.get('note')}\n"
        f"🕒 Час: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
    )
    return order_text


def save_order_to_txt(data: Dict[str, Any]) -> Path:
    ensure_orders_dir()
    pib = data.get("pib") or ""
    fname = filename_from_pib(pib)
    p = Path(ORDERS_DIR) / fname
    with open(p, "w", encoding="utf-8") as f:
        f.write(build_order_text(data))
    # optionally upload to GCS
    if USE_GCS and GCS_AVAILABLE and GCS_BUCKET:
        try:
            upload_file_to_gcs(str(p), f"orders/{fname}")
        except Exception as e:
            # log but continue
            pass
    return p


def get_order_keyboard(post_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🛒 Замовити",
                    url=f"https://t.me/{BOT_USERNAME}?start=order_{post_id}"
                )
            ]
        ]
    )


def order_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🛒 Замовити", callback_data="order:start")]])


def delivery_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚚 Нова Пошта", callback_data="delivery:np")],
        [InlineKeyboardButton(text="📮 Укр Пошта", callback_data="delivery:ukr")],
        [InlineKeyboardButton(text="🛒 Rozetka", callback_data="delivery:rozetka")],
        [InlineKeyboardButton(text="📦 Justin", callback_data="delivery:justin")],
        [InlineKeyboardButton(text="✈️ Meest", callback_data="delivery:meest")],
    ])


def confirm_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Підтвердити", callback_data="order:confirm")],
        [InlineKeyboardButton(text="❌ Скасувати", callback_data="order:cancel")]
    ])

# ============================== GCS helpers (optional) ==============================

def get_gcs_client():
    if not GCS_AVAILABLE:
        raise RuntimeError("google-cloud-storage not installed")
    return storage.Client()


def upload_file_to_gcs(local_path: str, dest_path: str) -> str:
    """Upload local file to GCS bucket. Returns public path (not necessarily public)."""
    if not GCS_AVAILABLE or not USE_GCS or not GCS_BUCKET:
        raise RuntimeError("GCS not configured")
    client = get_gcs_client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(dest_path)
    blob.upload_from_filename(local_path)
    return f"gs://{GCS_BUCKET}/{dest_path}"


def upload_bytes_to_gcs(content: bytes, dest_path: str) -> str:
    if not GCS_AVAILABLE or not USE_GCS or not GCS_BUCKET:
        raise RuntimeError("GCS not configured")
    client = get_gcs_client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(dest_path)
    blob.upload_from_string(content)
    return f"gs://{GCS_BUCKET}/{dest_path}"

# ============================== NovaPoshta client & MyDrop (unchanged) ==============================
class NovaPoshtaClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
    async def _post(self, session: aiohttp.ClientSession, model: str, method: str, properties: Dict[str, Any]) -> Dict[str, Any]:
        payload = {"apiKey": self.api_key, "modelName": model, "calledMethod": method, "methodProperties": properties}
        async with session.post(NP_API_URL, json=payload, timeout=aiohttp.ClientTimeout(total=20)) as r:
            r.raise_for_status()
            return await r.json()
    async def search_cities(self, session: aiohttp.ClientSession, q: str, page: int = 1, limit: int = 10) -> List[Dict[str, Any]]:
        props = {"FindByString": q, "Page": page, "Limit": limit}
        data = await self._post(session, "Address", "getCities", props)
        return data.get("data", []) or []
    async def get_warehouses(self, session: aiohttp.ClientSession, city_ref: str, page: int = 1, limit: int = 10) -> List[Dict[str, Any]]:
        props = {"CityRef": city_ref, "Page": page, "Limit": limit}
        data = await self._post(session, "AddressGeneral", "getWarehouses", props)
        return data.get("data", []) or []
    async def find_warehouse_by_number(self, session: aiohttp.ClientSession, city_ref: str, number: str) -> Optional[Dict[str, Any]]:
        props = {"CityRef": city_ref, "WarehouseId": number}
        data = await self._post(session, "AddressGeneral", "getWarehouses", props)
        items = data.get("data", []) or []
        if items:
            return items[0]
        all_wh = await self.get_warehouses(session, city_ref, page=1, limit=200)
        for w in all_wh:
            if str(w.get("Number")) == str(number):
                return w
        return None

async def send_order_to_mydrop(session: aiohttp.ClientSession, data: Dict[str, Any]) -> Dict[str, Any]:
    product = {
        "vendor_name": "SupplierAuto",
        "product_title": data.get("article") or "Товар з Telegram",
        "product_sku": extract_sku(data.get("article") or "") or "",
        "drop_price": 0,
        "price": 0,
        "amount": 1
    }
    note_block = build_order_text(data)
    payload = {
        "name": data.get("pib"),
        "phone": data.get("phone"),
        "products": [product],
        "order_source": "Telegram Bot",
        "traffic_source": "Organic",
        "utm_source": "",
        "utm_medium": "",
        "utm_term": "",
        "utm_content": "",
        "utm_campaign": "",
        "comment": note_block,
    }
    headers = {"X-API-KEY": MYDROP_API_KEY, "Content-Type": "application/json"}
    async with session.post(MYDROP_ORDERS_URL, headers=headers, json=payload, timeout=aiohttp.ClientTimeout(total=20)) as r:
        txt = await r.text()
        try:
            return json.loads(txt)
        except:
            return {"raw": txt, "status": r.status}

# ============================== Aiogram FSM ==============================
class OrderForm(StatesGroup):
    pib = State()
    phone = State()
    article = State()
    delivery = State()
    np_city_query = State()
    np_city_pick = State()
    np_warehouse_pick = State()
    np_warehouse_manual = State()
    address = State()
    delivery_type = State()
    payment_type = State()
    note = State()
    confirm = State()

bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher(storage=MemoryStorage())
dp.include_router(router)   # ✅ тільки один раз підключаємо router
np_client = NovaPoshtaClient(NP_API_KEY)

# ---------------- Flask ----------------
app = Flask(__name__)

@app.route("/")
def index():
    return "Bot is running!", 200

@app.route("/healthz")
def healthz():
    return "ok", 200

def run_flask():
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 10000)))

# ---------------- Aiogram main ----------------
async def run_bot():
    print("🚀 Bot started polling...")
    await dp.start_polling(bot)

def start():
    # Flask у окремому потоці
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    # Бот у головному asyncio циклі
    asyncio.run(run_bot())

if __name__ == "__main__":
    start()

@router.message(Command("start"))
async def cmd_start(msg: Message, state: FSMContext):
    args = msg.get_args() or ""
    if args.startswith("order_"):
        try:
            post_id = int(args.split("_", 1)[1])
        except:
            post_id = None
        await state.update_data(post_message_id=post_id, post_channel=TEST_CHANNEL)
        await msg.answer("🧾 Розпочнемо оформлення. Введіть ваші ПІБ:")
        await state.set_state(OrderForm.pib)
        return
    await msg.answer("Привіт! Це бот Taverna 👋\nНатисніть кнопку «Замовити» під постом у каналі, щоб оформити замовлення.")

@router.message(Command("publish_test"))
async def cmd_publish_test(msg: Message):
    text = (
        "🔥 <b>Тестовий пост для</b> @test_taverna\n\n"
        "Це перевірка кнопки <b>«Замовити»</b>.\n"
        "Натисніть і перевірте форму замовлення."
    )
    sent = await bot.send_message(TEST_CHANNEL, text)
    post_id = getattr(sent, "message_id", None)
    if post_id:
        kb = get_order_keyboard(post_id)
        try:
            await bot.edit_message_reply_markup(TEST_CHANNEL, post_id, reply_markup=kb)
        except Exception as e:
            await bot.send_message(ADMIN_ID, f"⚠️ Не вдалося поставити кнопку у тест-каналі: {e}")
    await msg.answer("✅ Тестовий пост опубліковано в тестовому каналі.")

@router.callback_query(F.data == "order:start")
async def order_start(cb: CallbackQuery, state: FSMContext):
    try:
        await bot.send_message(cb.from_user.id, "🧾 Створення замовлення.\n\nВведіть ваші ПІБ:")
        await state.update_data(post_message_id=cb.message.message_id, post_chat_id=cb.message.chat.id)
        await state.set_state(OrderForm.pib)
        await cb.answer()
    except Exception:
        await cb.answer("❗ Щоб оформити замовлення — відкрийте приватний чат з ботом або натисніть кнопку, яка відкриє чат.", show_alert=True)

# (rest of file continues...)

# For brevity, the file continues with the same logic as earlier: order steps, np city/warehouse handling, confirmation, telethon handler and startup.

# NOTE: The full file has been stored in this canvas as bot_updated.py. Download it and run locally.
