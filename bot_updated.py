# -*- coding: utf-8 -*-
"""
Фінальна версія Етапу 1
- Робочий репостинг з Telethon (нові та старі пости)
- Інтеграція з Gemini AI для рерайтингу
- Збереження на Google Drive з правильною структурою папок
- Ідеальна картка товару з цінами та описом
- Правильно відсортована клавіатура розмірів у 3 колонки
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
import aiohttp
import xml.etree.ElementTree as ET
import math
from typing import Optional, List, Dict, Any
from collections import defaultdict
from dotenv import load_dotenv
from flask import Flask, request
from urllib.parse import quote, unquote

from aiogram import Bot, Dispatcher, Router, F, types
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import Command, CommandStart, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import StatesGroup, State
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery, BotCommand, FSInputFile

from telethon import TelegramClient, events

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from html import unescape
import tempfile
import google.generativeai as genai
import random


# ---------------- КРОК 1: Ініціалізація базових додатків ----------------
app = Flask(__name__)
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("taverna")
logger.setLevel(logging.DEBUG)


# ---------------- КРОК 2: Завантаження ВСІХ змінних з .env ----------------
BOT_TOKEN = os.getenv("BOT_TOKEN")
BOT_USERNAME = os.getenv("BOT_USERNAME")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))
TEST_CHANNEL = int(os.getenv("TEST_CHANNEL", "0"))
MAIN_CHANNEL = os.getenv("MAIN_CHANNEL")
TEST_CHANNEL_URL = os.getenv("TEST_CHANNEL_URL")

TG_API_ID = int(os.getenv("TG_API_ID", "0"))
TG_API_HASH = os.getenv("TG_API_HASH")
SESSION_NAME = os.getenv("SESSION_NAME", "bot1")
SUPPLIER_CHANNEL = os.getenv("SUPPLIER_CHANNEL")
SUPPLIER_NAME = os.getenv("SUPPLIER_NAME", "Supplier")

MYDROP_API_KEY = os.getenv("MYDROP_API_KEY")
MYDROP_EXPORT_URL = os.getenv("MYDROP_EXPORT_URL")
MYDROP_ORDERS_URL = os.getenv("MYDROP_ORDERS_URL")
ORDERS_DIR = os.getenv("ORDERS_DIR", "/tmp/orders")
Path(ORDERS_DIR).mkdir(parents=True, exist_ok=True)

USE_GDRIVE = os.getenv("USE_GDRIVE", "false").lower() in ("true", "1", "yes")
GDRIVE_FOLDER_ID = os.getenv("GDRIVE_FOLDER_ID")
GDRIVE_ORDERS_FOLDER_NAME = os.getenv("GDRIVE_ORDERS_FOLDER_NAME", "Zamovlenya")
SERVICE_ACCOUNT_JSON = os.getenv("SERVICE_ACCOUNT_JSON")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
TEST_MODE = os.getenv("TEST_MODE", "false").lower() == "true"

WEBHOOK_PATH = "/webhook"
WEBHOOK_URL = os.getenv("WEBHOOK_URL")
REVIEW_CHAT = int(os.getenv("REVIEW_CHAT", str(ADMIN_ID)))
POSTED_IDS_FILE_PATH = os.getenv("POSTED_IDS_FILE_PATH", "posted_ids.txt")


# ---------------- КРОК 3: Функція для логування змінних ----------------
def check_env_vars():
    """Ця функція тепер лише для логування."""
    print("=== Checking ENV variables ===")
    if not BOT_TOKEN:
        print("❌ ERROR: BOT_TOKEN is missing")
        sys.exit(1)

    env_vars = [
        "BOT_TOKEN", "BOT_USERNAME", "ADMIN_ID", "TEST_CHANNEL", "MAIN_CHANNEL", "TEST_CHANNEL_URL",
        "TG_API_ID", "TG_API_HASH", "SESSION_NAME", "SUPPLIER_CHANNEL", "SUPPLIER_NAME",
        "MYDROP_API_KEY", "MYDROP_EXPORT_URL", "MYDROP_ORDERS_URL",
        "SERVICE_ACCOUNT_JSON", "USE_GDRIVE", "GDRIVE_FOLDER_ID", 
        "GDRIVE_ORDERS_FOLDER_NAME", "GEMINI_API_KEY", "WEBHOOK_URL", "POSTED_IDS_FILE_PATH"
    ]
    for var in env_vars:
        value = os.getenv(var)
        if value:
            if var.upper().endswith(("KEY", "TOKEN", "HASH", "SECRET", "PASSWORD")) or "SERVICE_ACCOUNT_JSON" in var:
                masked = str(value)[:4] + "...(masked)"
            else:
                masked = str(value) if len(str(value)) < 60 else str(value)[:57] + "..."
            print(f"✅ {var} = {masked}")
        else:
            print(f"⚠️ {var} is not set")
    print("=== End ENV check ===")

check_env_vars()
logger.debug("USE_GDRIVE = %s", USE_GDRIVE)


# ---------------- КРОК 4: Ініціалізація сервісів ----------------
PRODUCTS_INDEX = {}
ASYNC_LOOP: Optional[asyncio.AbstractEventLoop] = None
TELETHON_CLIENT: Optional[TelegramClient] = None
TELETHON_STARTED = False

def init_gdrive():
    if not USE_GDRIVE: return None
    try:
        if SERVICE_ACCOUNT_JSON and SERVICE_ACCOUNT_JSON.strip().startswith("{"):
            info = json.loads(SERVICE_ACCOUNT_JSON)
            creds = Credentials.from_service_account_info(info, scopes=["https://www.googleapis.com/auth/drive.file"])
            return build("drive", "v3", credentials=creds, cache_discovery=False)
        else:
            logger.error("❌ SERVICE_ACCOUNT_JSON is not a valid JSON. GDrive will not work.")
            return None
    except Exception:
        logger.exception("❌ GDrive init failed")
        return None

GDRIVE_SERVICE = init_gdrive()

# ---------------- AI Text Rewriter (Google GenAI SDK) ----------------
async def rewrite_text_with_ai(text_to_rewrite: str, product_name: str) -> str:
    if not GEMINI_API_KEY:
        logger.warning("GEMINI_API_KEY не налаштовано. Рерайтинг тексту пропускається.")
        return text_to_rewrite

    try:
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash-latest",
            system_instruction=(
                "Ти – професійний копірайтер для Телеграм-магазину тактичного та військового одягу 'TAVERNA'. "
                "Твоє завдання – переписати опис товару. Стиль: впевнений, професійний, з акцентом на якість та надійність. "
                "Структуруй текст, використовуй марковані списки для характеристик (напр. ▪️ або ✅). "
                "Використовуй доречні емодзі (напр. 🛡️, 💪, 🎯, 🔥). "
                "Не додавай ціну, артикул, посилання або заклики до дії. Тільки опис."
            )
        )
        prompt = f"Назва товару: '{product_name}'. Оригінальний опис для рерайту:\n---\n{text_to_rewrite}"
        response = await model.generate_content_async(
            prompt,
            generation_config=genai.types.GenerationConfig(temperature=0.6, max_output_tokens=4096)
        )
        rewritten_text = response.text.strip()
        logger.info("✅ Google Gemini SDK успішно переписав текст для '%s'", product_name)
        return rewritten_text
    except Exception as e:
        logger.exception(f"❌ Виняток під час запиту до Gemini API через SDK: {e}")
        return text_to_rewrite

# ---------------- XML Parsing & Product Indexing ----------------
def normalize_sku(s: str) -> str:
    if not s: return ""
    s = unescape(str(s)).strip()
    s = re.sub(r'[\u200B\uFEFF]', '', s)
    s = re.sub(r'[^0-9A-Za-z]+', '', s)
    return s.lower()

def build_products_index_from_xml(text: str):
    global PRODUCTS_INDEX
    PRODUCTS_INDEX = {
        "all_products": [], 
        "by_sku": defaultdict(list),
        "by_offer": {}
    }
    try:
        it = ET.iterparse(io.StringIO(text), events=("end",))
        product_count = 0
        for _, elem in it:
            if elem.tag == 'offer':
                offer_id = elem.attrib.get("id", "").strip()
                name = (elem.find('name').text or "").strip()
                price_txt = (elem.find('price').text or "0").strip()
                try: drop_price = float(price_txt)
                except (ValueError, TypeError): drop_price = None
                vendor_code_tag = elem.find('vendorCode')
                vendor_code = (vendor_code_tag.text or "").strip() if vendor_code_tag is not None else ""

                if not offer_id or not name or not drop_price:
                    elem.clear()
                    continue
                
                description_tag = elem.find('description')
                description = (description_tag.text or "").strip() if description_tag is not None else ""
                pictures = [pic.text.strip() for pic in elem.findall('picture') if pic.text]
                sizes = [p.text.strip() for p in elem.findall('param') if p.attrib.get('name', '').lower() in ('размер', 'розмір', 'size') and p.text]

                product = {
                    "offer_id": offer_id, "vendor_code": vendor_code, "name": name,
                    "description": description, "pictures": pictures, "sizes": sizes, "drop_price": drop_price,
                }
                PRODUCTS_INDEX["all_products"].append(product)
                PRODUCTS_INDEX["by_offer"][offer_id] = product

                keys_to_index = {vendor_code, normalize_sku(vendor_code)}
                for key in keys_to_index:
                    if key:
                        PRODUCTS_INDEX["by_sku"][key].append(product)
                
                product_count += 1
                elem.clear()
        
        logger.info(f"✅ Product index built: {product_count} products total.")
    except Exception:
        logger.exception("❌ CRITICAL ERROR during XML parsing")

def find_product_by_sku(raw: str) -> Optional[List[dict]]:
    if not raw: return None
    raw_norm = normalize_sku(raw)
    
    # 1. Точний пошук за нормалізованим артикулом
    exact_matches = PRODUCTS_INDEX.get("by_sku", {}).get(raw_norm, [])
    if exact_matches:
        # Створюємо копії, щоб не змінювати оригінальний кеш
        matches_copy = [p.copy() for p in exact_matches]
        for p in matches_copy: p['match_type'] = 'exact'
        logger.debug(f"Lookup EXACT success for SKU='{raw}': Found {len(matches_copy)} products.")
        return matches_copy

    # 2. Пошук за входженням (менш точний)
    suggestion_matches = []
    processed_offers = set()
    for key, products in PRODUCTS_INDEX.get("by_sku", {}).items():
        if raw_norm in key and key != raw_norm: # шукаємо тільки часткові збіги
            for p in products:
                if p['offer_id'] not in processed_offers:
                    p_copy = p.copy()
                    p_copy['match_type'] = 'suggestion'
                    suggestion_matches.append(p_copy)
                    processed_offers.add(p['offer_id'])
    
    if suggestion_matches:
        logger.debug(f"Lookup SUGGESTION success for SKU='{raw}': Found {len(suggestion_matches)} products.")
        return suggestion_matches
        
    logger.debug(f"Lookup failed for SKU='{raw}': No products found.")
    return None

# ---------------- Google Drive Helpers ----------------
def gdrive_upload_file(local_path: str, mime_type: str, filename: str, parent_folder_id: str):
    if not GDRIVE_SERVICE: return None
    try:
        body = {"name": filename, "parents": [parent_folder_id]}
        media = MediaFileUpload(local_path, mimetype=mime_type)
        GDRIVE_SERVICE.files().create(body=body, media_body=media, fields="id").execute()
        logger.info(f"GDrive: Файл '{filename}' успішно завантажено.")
    except Exception:
        logger.exception("❌ GDrive upload failed")

def gdrive_find_or_create_folder(folder_name: str, parent_folder_id: str):
    if not GDRIVE_SERVICE: return None
    try:
        query = f"'{parent_folder_id}' in parents and name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        response = GDRIVE_SERVICE.files().list(q=query, spaces='drive', fields='files(id)').execute()
        files = response.get('files', [])
        
        if files:
            return files[0].get('id')

        logger.info(f"GDrive: Папку '{folder_name}' не знайдено. Створюю нову...")
        folder_metadata = {'name': folder_name, 'mimeType': 'application/vnd.google-apps.folder', 'parents': [parent_folder_id]}
        folder = GDRIVE_SERVICE.files().create(body=folder_metadata, fields='id').execute()
        return folder.get('id')
    except Exception:
        logger.exception(f"❌ Помилка під час пошуку/створення папки '{folder_name}'")
        return None

# ---------------- Posted Posts DB Helpers ----------------
POSTED_IDS = set()

def load_posted_ids():
    global POSTED_IDS
    try:
        if os.path.exists(POSTED_IDS_FILE_PATH):
            with open(POSTED_IDS_FILE_PATH, "r") as f:
                POSTED_IDS = {line.strip() for line in f if line.strip()}
            logger.info(f"Завантажено {len(POSTED_IDS)} ID опублікованих постів.")
    except Exception as e:
        logger.error(f"Помилка завантаження файлу posted_ids: {e}")

def save_posted_id(post_id: str):
    if post_id not in POSTED_IDS:
        POSTED_IDS.add(post_id)
        try:
            with open(POSTED_IDS_FILE_PATH, "a") as f:
                f.write(f"{post_id}\n")
        except Exception as e:
            logger.error(f"Помилка збереження ID поста {post_id} у файл: {e}")

# ---------------- Card Formatting Helpers ----------------
def aggressive_round(price: float) -> int:
    if price is None: return 0
    p = float(price)
    if p < 100: base = 5
    elif p < 1000: base = 10
    elif p < 5000: base = 50
    else: base = 100
    return int(math.ceil(p / base) * base)

def format_product_card(product: dict, user_id: int) -> str:
    """Формує повний текст картки товару з описом та цінами."""
    name = product.get('name', 'Назва не вказана')
    if product.get('match_type') == 'suggestion':
        name = f"🤔 Можливо, ви шукали: <b>{name}</b>"
    else:
        name = f"<b>{name}</b>"

    vendor_code = product.get('vendor_code', 'не вказано')
    description = product.get('description', 'Опис відсутній.')
    drop_price = product.get('drop_price')

    price_block = []
    if drop_price:
        final_price = aggressive_round(float(drop_price) * 1.33)
        price_block.append(f"<b>💰 Ціна: {final_price} грн</b>")
        if user_id == ADMIN_ID:
            price_block.append(f"<i>(Дроп: {drop_price} грн)</i>")
    
    text_parts = [
        name + "\n",
        f"<b>Артикул:</b> <code>{vendor_code}</code>\n",
        "\n".join(price_block),
        "\n" + "—" * 20 + "\n",
        f"<b>Опис:</b>\n{description}"
    ]
    return "\n".join(text_parts)

def build_sorted_size_keyboard(products: list, back_url: str = None) -> InlineKeyboardMarkup:
    """Створює клавіатуру розмірів у 3 колонки, відсортовану, з новими кнопками."""
    offers_with_sizes = {}
    for p in products:
        size = p.get("sizes")[0] if p.get("sizes") else None
        if size:
            offers_with_sizes[size] = p.get("offer_id")

    numeric_sizes, text_sizes = [], []
    for size, offer_id in offers_with_sizes.items():
        numeric_part_match = re.match(r'^\d+', size)
        if numeric_part_match:
            numeric_sizes.append((int(numeric_part_match.group(0)), size, offer_id))
        else:
            text_sizes.append((size, offer_id))
    
    numeric_sizes.sort()
    text_sizes.sort()

    sorted_sizes = [item[1:] for item in numeric_sizes] + text_sizes
    buttons = [InlineKeyboardButton(text=size, callback_data=f"select_size:{offer_id}") for size, offer_id in sorted_sizes]
    
    kb_rows = []
    if buttons:
        num_rows = (len(buttons) + 2) // 3
        for i in range(num_rows):
            row = []
            if i < len(buttons): row.append(buttons[i])
            if i + num_rows < len(buttons): row.append(buttons[i + num_rows])
            if i + 2 * num_rows < len(buttons): row.append(buttons[i + 2 * num_rows])
            if row: kb_rows.append(row)

    nav_buttons = []
    if back_url:
        nav_buttons.append(InlineKeyboardButton(text="↩️ На канал", url=back_url))
    nav_buttons.append(InlineKeyboardButton(text="❌ Скасувати", callback_data="cancel_action"))
    kb_rows.append(nav_buttons)
    
    return InlineKeyboardMarkup(inline_keyboard=kb_rows)

# ---------------- Telethon Background Service ----------------
async def process_and_post_message(msg):
    """
    Глобальна функція для повної обробки та постингу повідомлення.
    """
    try:
        unique_post_id = f"{msg.chat.id}_{msg.id}"
        if unique_post_id in POSTED_IDS:
            logger.info(f"Пост {unique_post_id} вже було опубліковано. Пропуск.")
            return

        text = msg.text or ""
        is_test_mode = msg.chat_id == TEST_CHANNEL

        SKU_REGEX = re.compile(r'(?:артикул|арт\.|артікул|sku|код|vendorCode|vendor_code)[^\d\-:]*([0-9A-Za-z\-\_]{2,30})', flags=re.I)
        sku_found = (m.group(1) if (m := SKU_REGEX.search(text)) else None)
        if not sku_found: return
        
        products = find_product_by_sku(sku_found)
        if not products: return
        product = products[0]

        vendor_code = product.get("vendor_code") or sku_found
        name = product.get("name") or vendor_code
        description = await rewrite_text_with_ai(product.get("description", ""), name)

        if USE_GDRIVE and GDRIVE_SERVICE and GDRIVE_FOLDER_ID:
            photo_folder_id = gdrive_find_or_create_folder("FotoLandLiz", GDRIVE_FOLDER_ID)
            post_folder_id = gdrive_find_or_create_folder("PostLandLiz", GDRIVE_FOLDER_ID)
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
            if msg.photo and photo_folder_id:
                with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmpf:
                    await msg.download_media(file=tmpf.name)
                    gdrive_upload_file(tmpf.name, "image/jpeg", f"foto_ark_{vendor_code}_{timestamp}.jpg", photo_folder_id)
                os.remove(tmpf.name)
            if post_folder_id:
                with tempfile.NamedTemporaryFile(suffix=".txt", delete=False, mode="w", encoding="utf-8") as tmp_txt:
                    tmp_txt.write(description)
                    gdrive_upload_file(tmp_txt.name, "text/plain", f"post_ark_{vendor_code}_{timestamp}.txt", post_folder_id)
                os.remove(tmp_txt.name)
        
        drop_price = product.get("drop_price")
        price_text = f"<b>{aggressive_round(drop_price * 1.33)} грн</b>" if drop_price else "<b>Ціну уточнюйте</b>"
        
        repost_text = f"📦 <b>{name}</b>\n\nАртикул: <code>{vendor_code}</code>\nЦіна: {price_text}\n\n"
        if is_test_mode:
            repost_text = f"📦 <b>{name}</b>\n\nАртикул: <code>{vendor_code}</code>\n\nДроп ціна: {drop_price} грн\nЦіна для клієнта: {price_text}\n\n"
        
        repost_text += (description[:3500] + "...") if len(description) > 3500 else description
        
        target_channel = TEST_CHANNEL if is_test_mode else MAIN_CHANNEL
        sent_message = await bot.send_photo(chat_id=target_channel, photo=product["pictures"][0], caption=repost_text, parse_mode="HTML") if product.get("pictures") else await bot.send_message(chat_id=target_channel, text=repost_text, parse_mode="HTML")
        
        if sent_message:
            channel_username = (sent_message.chat.username or f"c/{str(target_channel).replace('-100', '')}")
            post_link = f"https://t.me/{channel_username}/{sent_message.message_id}"
            new_deep_link = f"https://t.me/{BOT_USERNAME}?start=show_sku_{vendor_code}_from_{quote(post_link)}"
            new_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🛒 Замовити", url=new_deep_link)]])
            await bot.edit_message_reply_markup(chat_id=target_channel, message_id=sent_message.message_id, reply_markup=new_kb)

        save_posted_id(unique_post_id)
        logger.info(f"Пост {unique_post_id} успішно оброблено.")
    except Exception as e:
        logger.exception(f"Помилка під час обробки поста {getattr(msg, 'id', 'N/A')}: {e}")

async def random_post_scheduler():
    await asyncio.sleep(60)
    logger.info("🚀 Запущено планувальник випадкових постів.")
    while True:
        try:
            delay = random.uniform(5 * 60, 30 * 60)
            logger.info(f"Планувальник: наступний запуск через {delay/60:.2f} хв.")
            await asyncio.sleep(delay)

            if not TELETHON_CLIENT or not TELETHON_CLIENT.is_connected(): continue

            entity = await TELETHON_CLIENT.get_entity(SUPPLIER_CHANNEL)
            total_messages = (await TELETHON_CLIENT.get_messages(entity, limit=0)).total

            for _ in range(20):
                random_offset_id = random.randint(1, total_messages - 1)
                messages = await TELETHON_CLIENT.get_messages(entity, limit=1, offset_id=random_offset_id)
                if messages and f"{messages[0].chat.id}_{messages[0].id}" not in POSTED_IDS:
                    logger.info(f"Планувальник: знайдено унікальний старий пост ID: {messages[0].id}. Обробка...")
                    await process_and_post_message(messages[0])
                    break
        except Exception as e:
            logger.exception(f"Помилка в планувальнику випадкових постів: {e}")
            await asyncio.sleep(60)

async def start_telethon_client(loop: asyncio.AbstractEventLoop):
    global TELETHON_CLIENT, TELETHON_STARTED
    try:
        TELETHON_CLIENT = TelegramClient(SESSION_NAME, TG_API_ID, TG_API_HASH, loop=loop)
        await TELETHON_CLIENT.start()
        TELETHON_STARTED = True
        logger.info("Telethon client started; listening supplier channel: %s", SUPPLIER_CHANNEL)
    except Exception:
        logger.exception("Failed to start Telethon client")
        return

    @TELETHON_CLIENT.on(events.NewMessage(chats=[SUPPLIER_CHANNEL]))
    async def supplier_msg_handler(event: events.NewMessage.Event):
        delay = random.uniform(1 * 60, 20 * 60)
        logger.info(f"Отримано новий пост {event.message.id}. Затримка перед постингом: {delay/60:.2f} хв.")
        await asyncio.sleep(delay)
        await process_and_post_message(event.message)

# ---------------- Aiogram Bot & FSM ----------------
bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher(storage=MemoryStorage())
router = Router()
dp.include_router(router)

class OrderFSM(StatesGroup):
    awaiting_sku_search = State()
    # Інші стани для кошика та замовлення будуть тут

# ---------------- Aiogram Handlers ----------------
@router.message(CommandStart())
async def cmd_start(msg: Message, state: FSMContext):
    await state.clear()
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🛍️ Каталог товарів у каналі", url=f"https://t.me/{MAIN_CHANNEL.replace('@', '')}")],
        [InlineKeyboardButton(text="🔎 Пошук товару за артикулом", callback_data="start_search")]
    ])
    await msg.answer("Вітаю! 👋\n\nЯ — ваш бот-помічник для замовлень.\nОберіть дію:", reply_markup=kb)

@router.callback_query(F.data == "start_search")
async def cb_start_search(cb: CallbackQuery, state: FSMContext):
    await state.set_state(OrderFSM.awaiting_sku_search)
    await cb.message.answer("Введіть артикул товару для пошуку:")
    await cb.answer()

@router.callback_query(F.data == "cancel_action")
async def cb_cancel_action(cb: CallbackQuery, state: FSMContext):
    try:
        await cb.message.delete()
    except Exception:
        pass # Ignore if message is already deleted
    await cmd_start(cb.message, state)
    await cb.answer()

@router.message(OrderFSM.awaiting_sku_search)
async def process_sku_search(msg: Message, state: FSMContext):
    await state.clear()
    raw_sku = msg.text.strip()
    products = find_product_by_sku(raw_sku)
    
    if not products:
        await msg.answer(f"На жаль, товар з артикулом `{raw_sku}` не знайдено.")
        return

    text_card = format_product_card(products[0], msg.from_user.id)
    keyboard = build_sorted_size_keyboard(products)
    
    pictures = products[0].get("pictures")
    if pictures:
        await msg.answer_photo(photo=pictures[0], caption=text_card, reply_markup=keyboard)
    else:
        await msg.answer(text_card, reply_markup=keyboard)

@router.message(CommandStart(deep_link=True, magic=F.args.startswith("show_sku_")))
async def cmd_start_show_sku(msg: Message, command: CommandObject, state: FSMContext):
    try:
        args_part = command.args.replace("show_sku_", "")
        raw_sku = args_part.split('_from_')[0]
        
        products = find_product_by_sku(raw_sku)
        if not products:
            await msg.answer(f"На жаль, товар з артикулом `{raw_sku}` не знайдено.")
            return

        text_card = format_product_card(products[0], msg.from_user.id)
        
        back_url = None
        if "_from_" in args_part:
            back_url = unquote(args_part.split('_from_')[1])

        keyboard = build_sorted_size_keyboard(products, back_url)
        
        pictures = products[0].get("pictures")
        if pictures:
            await msg.answer_photo(photo=pictures[0], caption=text_card, reply_markup=keyboard)
        else:
            await msg.answer(text_card, reply_markup=keyboard)
    except Exception:
        logger.exception("Помилка обробки deep-link 'show_sku'")
        await msg.answer("Сталася помилка. Спробуйте ще раз.")

@router.message(Command("publish_test"))
async def cmd_publish_test(msg: Message):
    if msg.from_user.id != ADMIN_ID: return
    text = "🧪 Тестовий пост для перевірки товару:\n\n👕 Гольф чорний\n📌 Артикул: 1056"
    deep_link_url = f"https://t.me/{BOT_USERNAME}?start=show_sku_1056"
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🛒 Замовити (Тест)", url=deep_link_url)]])
    try:
        sent_message = await bot.send_message(chat_id=TEST_CHANNEL, text=text, reply_markup=kb, parse_mode="HTML")
        channel_id_for_link = str(sent_message.chat.id).replace("-100", "")
        post_url = f"https://t.me/c/{channel_id_for_link}/{sent_message.message_id}"
        admin_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🚀 Переглянути тестовий пост", url=post_url)]])
        await msg.answer("✅ Тестовий пост опубліковано.", reply_markup=admin_kb)
    except Exception as e:
        logger.exception("Помилка публікації тестового поста в канал")
        await msg.answer(f"⚠️ Помилка: {e}", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="📢 Відкрити канал вручну", url=TEST_CHANNEL_URL)]]) if TEST_CHANNEL_URL else None)

# ---------------- Flask & Main Loop ----------------
@app.route(WEBHOOK_PATH, methods=["POST"])
def webhook():
    global ASYNC_LOOP
    try:
        update = request.get_json(force=True)
        if ASYNC_LOOP and not ASYNC_LOOP.is_closed():
            asyncio.run_coroutine_threadsafe(dp.feed_raw_update(bot, update), ASYNC_LOOP)
        return "ok", 200
    except Exception as e:
        logger.exception("Webhook parsing error: %s", e)
        return "bad request", 400

@app.route("/")
def index(): return "Bot is running!", 200

@app.route("/healthz")
def healthz(): return "ok", 200

def run_flask():
    port = int(os.getenv("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)

async def main():
    global ASYNC_LOOP, WEBHOOK_URL
    ASYNC_LOOP = asyncio.get_running_loop()
    
    if GEMINI_API_KEY:
        genai.configure(api_key=GEMINI_API_KEY)
        logger.info("✅ Google Gemini API сконфігуровано.")
    else:
        logger.warning("⚠️ GEMINI_API_KEY не знайдено.")

    threading.Thread(target=run_flask, daemon=True).start()
    
    load_posted_ids()
    asyncio.create_task(start_telethon_client(ASYNC_LOOP))
    asyncio.create_task(random_post_scheduler())
    
    await bot.delete_webhook(drop_pending_updates=True)
    if not WEBHOOK_URL.endswith(WEBHOOK_PATH):
        WEBHOOK_URL = WEBHOOK_URL.rstrip("/") + WEBHOOK_PATH
    await bot.set_webhook(WEBHOOK_URL, drop_pending_updates=True)
    
    logger.info("Bot ready — waiting for webhook updates...")
    await asyncio.Event().wait()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Bot stopped.")

