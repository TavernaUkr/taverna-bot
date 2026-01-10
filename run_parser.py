# run_parser.py
import asyncio
import logging
# --- [ФІКС PYTHONPATH] ---
import sys
from pathlib import Path
current_dir = Path(__file__).parent
sys.path.append(str(current_dir))
# ---
from services.xml_parser import load_and_parse_xml_data
from config_reader import config
# from database.db import init_db # <-- ВИДАЛИ ЦЕЙ РЯДОК

logging.basicConfig(level=logging.INFO)

async def main():
    # print("Оновлюю БД...")
    # await init_db() # <-- І ЦЕЙ
    
    print(f"🚀 Починаю парсинг XML: {config.mydrop_export_url}")
    
    await load_and_parse_xml_data("system_import", str(config.mydrop_export_url))
    
    print("✅ Парсинг завершено! (або сталася помилка вище)")

if __name__ == "__main__":
    asyncio.run(main())