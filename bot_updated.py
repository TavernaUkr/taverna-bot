# -*- coding: utf-8 -*-
"""
Bot for Taverna (updated, with Flask healthcheck for Render Free Plan)
"""

import os
import sys
import re
import math
import json
import asyncio
import logging
import threading
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List

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

# Optional Google Cloud Storage
try:
    from google.cloud import storage
    GCS_AVAILABLE = True
except Exception:
    GCS_AVAILABLE = False

# ---------------- Flask for healthcheck ----------------
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

# ---------------- ENV check ----------------
logging.basicConfig(level=logging.INFO)

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
            print(f"✅ {var} = {str(value)[:15]}...")
        else:
            print(f"⚠️ {var} is not set")
    print("=== End ENV check ===")
    return BOT_TOKEN

load_dotenv()
BOT_TOKEN = check_env_vars()

# ---------------- Bot config ----------------
bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher(storage=MemoryStorage())
router = Router()
dp.include_router(router)   # ✅ тільки один раз підключаємо router

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

# ---------------- FSM ----------------
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

# ---------------- Keyboards ----------------
def get_order_keyboard(post_id: int):
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🛒 Замовити", url=f"https://t.me/{BOT_USERNAME}?start=order_{post_id}")]
        ]
    )

def order_keyboard():
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="🛒 Замовити", callback_data="order:start")]]
    )

def delivery_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚚 Нова Пошта", callback_data="delivery:np")],
        [InlineKeyboardButton(text="📮 Укр Пошта", callback_data="delivery:ukr")],
        [InlineKeyboardButton(text="🛒 Rozetka", callback_data="delivery:rozetka")],
        [InlineKeyboardButton(text="📦 Justin", callback_data="delivery:justin")],
        [InlineKeyboardButton(text="✈️ Meest", callback_data="delivery:meest")],
    ])

def confirm_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Підтвердити", callback_data="order:confirm")],
        [InlineKeyboardButton(text="❌ Скасувати", callback_data="order:cancel")]
    ])

# ---------------- Routers ----------------
@router.message(CommandStart())
async def cmd_start_simple(message: types.Message):
    await message.answer("Привіт! Бот працює ✅")

@router.message(Command("publish_test"))
async def publish_test(message: types.Message):
    await message.answer("Тестова публікація 🚀")

@router.callback_query(F.data == "example_callback")
async def callback_example(callback: CallbackQuery):
    await callback.answer("Натиснуто кнопку!")

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

# ---------------- Telethon ----------------
api_id = int(os.getenv("TG_API_ID", "0"))
api_hash = os.getenv("TG_API_HASH", "")
session_name = os.getenv("SESSION_NAME", "bot")
supplier_channel = os.getenv("SUPPLIER_CHANNEL")
supplier_name = os.getenv("SUPPLIER_NAME")

if api_id and api_hash:
    telethon_client = TelegramClient(session_name, api_id, api_hash)
    @telethon_client.on(events.NewMessage(chats=supplier_channel))
    async def handler(event):
        logging.info(f"New message from supplier: {event.text}")
else:
    telethon_client = None
    logging.warning("⚠️ Telethon client is not configured")

# ---------------- Main ----------------
async def main():
    # запускаємо Flask у окремому потоці
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    # Telethon, якщо налаштований
    if telethon_client:
        try:
            # ✅ Запускаємо Telethon через BOT_TOKEN, без input()
            await telethon_client.start(bot_token=BOT_TOKEN)
            logging.info("Telethon client started via bot token ✅")
        except Exception as e:
            logging.error(f"❌ Telethon failed to start: {e}")



    logging.info("🚀 Bot started polling...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logging.info("Bot stopped.")
