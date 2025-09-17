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
import traceback
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
from aiogram.filters import Command, CommandStart, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import StatesGroup, State
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery, BotCommand, FSInputFile
from telethon import TelegramClient, events
from telethon.tl.types import MessageMediaPhoto
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from html import unescape
import tempfile


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
        "NP_API_KEY", "NP_API_URL", "MYDROP_API_KEY", "MYDROP_EXPORT_URL", "MYDROP_ORDERS_URL", "ORDERS_DIR",
        "USE_GCS", "GCS_BUCKET", "SERVICE_ACCOUNT_JSON",
        "USE_GDRIVE", "GDRIVE_FOLDER_ID",
        "TEST_MODE", "WEBHOOK_URL"
    ]
    for var in env_vars:
        value = os.getenv(var)
        if value:
            if var.upper().endswith(("KEY", "TOKEN", "SECRET", "PASSWORD")) or var in ("SERVICE_ACCOUNT_JSON",):
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
TEST_CHANNEL = int(os.getenv("TEST_CHANNEL"))
MAIN_CHANNEL = os.getenv("MAIN_CHANNEL")
TEST_CHANNEL_URL = os.getenv("TEST_CHANNEL_URL")

api_id = int(os.getenv("TG_API_ID", "0") or 0)
api_hash = os.getenv("TG_API_HASH", "")
SESSION_NAME = os.getenv("SESSION_NAME", "bot1")
SUPPLIER_CHANNEL = os.getenv("SUPPLIER_CHANNEL")
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

USE_GCS = os.getenv("USE_GCS", "false").lower() in ("1", "true", "yes")
USE_GDRIVE = os.getenv("USE_GDRIVE", "false").lower() in ("1", "true", "yes")
GDRIVE_FOLDER_ID = os.getenv("GDRIVE_FOLDER_ID", "")

logger.debug("USE_GDRIVE = %s", USE_GDRIVE)

# ---------------- Cache for MyDrop products ----------------
PRODUCTS_CACHE = {
    "last_update": None,
    "data": None
}
CACHE_TTL = 900  # 15 хвилин (900 секунд)

PRODUCTS_EXPORT_CACHE: Optional[str] = None

# ---------------- Build product index (robust) ----------------
def normalize_sku(s: str) -> str:
    """Нормалізує артикул / sku: прибирає пробіли, невидимі символи та небажані знаки, нижній регістр."""
    if not s:
        return ""
    s = unescape(str(s))
    s = s.strip()
    # видаляємо zero-width і BOM
    s = re.sub(r'[\u200B\uFEFF]', '', s)
    # залишаємо лише латинські букви і цифри
    s = re.sub(r'[^0-9A-Za-z]+', '', s)
    return s.lower()

# bot_updated_46.py

# ... (попередній код без змін) ...

# ---------------- Build product index (ФІНАЛЬНА ВЕРСІЯ + by_offer) ----------------
def build_products_index_from_xml(text: str):
    """
    Фінальна версія парсера. Читає дані напряму та створює всі необхідні індекси.
    """
    global PRODUCTS_INDEX
    PRODUCTS_INDEX = {
        "all_products": [], 
        "by_sku": defaultdict(list),
        "by_offer": {}  # <-- ПОВЕРНУЛИ ЦЕЙ ІНДЕКС
    }
    try:
        it = ET.iterparse(io.StringIO(text), events=("end",))
        product_count = 0
        for _, elem in it:
            if elem.tag == 'offer':
                offer_id = elem.attrib.get("id", "").strip()
                name_tag = elem.find('name')
                name = name_tag.text.strip() if name_tag is not None and name_tag.text else ""
                price_tag = elem.find('price')
                price_txt = price_tag.text.strip() if price_tag is not None and price_tag.text else "0"
                try: drop_price = float(price_txt)
                except (ValueError, TypeError): drop_price = None
                vendor_code_tag = elem.find('vendorCode')
                vendor_code = vendor_code_tag.text.strip() if vendor_code_tag is not None and vendor_code_tag.text else ""

                if not offer_id or not name or not drop_price:
                    elem.clear()
                    continue
                
                description_tag = elem.find('description')
                description = description_tag.text.strip() if description_tag is not None and description_tag.text else ""
                pictures = [pic.text.strip() for pic in elem.findall('picture') if pic.text]
                sizes = [p.text.strip() for p in elem.findall('param') if p.attrib.get('name', '').lower() in ('размер', 'розмір', 'size') and p.text]

                product = {
                    "offer_id": offer_id, "vendor_code": vendor_code, "name": name,
                    "description": description, "pictures": pictures, "sizes": sizes, "drop_price": drop_price,
                }
                PRODUCTS_INDEX["all_products"].append(product)

                # <-- ДОДАЛИ ІНДЕКСАЦІЮ ЗА OFFER_ID
                if offer_id:
                    PRODUCTS_INDEX["by_offer"][offer_id] = product

                keys_to_index = {offer_id, vendor_code, normalize_sku(vendor_code), normalize_sku(offer_id)}
                for key in keys_to_index:
                    if key: PRODUCTS_INDEX["by_sku"][key].append(product)
                
                product_count += 1
                elem.clear()
        
        logger.info(f"✅ Product index built: {product_count} products total.")
    except Exception:
        logger.exception("❌ CRITICAL ERROR during XML parsing")

# ---------------- Robust SKU search (ФІНАЛЬНА ВЕРСІЯ З ФІЛЬТРАЦІЄЮ) ----------------
def find_product_by_sku(raw: str) -> Optional[list]:
    """
    Фінальна версія пошуку, яка жорстко фільтрує "порожні" товари.
    """
    if not raw: return None

    raw = str(raw).strip()
    norm = normalize_sku(raw)
    by_sku = PRODUCTS_INDEX.get("by_sku", {})
    
    # --- Етап 1: Збираємо всіх кандидатів ---
    all_candidates = []
    processed_offers = set()
    for key, products in by_sku.items():
        if raw in key or norm in key:
            for p in products:
                offer_id = p.get("offer_id")
                if offer_id not in processed_offers:
                    all_candidates.append(p)
                    processed_offers.add(offer_id)

    if not all_candidates:
        logger.debug(f"Lookup failed for SKU='{raw}': No candidates found.")
        return None

    # --- Етап 2: ЖОРСТКА ФІЛЬТРАЦІЯ ---
    good_candidates = [p for p in all_candidates if p.get("name") and p.get("drop_price")]

    if not good_candidates:
        logger.warning(f"Lookup warning for SKU='{raw}': Found {len(all_candidates)} raw candidates, but all were filtered out.")
        return None

    # --- Етап 3: Сортування тільки "хороших" кандидатів ---
    candidates_with_scores = []
    for p in good_candidates:
        score = 0
        vendor_code_norm = normalize_sku(p.get("vendor_code", ""))
        if norm == vendor_code_norm: score = 100
        elif norm in vendor_code_norm: score = 90
        else: score = 10
        candidates_with_scores.append({"product": p, "score": score})

    sorted_candidates = sorted(candidates_with_scores, key=lambda x: x["score"], reverse=True)
    final_products = [item["product"] for item in sorted_candidates]
    
    best_match = sorted_candidates[0]
    logger.debug(f"Lookup success for SKU='{raw}': Found {len(final_products)} valid products. Best match: {best_match['product'].get('name')}")
    
    return final_products

# ---------------- global async loop holder ----------------
# буде заповнений в main()
ASYNC_LOOP: Optional[asyncio.AbstractEventLoop] = None

async def init_gdrive():
    global G_DRIVE_SERVICE
    # Ця змінна тепер береться з глобального контексту напряму
    sa_json = os.getenv("SERVICE_ACCOUNT_JSON", "")
    if not USE_GDRIVE or not sa_json:
        return
    try:
        if sa_json.strip().startswith("{"):
            creds_dict = json.loads(sa_json)
            creds = Credentials.from_service_account_info(creds_dict, scopes=['https://www.googleapis.com/auth/drive'])
        else:
            creds = Credentials.from_service_account_file(sa_json, scopes=['https://www.googleapis.com/auth/drive'])

        G_DRIVE_SERVICE = build('drive', 'v3', credentials=creds)
        logger.info("✅ GDrive initialized successfully.")
    except Exception:
        logger.exception("❌ GDrive init failed")

def gdrive_upload_file(local_path: str, mime_type: str, filename: str, parent_folder_id: str):
    if not GDRIVE_SERVICE:
        return None
    try:
        body = {"name": filename, "parents": [parent_folder_id]}
        media = MediaFileUpload(local_path, mimetype=mime_type)
        file = GDRIVE_SERVICE.files().create(body=body, media_body=media, fields="id, webViewLink").execute()
        return file
    except Exception:
        logger.exception("❌ GDrive upload failed")
        return None

def init_gcs():
    """Ініціалізує клієнт Google Cloud Storage, якщо потрібно."""
    if USE_GCS:
        try:
            # Створюємо клієнт. Якщо SERVICE_ACCOUNT_JSON є, він буде використаний.
            storage.Client()
            logger.info("✅ GCS client initialized successfully.")
        except Exception:
            logger.exception("❌ GCS init failed")

# ---------------- Telethon: supplier -> repost to MAIN_CHANNEL with deep-link ----------------
# матчери для артикулу в тексті поста
SKU_REGEX = re.compile(r'(?:артикул|арт\.|артікул|sku|код|vendorCode|vendor_code)[^\d\-:]*([0-9A-Za-z\-\_]{2,30})', flags=re.I)

# ---------------- Telethon (start_telethon_client) + GDrive uploader ----------------
# Вставити ПІСЛЯ init_gdrive() / gdrive_upload_file() і ПЕРЕД main()

TELETHON_CLIENT: Optional[TelegramClient] = None
TELETHON_STARTED = False

async def start_telethon_client(loop: asyncio.AbstractEventLoop):
    """
    Запускає Telethon client у тому ж asyncio-лупі, реєструє handler для SUPPLIER_CHANNEL.
    Запуск: asyncio.create_task(start_telethon_client(ASYNC_LOOP))
    """
    global TELETHON_CLIENT, TELETHON_STARTED
    if TELETHON_STARTED:
        logger.debug("Telethon already started, skip")
        return

    # Використовуємо SESSION_NAME, api_id, api_hash (вони є в конфігурації файлу)
    try:
        TELETHON_CLIENT = TelegramClient(SESSION_NAME, api_id, api_hash, loop=loop)
        await TELETHON_CLIENT.start()
        TELETHON_STARTED = True
        logger.info("Telethon client started; listening supplier channel: %s", supplier_channel)
    except Exception:
        logger.exception("Failed to start Telethon client")
        return
    @TELETHON_CLIENT.on(events.NewMessage(chats=SUPPLIER_CHANNEL))
    async def supplier_msg_handler(event: events.NewMessage.Event):
        """
        Handler для нового поста в SUPPLIER_CHANNEL:
         - шукає SKU у тексті/caption,
         - викликає find_product_by_sku(sku),
         - (опційно) зберігає фото/текст у GDrive (якщо USE_GDRIVE),
         - репостить у MAIN_CHANNEL через aiogram bot з deep-link кнопкою «🛒 Замовити».
        """
        try:
            msg = event.message
            text = (msg.message or "") if hasattr(msg, "message") else (msg.raw_text or "")
            if not text and not getattr(msg, "media", None):
                return

            # 1) шукаємо SKU (regex + fallback)
            sku_found = None
            m = SKU_REGEX.search(text or "")
            if m:
                sku_found = m.group(1).strip()
            if not sku_found:
                # пробуємо перший рядок (цифри)
                first_line = (text.splitlines()[0] if text else "")[:120]
                m2 = re.search(r'\b([0-9]{3,10})\b', first_line)
                if m2:
                    sku_found = m2.group(1)
            # ще спроба з caption (якщо медіа)
            if not sku_found and getattr(msg, "media", None):
                caption = getattr(msg, "message", "") or getattr(msg, "raw_text", "") or ""
                m3 = SKU_REGEX.search(caption)
                if m3:
                    sku_found = m3.group(1).strip()

            if not sku_found:
                logger.debug("Telethon: SKU не знайдено в пості постачальника (skip). preview: %s", (text or "")[:120])
                return

            logger.info("Telethon: виявлено SKU=%s у пості постачальника", sku_found)

            # 2) знаходимо товар через існуючу функцію
            product, method = find_product_by_sku(sku_found)
            if not product:
                logger.info("Telethon: товар не знайдено для SKU=%s (method=%s). Повідомлю рев'ю-чат.", sku_found, method)
                try:
                    if REVIEW_CHAT:
                        await bot.send_message(REVIEW_CHAT, f"🔍 Не знайдено товар для артикулу `{sku_found}` у пості постачальника.\n\nPreview:\n{(text or '')[:800]}", parse_mode="HTML")
                except Exception:
                    logger.exception("Failed to notify review chat")
                return

            # 3) опціонально зберігаємо перше фото і текст у GDrive
            saved_pic_info = None
            saved_txt_info = None
            try:
                if getattr(msg, "media", None) and USE_GDRIVE and GDRIVE_SERVICE and GDRIVE_FOLDER_ID:
                    tmpf = tempfile.NamedTemporaryFile(prefix="tav_", delete=False)
                    tmpf.close()
                    await TELETHON_CLIENT.download_media(msg.media, file=tmpf.name)
                    uploaded = gdrive_upload_file(tmpf.name, "image/jpeg", f"{sku_found}_post_{getattr(msg,'id', '') or getattr(msg,'message_id','')}.jpg", GDRIVE_FOLDER_ID)
                    if uploaded:
                        saved_pic_info = uploaded
                        logger.info("GDrive: saved photo for SKU %s", sku_found)
                    try:
                        os.remove(tmpf.name)
                    except Exception:
                        pass
                if USE_GDRIVE and GDRIVE_SERVICE and GDRIVE_FOLDER_ID:
                    tmp_txt = tempfile.NamedTemporaryFile(prefix="tav_txt_", suffix=".txt", delete=False, mode="w", encoding="utf-8")
                    tmp_txt.write(f"Source supplier post chat={event.chat_id} msg={getattr(msg,'id',None) or getattr(msg,'message_id',None)}\n\n")
                    tmp_txt.write(text or "")
                    tmp_txt.close()
                    uploaded_txt = gdrive_upload_file(tmp_txt.name, "text/plain", f"{sku_found}_post_{getattr(msg,'id','')}.txt", GDRIVE_FOLDER_ID)
                    if uploaded_txt:
                        saved_txt_info = uploaded_txt
                    try:
                        os.remove(tmp_txt.name)
                    except Exception:
                        pass
            except Exception:
                logger.exception("Telethon: помилка збереження в GDrive (нефатальна)")

            # 4) готуємо текст для репосту і deep-link
            vendor_code = product.get("vendor_code") or product.get("raw_sku") or sku_found
            name = product.get("name") or vendor_code
            price = product.get("drop_price") or product.get("price") or "—"
            pictures = product.get("pictures") or []
            description = product.get("description") or ""

            repost_text = f"📦 <b>{name}</b>\n\nАртикул: <code>{vendor_code}</code>\nЦіна: <b>{price} грн</b>\n\n"
            if description:
                repost_text += (description[:450] + ("…" if len(description) > 450 else "")) + "\n\n"
            repost_text += "🔹 Натисніть «🛒 Замовити», щоб оформити в боті."

            post_id = f"{event.chat_id}_{getattr(msg, 'id', '') or getattr(msg, 'message_id', '')}"
            deep = f"order_supplier_{post_id}__sku_{vendor_code}"
            deep_link_url = f"https://t.me/{BOT_USERNAME}?start={deep}"

            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🛒 Замовити", url=deep_link_url)],
                [InlineKeyboardButton(text="🔎 Переглянути в каталозі", callback_data=f"search:sku:{vendor_code}")]
            ])

            # 5) відправка в MAIN_CHANNEL через aiogram bot
            try:
                if saved_pic_info and saved_pic_info.get("webViewLink"):
                    # використовуємо посилання з GDrive (якщо доступно)
                    await bot.send_photo(chat_id=MAIN_CHANNEL, photo=saved_pic_info.get("webViewLink"), caption=repost_text, reply_markup=kb, parse_mode="HTML")
                elif pictures:
                    await bot.send_photo(chat_id=MAIN_CHANNEL, photo=pictures[0], caption=repost_text, reply_markup=kb, parse_mode="HTML")
                else:
                    await bot.send_message(chat_id=MAIN_CHANNEL, text=repost_text, reply_markup=kb, parse_mode="HTML")
                logger.info("Telethon: успішно репостнув SKU=%s до MAIN_CHANNEL", vendor_code)
            except Exception:
                logger.exception("Telethon: помилка відправки в MAIN_CHANNEL")

        except Exception:
            logger.exception("Telethon handler exception for supplier message")

    logger.info("Telethon client listening configured for SUPPLIER CHANNEL.")

# ---------------- Aiogram bot ----------------
bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher(storage=MemoryStorage())

router = Router()  # ✅ додаємо це

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
class SearchState(StatesGroup):
    waiting_for_input = State() # Стан очікування назви або артикула

class OrderForm(StatesGroup):
    quantity = State()
    full_name = State()
    phone_number = State()
    delivery_address = State()
    comment = State()
    confirm = State()

# ---------------- id Telegram ----------------
@router.message(Command("get_chatid"))
async def cmd_get_chatid(msg: Message):
    chat = await bot.get_chat("@test_taverna")
    await msg.answer(f"ID каналу: {chat.id}")

# ---------------- Debug handlers (temporary) ----------------
@router.message(Command("debug_index_check"))
async def cmd_debug_index_check(msg: Message):
    """
    /debug_index_check 1056
    Повертає, чи є ключі SKU у PRODUCTS_INDEX['by_sku'] і показує приклади ключів.
    """
    try:
        arg = (msg.text or "").split(maxsplit=1)
        sku = arg[1].strip() if len(arg) > 1 else ""
        norm = normalize_sku(sku) if sku else sku
        by_sku = PRODUCTS_INDEX.get("by_sku", {})
        found_norm = norm in by_sku if norm else False
        found_raw = sku in by_sku if sku else False
        # знайдемо ключі які містять sku або norm
        matching = [k for k in list(by_sku.keys()) if sku and sku in k or (norm and norm in k)]
        text = f"SKU={sku}\nnorm={norm}\nby_sku has norm? {found_norm}\nby_sku has raw? {found_raw}\nmatches sample: {matching[:20]}"
        await msg.answer(f"<pre>{text}</pre>", parse_mode="HTML")
    except Exception:
        logger.exception("debug_index_check failed")
        await msg.answer("debug failed")

@router.message(Command("debug_findraw"))
async def cmd_debug_findraw(msg: Message):
    """
    /debug_findraw 1056
    Повертає список products у all_products, де vendor_code або offer_id == 1056.
    """
    try:
        arg = (msg.text or "").split(maxsplit=1)
        key = arg[1].strip() if len(arg) > 1 else ""
        found = []
        for p in PRODUCTS_INDEX.get("all_products", []):
            if key and (key == (p.get("vendor_code") or "") or key == (p.get("offer_id") or "")):
                found.append({"offer_id": p.get("offer_id"), "vendor_code": p.get("vendor_code"), "name": p.get("name")})
        await msg.answer(f"Found {len(found)} items: {found[:10]}")
    except Exception:
        logger.exception("debug_findraw failed")
        await msg.answer("debug failed")

@router.message(Command("debug_lookup"))
async def cmd_debug_lookup(msg: Message, command: CommandObject):
    try:
        raw = command.args.strip() if command.args else ""
        norm = normalize_sku(raw) if raw else None
        logger.debug(f"Debug lookup: raw='{raw}', norm='{norm}'")
        
        result = find_product_by_sku(raw) # Шукаємо за сирим значенням
        
        if result:
            # result - це список товарів
            count = len(result)
            names = ", ".join([p['name'] for p in result[:3]])
            await msg.answer(f"✅ Lookup success: Знайдено {count} товарів. Наприклад: {names}")
        else:
            by_sku = PRODUCTS_INDEX.get("by_sku", {})
            await msg.answer(
                f"❌ Lookup failed for SKU={raw} norm={norm}\n"
                f"by_sku has norm? {norm in by_sku}\n"
                f"keys sample: {list(by_sku.keys())[:10]}"
            )
    except Exception as e:
        logger.error("debug_lookup failed", exc_info=True)
        await msg.answer(f"❌ Debug lookup error: {e}")

def main_menu_keyboard():
    """Створює клавіатуру головного меню."""
    # Ви можете налаштувати кнопки та посилання на свій розсуд
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔍 Пошук товару за артикулом", callback_data="start_search")],
        [InlineKeyboardButton(text="🛒 Мій кошик", callback_data="show_basket")],
        # Розкоментуйте та вставте посилання на ваш канал
        # [InlineKeyboardButton(text="🛍️ Перейти на канал", url="https://t.me/your_channel_name")]
    ])
    return kb

# ---------------- Unified Cart (GCS-backed) ----------------
CART_TTL_SECONDS = 20 * 60  # 20 хвилин

USER_CART_MSG: Dict[int, Dict[str, int]] = {}  # user_id -> {"chat_id": int, "message_id": int}

def _get_storage_client():
    svc_json = os.getenv("SERVICE_ACCOUNT_JSON")
    if svc_json:
        try:
            info = json.loads(svc_json)
            return storage.Client.from_service_account_info(info)
        except Exception:
            logger.exception("Failed to init storage.Client from SERVICE_ACCOUNT_JSON. Falling back to default client.")
    return storage.Client()

def _cart_blob(user_id: int):
    client = storage.Client()
    bucket = client.bucket(BUCKET_NAME)
    return bucket.blob(f"carts/{user_id}.json")

def load_cart(user_id: int) -> dict:
    blob = _cart_blob(user_id)
    if not blob.exists():
        return {"created_at": datetime.now(timezone.utc).isoformat(), "items": []}

    try:
        data = json.loads(blob.download_as_text())
    except Exception:
        return {"created_at": datetime.now(timezone.utc).isoformat(), "items": []}

    created_at = datetime.fromisoformat(data.get("created_at"))
    if datetime.now(timezone.utc) - created_at > timedelta(seconds=CART_TTL_SECONDS):
        # кошик прострочений — видаляємо
        try:
            blob.delete()
        except:
            pass
        return {"created_at": datetime.now(timezone.utc).isoformat(), "items": []}

    return data

def save_cart(user_id: int, cart: dict):
    blob = _cart_blob(user_id)
    blob.upload_from_string(json.dumps(cart, ensure_ascii=False), content_type="application/json")

def add_to_cart(user_id: int, product: dict, size: str, amount: int):
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

def remove_item_from_cart(user_id: int, idx: int) -> Optional[dict]:
    cart = load_cart(user_id)
    items = cart.get("items", [])
    if 0 <= idx < len(items):
        removed = items.pop(idx)
        cart["items"] = items
        cart["created_at"] = datetime.now(timezone.utc).isoformat()
        save_cart(user_id, cart)
        return removed
    return None

def clear_cart(user_id: int) -> dict:
    blob = _cart_blob(user_id)
    try:
        if blob.exists():
            blob.delete()
    except Exception:
        logger.exception("Failed to delete cart blob for user %s", user_id)
    empty = {"created_at": datetime.now(timezone.utc).isoformat(), "items": []}
    save_cart(user_id, empty)
    USER_CART_MSG.pop(user_id, None)
    return empty

def cart_total(cart_items: List[Dict[str, Any]]) -> int:
    total = 0
    for it in cart_items or []:
        try:
            total += int(it.get("line_total") or (int(it.get("unit_price") or 0) * int(it.get("amount") or 1)))
        except Exception:
            try:
                total += int(float(it.get("line_total") or 0))
            except Exception:
                pass
    return total

async def build_cart_summary_text_and_total(user_id: int) -> Tuple[str, int]:
    cart = load_cart(user_id)
    lines = []
    total = 0
    for i, it in enumerate(cart.get("items", []), start=1):
        price = int(it.get("unit_price") or 0)
        qty = int(it.get("amount") or 1)
        subtotal = price * qty
        total += subtotal
        size = it.get("size") or "-"
        lines.append(f"{i}. {it.get('name')} ({it.get('sku')})\n   📏 Розмір: {size}\n   💵 {price} грн × {qty} = {subtotal} грн")
    body = "\n\n".join(lines) if lines else "🛒 Кошик порожній."
    body += f"\n\n🔔 Загальна сума: {total} грн"
    return body, total

def build_cart_keyboard(user_id: int) -> InlineKeyboardMarkup:
    cart = load_cart(user_id)
    items = cart.get("items", [])
    kb_rows: List[List[InlineKeyboardButton]] = []

    for idx, it in enumerate(items):
        kb_rows.append([InlineKeyboardButton(text=f"🗑️ Видалити {it.get('name')} ({it.get('size')})", callback_data=f"cart:remove:{idx}")])

    kb_rows.append([InlineKeyboardButton(text="➕ Додати товар", callback_data="cart:add")])

    if items:
        kb_rows.append([InlineKeyboardButton(text="🧹 Очистити корзину", callback_data="cart:clear")])
        kb_rows.append([InlineKeyboardButton(text="✅ Оформити замовлення", callback_data="cart:checkout")])

    kb_rows.append([InlineKeyboardButton(text="⬅️ Назад", callback_data="flow:back_to_start")])
    kb_rows.append([InlineKeyboardButton(text="❌ Скасувати замовлення", callback_data="flow:cancel_order")])

    return InlineKeyboardMarkup(inline_keyboard=kb_rows)

async def ensure_or_update_cart_footer(chat_id: int, user_id: int, bot_instance: Optional[Bot] = None):
    bot_obj = bot_instance or bot
    cart = load_cart(user_id)
    total = cart_total(cart.get("items", []))
    text = f"🛒 Ваша корзина — Загальна сума: {total} грн"
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"🧾 Відкрити корзину — {total} грн", callback_data="cart:open")]
    ])

    meta = USER_CART_MSG.get(user_id)
    if meta:
        try:
            await bot_obj.edit_message_text(text=text, chat_id=meta["chat_id"], message_id=meta["message_id"], reply_markup=kb)
            return
        except Exception:
            USER_CART_MSG.pop(user_id, None)

    try:
        sent = await bot_obj.send_message(chat_id, text, reply_markup=kb)
        USER_CART_MSG[user_id] = {"chat_id": sent.chat.id, "message_id": sent.message_id}
    except Exception:
        logger.exception("Cannot send/update cart footer for user %s", user_id)

# backward-compatible aliases
send_or_update_cart_footer = ensure_or_update_cart_footer
update_or_send_cart_footer = ensure_or_update_cart_footer

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

@router.message(CommandStart(deep_link=True))
async def cmd_start_deep_link(msg: Message, command: CommandObject, state: FSMContext):
    """
    Handler for deep-links like: t.me/bot?start=order_test_12345__sku_1056
    """
    try:
        # Розбираємо аргументи
        args = (command.args or "").replace("order_", "").split("__")
        payload = {}
        for arg in args:
            if "=" in arg:
                k, v = arg.split("=", 1)
                payload[k] = v
            elif "sku" in arg:
                parts = arg.split("_")
                if len(parts) > 1:
                    payload["sku"] = parts[-1]
        
        # Визначаємо, чи це тестовий режим (для адміна)
        is_test_mode = "test" in command.args
        
        sku = payload.get("sku")
        if sku:
            product_group = find_product_by_sku(sku)
            if product_group:
                main_product = product_group[0]
                
                # Готуємо опис: замінюємо <br /> на новий рядок
                description = main_product.get("description", "").replace("<br />", "\n")
                
                # Розраховуємо ціни
                drop_price = main_product.get("drop_price")
                final_price = calculate_final_price(drop_price)

                # Формуємо текст повідомлення
                caption_lines = [
                    f"<b>{main_product['name']}</b>",
                    f"\nАртикул: <code>{main_product['vendor_code'] or sku}</code>",
                    f"💰 Ціна: <b>{final_price} грн</b>"
                ]
                # Якщо тестовий режим, додаємо дроп-ціну
                if is_test_mode:
                    caption_lines.append(f"🤫 <i>Дроп: {drop_price} грн</i>")
                
                caption_lines.append(f"\n{description}")
                
                caption = "\n".join(caption_lines)

# ... всередині cmd_start_deep_link ...
# Збираємо унікальні розміри з усієї групи товарів
                sizes_with_offers = []
                unique_sizes = set()
                for p in product_group:
                    for size in p.get("sizes", []):
                        if size not in unique_sizes:
                            sizes_with_offers.append({"size": size, "offer_id": p["offer_id"]})
                            unique_sizes.add(size)

                # Сортуємо розміри: спочатку числа, потім текст
                def sort_key(item):
                    size_str = item['size']
                    # Витягуємо перше число з рядка, якщо воно є
                    numeric_part = re.search(r'\d+', size_str)
                    if numeric_part:
                        return (0, int(numeric_part.group()))
                    else:
                        # Якщо чисел немає, сортуємо за текстом
                        return (1, size_str)

                sizes_with_offers.sort(key=sort_key)

                # Створюємо кнопки розмірів
                kb_rows = []
                chunk_size = 3 # Кількість кнопок в ряду
                for i in range(0, len(sizes_with_offers), chunk_size):
                    row = [
                        InlineKeyboardButton(
                            text=item["size"],
                            callback_data=f"select_size:{item['offer_id']}"
                        ) for item in sizes_with_offers[i:i + chunk_size]
                    ]
                    kb_rows.append(row)

                kb_rows.append([InlineKeyboardButton(text="❌ Скасувати", callback_data="order:cancel")])
                kb = InlineKeyboardMarkup(inline_keyboard=kb_rows)

                if main_product.get("pictures"):
                    await msg.answer_photo(
                        photo=main_product["pictures"][0],
                        caption=caption,
                        reply_markup=kb,
                        parse_mode="HTML"
                    )
                else:
                    await msg.answer(caption, reply_markup=kb, parse_mode="HTML")
            else:
                await msg.answer(f"Товар з артикулом {sku} не знайдено.")
    except Exception:
        logger.exception("Deep link processing error")
        await msg.answer("Помилка обробки запиту. Спробуйте ще раз.")


# ---------------- Command: /find ----------------
RESULTS_PER_PAGE = 10

def paginate_products(matches, page: int):
    start = page * RESULTS_PER_PAGE
    end = start + RESULTS_PER_PAGE
    items = matches[start:end]

    buttons = []
    for p in items:
        text = f"{p['name']} ({p['sku']})"
        buttons.append([InlineKeyboardButton(text=text, callback_data=f"product:{p['offer_id']}")])

    nav_buttons = []
    if page > 0:
        nav_buttons.append(InlineKeyboardButton("⬅️ Назад", callback_data=f"page:{page-1}"))
    if end < len(matches):
        nav_buttons.append(InlineKeyboardButton("➡️ Далі", callback_data=f"page:{page+1}"))
    if nav_buttons:
        buttons.append(nav_buttons)

    return InlineKeyboardMarkup(inline_keyboard=buttons)


@router.message(Command("find"))
async def cmd_find(message: Message, command: CommandObject, state: FSMContext):
    query = (command.args or "").strip()
    if not query:
        await message.answer("❌ Введіть запит. Приклад: /find термо")
        return

    matches = search_products(query)
    if not matches:
        await message.answer("❌ Товарів не знайдено.")
        return

    await state.update_data(find_results=matches)
    kb = paginate_products(matches, 0)
    await message.answer(f"🔎 Знайдено {len(matches)} товарів. Оберіть зі списку:", reply_markup=kb)

# ---------------- Helpers Обробники!  ----------------
@router.message(SearchState.waiting_for_input, F.text)
async def handle_manual_search(message: Message, state: FSMContext):
    search_query = message.text.strip()
    await state.clear()
    product_group = find_product_by_sku(search_query)
    if not product_group:
        await message.answer(f"❌ На жаль, за запитом «{search_query}» нічого не знайдено.")
        return
    fake_command = CommandObject(prefix="/", command="start", args=f"manual_search__sku_{product_group[0]['vendor_code'] or product_group[0]['offer_id']}")
    await cmd_start_deep_link(message, fake_command, state)

# Обробник команди /basket - показує кошик
@router.message(Command("basket"))
async def show_cart_command_handler(msg: Message, state: FSMContext):
    await show_cart(msg.from_user.id, msg.chat.id, bot, state)

# Обробник колбеку show_cart - також показує кошик
@router.callback_query(F.data == "show_cart")
async def show_cart_callback_handler(cb: CallbackQuery, state: FSMContext):
    await cb.message.delete()
    await show_cart(cb.from_user.id, cb.message.chat.id, bot, state)
    await cb.answer()

# Головна функція для відображення кошика
async def show_cart(user_id: int, chat_id: int, bot: Bot, state: FSMContext):
    cart = await load_cart(user_id)
    if not cart:
        await bot.send_message(chat_id, "🛒 Ваш кошик порожній.", reply_markup=empty_cart_keyboard())
        return

    cart_text_lines = ["<b>🛒 Ваш кошик:</b>\n"]
    total_price = 0
    clear_buttons = []
    
    for item_key, item in cart.items():
        final_price = calculate_final_price(item.get("drop_price", 0)) * item.get("quantity", 0)
        total_price += final_price
        cart_text_lines.append(
            f"• <b>{item['name']}</b>\n  Розмір: {item['size']}, К-сть: {item['quantity']} | Ціна: {final_price} грн"
        )
        clear_buttons.append(
            [InlineKeyboardButton(text=f"❌ Видалити «{item['name']}»", callback_data=f"cart:remove:{item_key}")]
        )

    cart_text_lines.append(f"\n<b>✨ Загальна сума: {total_price} грн</b>")
    
    kb = InlineKeyboardMarkup(inline_keyboard=clear_buttons + [
        [InlineKeyboardButton(text="✅ Оформити замовлення", callback_data="order:start_checkout")],
        [InlineKeyboardButton(text="🗑️ Повністю очистити кошик", callback_data="cart:clear_all")],
        [InlineKeyboardButton(text="➕ Додати ще товар", callback_data="add_more_items")]
    ])
    await bot.send_message(chat_id, "\n".join(cart_text_lines), parse_mode="HTML", reply_markup=kb)

# Обробник для кнопки "Скасувати" під час вибору товару
@router.callback_query(F.data == "order:cancel")
async def cancel_order_handler(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    await cb.message.delete()
    await cb.message.answer("Замовлення скасовано. Ви можете почати пошук знову.", reply_markup=main_menu_keyboard())
    await cb.answer()


# Крок 1: Користувач натискає на кнопку з розміром
@router.callback_query(F.data.startswith("select_size:"))
async def select_size_handler(cb: CallbackQuery, state: FSMContext):
    offer_id = cb.data.split(":")[1]
    product = PRODUCTS_INDEX["by_offer"].get(offer_id)
    if not product:
        await cb.answer("Помилка, товар не знайдено.", show_alert=True)
        return
    await state.update_data(current_offer_id=offer_id)
    await state.set_state(OrderForm.quantity)
    await cb.message.edit_caption(
        caption=f"✅ Ви обрали: <b>{product.get('name')}</b> (Розмір: {product.get('sizes')[0]})\n\nТепер введіть бажану кількість:",
        parse_mode="HTML", reply_markup=None
    )
    await cb.answer()

# Крок 2: Користувач вводить кількість
@router.message(OrderForm.quantity)
async def get_quantity_handler(msg: Message, state: FSMContext):
    # Перевіряємо, чи введено число
    if not msg.text or not msg.text.isdigit() or int(msg.text) < 1:
        await msg.answer("Будь ласка, введіть кількість у вигляді числа (наприклад: 1).")
        return
        
    quantity = int(msg.text)
    user_data = await state.get_data()
    offer_id = user_data.get('current_offer_id')
    
    # Перевіряємо, чи є в нас товар для додавання
    if not offer_id:
        await msg.answer("Щось пішло не так. Будь ласка, почніть пошук товару знову.")
        await state.clear()
        return
        
    product = PRODUCTS_INDEX["by_offer"].get(offer_id)
    
    # Завантажуємо кошик користувача
    cart = await load_cart(msg.from_user.id)
    
    # Додаємо або оновлюємо товар в кошику
    cart[str(offer_id)] = {
        "name": product.get("name"), "vendor_code": product.get("vendor_code"),
        "size": product.get("sizes")[0] if product.get("sizes") else 'N/A',
        "quantity": quantity, "drop_price": product.get("drop_price"), "offer_id": offer_id,
    }
    
    # Зберігаємо оновлений кошик
    await save_cart(msg.from_user.id, cart)
    
    # Очищуємо стан FSM, щоб користувач міг шукати інші товари
    await state.clear()
    
    # Повідомляємо користувача та пропонуємо подальші дії
    await msg.answer(
        f"✅ Товар «<b>{product.get('name')}</b>» додано до кошика.", parse_mode="HTML",
        reply_markup=cart_menu_keyboard()
    )

@router.callback_query(F.data == "order:start_checkout")
async def start_checkout_handler(cb: CallbackQuery, state: FSMContext):
    cart = await load_cart(cb.from_user.id)
    if not cart:
        await cb.answer("Ваш кошик порожній!", show_alert=True)
        return
    await state.set_state(OrderForm.full_name)
    await cb.message.edit_text(
        "Для оформлення замовлення, будь ласка, введіть ваше <b>Прізвище, Ім'я та По-батькові</b>:",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Скасувати", callback_data="order:cancel_checkout")]])
    )
    await cb.answer()

# Крок 4: Обробка ПІБ (з вашою валідацією!)
@router.message(OrderForm.full_name)
async def process_full_name(message: Message, state: FSMContext):
    # Тут використовується ваша потужна логіка валідації!
    is_valid, error_message = validate_pib(message.text)
    if not is_valid:
        await message.answer(error_message)
        return
    
    # Робимо перші літери великими
    full_name = " ".join([p.strip().capitalize() for p in message.text.strip().split()])
    
    await state.update_data(full_name=full_name)
    await state.set_state(OrderForm.phone_number)
    await message.answer("Дякую. Тепер введіть ваш номер телефону:")

# Крок 5: Обробка телефону (з вашою валідацією!)
@router.message(OrderForm.phone_number)
async def process_phone_number(message: Message, state: FSMContext):
    # Використовуємо вашу функцію валідації
    is_valid, result = validate_phone(message.text)
    if not is_valid:
        await message.answer(result) # result тут - це повідомлення про помилку
        return

    await state.update_data(phone_number=result) # result тут - це нормалізований номер
    await state.set_state(OrderForm.delivery_address)
    await message.answer("Чудово. Введіть адресу доставки (місто та номер відділення Нової Пошти):")

@router.message(OrderForm.phone_number, F.text)
async def process_phone_number_handler(message: Message, state: FSMContext):
    is_valid, normalized_phone = validate_phone(message.text)
    if not is_valid:
        await message.answer(normalized_phone) # Тут повертається повідомлення про помилку
        return

    await state.update_data(phone_number=normalized_phone)
    await state.set_state(OrderForm.delivery_address)
    await message.answer("Чудово. Введіть адресу доставки (місто та номер відділення Нової Пошти):")

@router.callback_query(F.data == "order:cancel_checkout")
async def cancel_checkout_handler(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    await cb.message.edit_text("Оформлення скасовано.")
    await show_cart(cb.from_user.id, cb.message.chat.id, bot, state) # Показуємо кошик знову
    await cb.answer()

# ---------------- Publish Test ----------------
@router.message(Command("publish_test"))
async def cmd_publish_test(msg: Message):
    """
    Адмінська команда — публікація тестового поста в тестовий канал.
    Використовує:
    - ADMIN_ID (перевірка прав)
    - TEST_CHANNEL (ID каналу для поста)
    - TEST_CHANNEL_URL (invite link для fallback кнопки)
    """
    try:
        admin_id = int(os.getenv("ADMIN_ID", "0") or 0)
    except Exception:
        admin_id = 0

    if msg.from_user.id != admin_id:
        await msg.answer("⚠️ У вас немає прав на виконання цієї команди.")
        return

    # Перевіримо TEST_CHANNEL
    raw_channel = os.getenv("TEST_CHANNEL")
    if not raw_channel:
        await msg.answer("⚠️ TEST_CHANNEL не встановлений у .env")
        return
    try:
        channel_chat_id = int(raw_channel)
    except Exception:
        await msg.answer(f"⚠️ TEST_CHANNEL має бути числом (наприклад -100123456789). Зараз: {raw_channel}")
        return

    # Тестовий текст поста
    text = (
        "🧪 Тестовий пост для перевірки товару:\n\n"
        "👕 Гольф чорний\n"
        "📌 Артикул: 1056\n"
        "💵 Ціна: 350 грн\n"
        "📏 Доступні розміри: 46–64"
    )

    # Кнопка "Замовити" (deep link у бота)
    kb = get_order_keyboard(post_id=12345, sku="1056", test=True)

    # Fallback кнопка "Відкрити канал" (якщо бот не може постити напряму)
    invite_url = os.getenv("TEST_CHANNEL_URL")
    fallback_kb = None
    if invite_url:
        fallback_kb = InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="📢 Відкрити канал", url=TEST_CHANNEL_URL)]
            ]
        )

    try:
        # Публікуємо у канал
        await bot.send_message(chat_id=channel_chat_id, text=text, reply_markup=kb, parse_mode="HTML")
        await msg.answer("✅ Тестовий пост (Гольф чорний) опубліковано в тестовому каналі.")
    except Exception as e:
        logger.exception("Помилка публікації тестового поста в канал")
        await msg.answer(
            f"⚠️ Помилка при публікації у канал: {e}\nПереконайтеся, що бот доданий у канал та має права публікації."
        )
        if fallback_kb:
            await msg.answer("🔗 Можна вручну відкрити канал:", reply_markup=fallback_kb)

# ---------------- Refresh Cache ----------------
@router.message(Command("refresh_cache"))
async def cmd_refresh_cache(msg: Message):
    """
    Адмінська команда — примусове оновлення кешу вигрузки.
    Використовує ADMIN_ID з .env для перевірки прав.
    """
    try:
        admin_id = int(os.getenv("ADMIN_ID", "0") or 0)
    except Exception:
        admin_id = 0

    if msg.from_user.id != admin_id:
        await msg.answer("⚠️ У вас немає прав на виконання цієї команди.")
        return

    await msg.answer("⏳ Оновлюю кеш вигрузки...")
    text = await load_products_export(force=True)

    if text:
        await msg.answer("✅ Кеш оновлено успішно.")
    else:
        await msg.answer("⚠️ Помилка при оновленні кешу. Перевір логи.")

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

# --- Розрахунок ціни для клієнта (ВИПРАВЛЕНО) ---

def aggressive_round_up(n):
    """
    Ваша функція для агресивного округлення ціни.
    """
    if n < 100:
        return math.ceil(n / 10) * 10
    length = len(str(int(n)))
    if length > 2:
        base = 10**(length - 2)
        return math.ceil(n / base) * base
    return math.ceil(n)
    
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
    global bot, dp, ASYNC_LOOP
    ASYNC_LOOP = asyncio.get_running_loop()

    # Ініціалізуємо хмарні сервіси
    if USE_GDRIVE: await init_gdrive()
    if USE_GCS: init_gcs()
        
    # Налаштовуємо бота та диспетчер
    storage = MemoryStorage()
    bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher(storage=storage)
    
    # Підключаємо роутер ТІЛЬКИ ОДИН РАЗ
    dp.include_router(router)

    # Запускаємо Telethon
    if api_id and api_hash:
        asyncio.create_task(start_telethon_client(ASYNC_LOOP))

    # Запускаємо веб-сервер
    threading.Thread(target=lambda: app.run(host="0.0.0.0", port=int(os.environ.get('PORT', 8080))), daemon=True).start()
    
    # Встановлюємо команди та вебхук
    await setup_commands()
    await bot.delete_webhook(drop_pending_updates=True)
    await bot.set_webhook(WEBHOOK_URL)
    logger.info("✅ Bot started and webhook is set to %s", WEBHOOK_URL)
    
    # Завантажуємо товари при старті
    await refresh_products_cache_on_startup()
    
    # Тримаємо програму живою
    await asyncio.Event().wait()
    
    # ---------------- start Telethon ----------------
    try:
        # ASYNC_LOOP вже встановлено вище як asyncio.get_running_loop()
        asyncio.create_task(start_telethon_client(ASYNC_LOOP))
        logger.info("Telethon start task scheduled.")
    except Exception:
        logger.exception("Failed to schedule Telethon client start")

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
