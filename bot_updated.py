# -*- coding: utf-8 -*-
"""
Final bot_updated.py (fixed order button)
- Aiogram bot with FSM for orders
- Telethon client listens supplier channel, reposts to MAIN_CHANNEL with paraphrase and +33% markup
- MyDrop integration: test mode -> admin confirmation; live mode -> POST order
- Nova Poshta helper functions (basic, may need tuning to NP API)
- Flask healthcheck for Render
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
import tempfile
import re

import aiohttp
from dotenv import load_dotenv
from flask import Flask

from aiogram import Bot, Dispatcher, Router, F, types
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import StatesGroup, State
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message, CallbackQuery,
    InlineKeyboardButton, InlineKeyboardMarkup,
)

from telethon import TelegramClient, events

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
        "NP_API_KEY", "NP_API_URL", "MYDROP_API_KEY",
        "MYDROP_ORDERS_URL", "ORDERS_DIR", "USE_GCS", "GCS_BUCKET",
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
MYDROP_ORDERS_URL = os.getenv("MYDROP_ORDERS_URL")

ORDERS_DIR = os.getenv("ORDERS_DIR", "/tmp/orders")
Path(ORDERS_DIR).mkdir(parents=True, exist_ok=True)

TEST_MODE = os.getenv("TEST_MODE", "false").lower() == "true"

# ---------------- Flask ----------------
app = Flask(__name__)

@app.route("/")
def index():
    return "Bot is running!", 200

@app.route("/healthz")
def healthz():
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

# ---------------- FSM ----------------
class OrderForm(StatesGroup):
    pib = State()
    phone = State()
    article = State()
    confirm = State()

# ---------------- Helpers: keyboards ----------------
def get_order_keyboard(post_id: int):
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🛒 Замовити", url=f"https://t.me/{BOT_USERNAME}?start=order_{post_id}")]
        ]
    )

def confirm_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Підтвердити", callback_data="order:confirm")],
        [InlineKeyboardButton(text="❌ Скасувати", callback_data="order:cancel")]
    ])

# ---------------- Routers / Handlers ----------------
@router.message(CommandStart())
async def cmd_start_simple(message: types.Message):
    await message.answer("Привіт! Бот працює ✅")

@router.message(Command("start"))
async def cmd_start(msg: Message, state: FSMContext):
    await msg.answer(
        "Привіт! Це бот Taverna 👋\n"
        "Натисніть кнопку «Замовити» під постом у каналі, щоб оформити замовлення."
    )

@router.message(Command("publish_test"))
async def cmd_publish_test(msg: Message):
    text = (
        "🔥 <b>Тестовий пост для</b> @test_taverna\n\n"
        "Це перевірка кнопки <b>«Замовити»</b>.\n"
        "Натисніть і перевірте форму замовлення."
    )
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🛒 Замовити", callback_data="order:start:999")]
        ]
    )
    try:
        await bot.send_message(TEST_CHANNEL, text, reply_markup=kb)
        await msg.answer("✅ Тестовий пост опубліковано в тестовому каналі.")
    except Exception as e:
        await msg.answer(f"⚠️ Помилка при публікації: {e}")

# Simplified order FSM handlers
@router.callback_query(F.data.startswith("order:start:"))
async def order_start(cb: CallbackQuery, state: FSMContext):
    post_id = int(cb.data.split(":")[2])
    await state.update_data(post_message_id=post_id, post_channel=MAIN_CHANNEL)
    await cb.message.answer("🧾 Розпочнемо оформлення. Введіть ваші ПІБ:")
    await state.set_state(OrderForm.pib)
    await cb.answer()

@router.message(OrderForm.pib)
async def state_pib(msg: Message, state: FSMContext):
    await state.update_data(pib=msg.text)
    await msg.answer("Введіть телефон (у форматі +380...):")
    await state.set_state(OrderForm.phone)

@router.message(OrderForm.phone)
async def state_phone(msg: Message, state: FSMContext):
    phone = msg.text.strip()
    await state.update_data(phone=phone)
    await msg.answer("Введіть артикул / назву товару:")
    await state.set_state(OrderForm.article)

@router.message(OrderForm.article)
async def state_article(msg: Message, state: FSMContext):
    await state.update_data(article=msg.text)
    await msg.answer("Оберіть доставку:", reply_markup=confirm_keyboard())
    await state.set_state(OrderForm.confirm)

@router.callback_query(F.data == "order:confirm")
async def cb_order_confirm(cb: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    await cb.message.edit_text("Дякую! Ваше замовлення прийнято (тимчасово). Ми з вами зв'яжемося.")
    await cb.answer()
    order_payload = {
        "name": data.get("pib"),
        "phone": data.get("phone"),
        "products": [
            {
                "vendor_name": supplier_name or "supplier",
                "product_title": data.get("article"),
                "amount": 1,
                "drop_price": None,
                "price": None
            }
        ],
        "description": data.get("note", ""),
    }
    order_id = int(datetime.utcnow().timestamp())
    ORDERS_PENDING[order_id] = order_payload
    if TEST_MODE:
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="Створити замовлення у MyDrop", callback_data=f"mydrop:create:{order_id}")]
        ])
        await bot.send_message(
            ADMIN_ID,
            f"Тестове замовлення (id={order_id}):\n{json.dumps(order_payload, ensure_ascii=False, indent=2)}",
            reply_markup=kb
        )
    else:
        asyncio.create_task(create_mydrop_order(order_payload, notify_chat=ADMIN_ID))
    await state.clear()

@router.callback_query(F.data == "order:cancel")
async def cb_order_cancel(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    await cb.message.edit_text("Замовлення скасовано.")
    await cb.answer()

# ---------------- Pending orders store ----------------
ORDERS_PENDING: Dict[int, Dict[str, Any]] = {}

# ---------------- MyDrop integration ----------------
async def create_mydrop_order(payload: Dict[str, Any], notify_chat: Optional[int] = None):
    """
    payload must follow MyDrop expected structure.
    For demo we attempt to map our minimal payload into products format.
    """
    if not MYDROP_ORDERS_URL:
        logger.error("MYDROP_ORDERS_URL not set")
        if notify_chat:
            await bot.send_message(notify_chat, "❌ MYDROP_ORDERS_URL not configured.")
        return None

    headers = {"Content-Type": "application/json"}
    if MYDROP_API_KEY:
        headers["Authorization"] = f"Bearer {MYDROP_API_KEY}"

    # transform minimal payload to MyDrop format (example)
    body = {
        "name": payload.get("name"),
        "phone": payload.get("phone"),
        "products": [],
        "delivery_service": payload.get("delivery_service", "nova_poshta"),
        "city": payload.get("city"),
        "warehouse_number": payload.get("warehouse_number"),
        "description": payload.get("description", ""),
        "order_source": "TelegramBot"
    }
    for p in payload.get("products", []):
        prod = {
            "vendor_name": p.get("vendor_name", supplier_name),
            "product_title": p.get("product_title"),
            "sku": p.get("sku"),
            "drop_price": p.get("drop_price"),
            "price": p.get("price") or p.get("drop_price"),
            "amount": p.get("amount", 1),
            "size_title": p.get("size_title"),
            "size_note": p.get("size_note"),
        }
        body["products"].append(prod)

    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(MYDROP_ORDERS_URL, json=body, headers=headers, timeout=20) as resp:
                text = await resp.text()
                logger.info("MyDrop response %s %s", resp.status, text)
                if resp.status in (200, 201):
                    data = await resp.json()
                    ttn = data.get("ttn")
                    if notify_chat:
                        await bot.send_message(notify_chat, f"✅ Замовлення створено в MyDrop. ID: {data.get('id')}, TTN: {ttn}")
                    return data
                else:
                    if notify_chat:
                        await bot.send_message(notify_chat, f"❌ MyDrop error {resp.status}: {text}")
                    return None
        except Exception as e:
            logger.exception("MyDrop request failed")
            if notify_chat:
                await bot.send_message(notify_chat, f"❌ Помилка при зверненні до MyDrop: {e}")
            return None

@router.callback_query(F.data.startswith("mydrop:create:"))
async def cb_mydrop_create(cb: CallbackQuery):
    """
    Admin pressed confirm in test mode -> actually create order in MyDrop.
    Callback data: mydrop:create:<order_id>
    """
    if cb.from_user.id != ADMIN_ID:
        await cb.answer("Тільки адмін може створювати замовлення.", show_alert=True)
        return
    parts = cb.data.split(":")
    if len(parts) != 3:
        await cb.answer("Невірні дані.", show_alert=True)
        return
    order_id = int(parts[2])
    payload = ORDERS_PENDING.get(order_id)
    if not payload:
        await cb.answer("❌ Замовлення не знайдено або вже оброблене.", show_alert=True)
        return
    await cb.answer("Створюю замовлення в MyDrop...")
    res = await create_mydrop_order(payload, notify_chat=ADMIN_ID)
    if res:
        ORDERS_PENDING.pop(order_id, None)
        await cb.message.edit_text(f"✅ Тестове замовлення створено в MyDrop: {res.get('id')}")
    else:
        await cb.message.edit_text("❌ Не вдалося створити замовлення у MyDrop. Дивись лог.")

# ---------------- Nova Poshta helpers (basic) ----------------
async def np_search_city(query: str) -> List[Dict[str, Any]]:
    """
    Search city by query using NP API.
    This is a general implementation; adjust params depending on NP API version.
    """
    if not NP_API_URL or not NP_API_KEY:
        logger.warning("NP API not configured")
        return []
    payload = {"modelName": "Address", "calledMethod": "getCities", "methodProperties": {"FindByString": query}}
    headers = {"Content-Type": "application/json"}
    # If NP expects apiKey differently, adjust here.
    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(NP_API_URL, json=payload, headers=headers, timeout=10) as resp:
                data = await resp.json()
                # expected structure may vary
                return data.get("data", [])
        except Exception:
            logger.exception("np_search_city failed")
            return []

async def np_get_warehouses(city_ref: str) -> List[Dict[str, Any]]:
    if not NP_API_URL or not NP_API_KEY:
        return []
    payload = {"modelName": "AddressGeneral", "calledMethod": "getWarehouses", "methodProperties": {"CityRef": city_ref}}
    headers = {"Content-Type": "application/json"}
    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(NP_API_URL, json=payload, headers=headers, timeout=10) as resp:
                data = await resp.json()
                return data.get("data", [])
        except Exception:
            logger.exception("np_get_warehouses failed")
            return []

# ---------------- Telethon client ----------------
telethon_client: Optional[TelegramClient] = None
if api_id and api_hash:
    # prefer using existing session file (e.g., bot1.session) if present to avoid input() prompt.
    # SESSION_NAME can be a path to session file or name. Telethon will add .session if needed.
    session_path = SESSION_NAME
    # if full path uploaded in container (like /app/bot1.session), allow it
    # Telethon accepts either 'bot1' (file bot1.session) or full path '.../bot1.session'
    try:
        telethon_client = TelegramClient(session_path, api_id, api_hash)
        logger.info("Telethon client initialized (session=%s)", session_path)
    except Exception:
        logger.exception("Failed init Telethon client")
        telethon_client = None
else:
    logger.warning("Telethon not configured (TG_API_ID/TG_API_HASH missing)")
    telethon_client = None

async def telethon_download_and_send(event, caption_text: str):
    """
    Download media from telethon event to temp file(s), then send to MAIN_CHANNEL via aiogram bot
    Returns message_id of sent message (if any)
    """
    files = []
    try:
        if not event.message.media:
            # no media -> send text only
            sent = await bot.send_message(MAIN_CHANNEL, caption_text, reply_markup=None)
            return getattr(sent, "message_id", None)
        # if single or multiple media, Telethon event.message.media may be photo or media_group
        # Telethon has method download_media; we download to temp files
        media = event.message.media
        # Telethon supports download_media for message; it returns path
        tmpdir = tempfile.mkdtemp(prefix="telethon_")
        # For single message with possibly multiple photo parts - Telethon doesn't expose media_group easily here.
        # We'll attempt to download the whole message media.
        file_path = await event.message.download_media(file=tmpdir)
        if isinstance(file_path, (list, tuple)):
            files = file_path
        else:
            files = [file_path]
        # send media via aiogram: if one file -> send_photo, if many -> send_media_group
        if len(files) == 1:
            with open(files[0], "rb") as f:
                sent = await bot.send_photo(MAIN_CHANNEL, f, caption=caption_text, reply_markup=None)
                return getattr(sent, "message_id", None)
        else:
            media_group = []
            for p in files:
                media_group.append(types.InputMediaPhoto(types.BufferedInputFile(open(p, "rb"))))
            # aiogram bot has send_media_group
            sent_items = await bot.send_media_group(MAIN_CHANNEL, media_group)
            # edit caption of the first to include caption_text
            if sent_items:
                first_id = getattr(sent_items[0], "message_id", None)
                try:
                    await bot.edit_message_caption(MAIN_CHANNEL, first_id, caption=caption_text)
                except Exception:
                    pass
                return first_id
    except Exception:
        logger.exception("telethon_download_and_send failed")
    return None

def extract_drop_price_from_text(text: str) -> Optional[float]:
    """
    Try to heuristically find a price number in text.
    Looks for currency-like patterns like 300, 300 грн, 300.00, $300, 300UAH
    """
    if not text:
        return None
    # find sequences of digits with optional separators
    matches = re.findall(r"(\d{2,6}(?:[.,]\d{1,2})?)", text.replace(" ", ""))
    # filter unrealistic: choose largest match
    if not matches:
        return None
    # pick first plausible
    try:
        val = matches[0].replace(",", ".")
        return float(val)
    except Exception:
        try:
            return float(matches[-1].replace(",", "."))
        except Exception:
            return None

# Telethon handler: listens supplier_channel and reposts to MAIN_CHANNEL
if telethon_client:
    @telethon_client.on(events.NewMessage(chats=supplier_channel))
    async def supplier_handler(event):
        try:
            # event.message.text may be None for media posts
            text = event.message.message or event.message.text or ""
            logger.info("New supplier message: %s", (text[:120] if text else "<media>"))
            # basic paraphrase: replace supplier name mentions and add header
            paraphrase_intro = f"📦 Новий товар від {supplier_name} — перероблено та опубліковано від імені нашого магазину.\n\n"
            # try to extract drop price
            drop_price = extract_drop_price_from_text(text)
            price_note = ""
            if drop_price:
                my_price = round(drop_price * 1.33)
                price_note = f"\n\n💰 Наша ціна (націнка +33%): {my_price} грн (дроп: {drop_price} грн)"
            # Compose caption
            caption = paraphrase_intro + (text or "") + price_note
            # Download media and send
            sent_post_id = await telethon_download_and_send(event, caption)
            # If we managed to send and get message id, add order button
            if sent_post_id:
                try:
                    kb = get_order_keyboard(sent_post_id)
                    await bot.edit_message_reply_markup(MAIN_CHANNEL, sent_post_id, reply_markup=kb)
                except Exception:
                    # some channels/users can't edit; ignore
                    logger.exception("Failed to edit reply markup for posted message")
            # Optionally notify admin
            await bot.send_message(ADMIN_ID, f"🔁 Репост зроблено в {MAIN_CHANNEL}. Оригінал: {event.chat_id}/{event.message.id}")
        except Exception:
            logger.exception("supplier_handler failed")

# ---------------- Main ----------------
async def main():
    # start Flask healthcheck thread
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    # Start Telethon first (if present) using existing session (avoid interactive input)
    if telethon_client:
        try:
            # prefer starting with session file; do NOT pass bot_token here to avoid getUpdates conflict.
            await telethon_client.start()
            logger.info("Telethon client started")
        except Exception as e:
            logger.exception("Telethon failed to start: %s", e)

    # Start aiogram polling
    logger.info("Starting aiogram polling...")
    try:
        await dp.start_polling(bot)
    except Exception:
        logger.exception("Polling failed")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Bot stopped.")
