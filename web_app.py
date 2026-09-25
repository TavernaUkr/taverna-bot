# web_app.py
import logging
import uvicorn
import base64
import json
import sys 
from pathlib import Path 

# --- [ФІКС PYTHONPATH] ---
current_dir = Path(__file__).parent
sys.path.append(str(current_dir))
# --- [КІНЕЦЬ ФІКСУ] ---

from fastapi import FastAPI, HTTPException, Depends, Query, Body, Request, Form, APIRouter # <-- ОНОВЛЕНО
from aiogram import Bot
# from aiogram.client.default import DefaultBotProperties # (Більше не потрібно)
from aiogram.enums import ParseMode
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Dict, Any
from fastapi.staticfiles import StaticFiles

# --- [ОНОВЛЕНО - ФАЗА 4.4] ---
# Імпортуємо ВЖЕ ГОТОВИЙ `bot` та `get_bot_instance`
from bot_instance import bot, get_bot_instance 
# ---

from api_models import (
    ProductAPI,
    SecureAddItemRequest,
    SecureUpdateItemRequest,
    SecureRemoveItemRequest,
    SecureCreateOrderRequest,
)

from services import (
    product_service, cart_service, order_service,
    payment_service, delivery_service,
    payout_service, publisher_service,
    omnichannel_service as ads_service # <-- ОНОВЛЕНО
)
from database.db import Base, engine, AsyncSessionLocal, get_db, AsyncSession, ensure_supplier_status_timestamps, ensure_user_settings_columns, ensure_supplier_telegram_source_columns, ensure_supplier_parsing_status, ensure_ai_categorization_rules_table, ensure_supplier_history_log_table, ensure_supplier_showcase_columns, ensure_supplier_managers_permissions_columns, ensure_supplier_finance_columns, ensure_wallet_tables, ensure_ticket_tables, ensure_ticket_ai_columns, ensure_platform_support_supplier
from services.ai_queue_worker import start_ai_product_queue
from database.models import * # (Імпортуємо все)
from config_reader import config
from handlers import (
    auth_handlers, supplier_handlers, admin_handlers,
    supplier_dashboard_handlers, client_handlers
)
from api.products import router as products_router  # Import products router
from api.orders import router as orders_router  # Checkout з Mini App (POST /api/v1/orders/)
from api.users import router as users_router  # PATCH /api/v1/users/me/settings
from api.auth import router as twa_auth_router
from api.suppliers import router as twa_suppliers_router
from api.admin_suppliers import router as admin_suppliers_router
from api.admin_rules import router as admin_rules_router
from api.wallets import router as wallets_router  # GET /api/v1/wallets/me + /me/transactions
from api.tickets import router as tickets_router  # CRUD /api/v1/tickets (омніканальний міст)
from api.support_ai import router as support_ai_router  # POST /api/v1/support/ai/chat (контекстний AI-чат B2C)
from services.auth_service import get_current_user

logger = logging.getLogger(__name__)
    
# --- Ініціалізація FastAPI ---
app = FastAPI(title="TavernaBot API", version="1.0.0")
# ... (код CORS, startup, shutdown, get_bot_instance) ...
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*",
        "http://localhost:8080",   # React dev-сервер (Vite, дефолтний порт таверна-каталогу)
        "http://localhost:5173",   # React dev-сервер (Vite, альтернативний порт)
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    app.state.bot = bot # Використовуємо імпортований `bot`
    logger.info("FastAPI startup: Bot instance attached.")
    try:
        await ensure_supplier_status_timestamps()
    except Exception as e:
        logger.error("Не вдалося додати approved_at/restored_at/deleted_at: %s", e, exc_info=True)
    try:
        await ensure_user_settings_columns()
    except Exception as e:
        logger.error("Не вдалося додати haptic_enabled/notifications_enabled: %s", e, exc_info=True)
    try:
        await ensure_supplier_telegram_source_columns()
    except Exception as e:
        logger.error("Не вдалося додати source_type/telegram_channel_link: %s", e, exc_info=True)
    try:
        await ensure_supplier_parsing_status()
    except Exception as e:
        logger.error("Не вдалося додати статус parsing: %s", e, exc_info=True)
    try:
        await ensure_ai_categorization_rules_table()
    except Exception as e:
        logger.error("Не вдалося створити таблицю ai_categorization_rules: %s", e, exc_info=True)
    try:
        await ensure_supplier_history_log_table()
    except Exception as e:
        logger.error("Не вдалося створити таблицю supplier_history_log: %s", e, exc_info=True)
    try:
        await ensure_supplier_showcase_columns()
    except Exception as e:
        logger.error("Не вдалося додати колонки вітрини suppliers: %s", e, exc_info=True)
    try:
        await ensure_supplier_managers_permissions_columns()
    except Exception as e:
        logger.error("Не вдалося додати RBAC-колонки supplier_managers: %s", e, exc_info=True)
    try:
        await ensure_supplier_finance_columns()
    except Exception as e:
        logger.error("Не вдалося додати фінансові колонки suppliers (balance/platform_debt/managers_debt/auto_payout): %s", e, exc_info=True)
    try:
        await ensure_wallet_tables()
    except Exception as e:
        logger.error("Не вдалося створити таблиці wallets/transactions: %s", e, exc_info=True)
    try:
        await ensure_ticket_tables()
    except Exception as e:
        logger.error("Не вдалося створити таблиці support_tickets/ticket_messages: %s", e, exc_info=True)
    try:
        await ensure_ticket_ai_columns()
    except Exception as e:
        logger.error("Не вдалося додати AI-колонки тікетів (ai_summary/media_url/is_transcribed): %s", e, exc_info=True)
    try:
        await ensure_platform_support_supplier()
    except Exception as e:
        logger.error("Не вдалося створити службовий магазин платформи (taverna_support): %s", e, exc_info=True)
    try:
        await start_ai_product_queue()
    except Exception as e:
        logger.error("Не вдалося запустити AI-чергу товарів: %s", e, exc_info=True)
    try:
        from services.scheduler import start_scheduler as start_xml_sync_scheduler
        start_xml_sync_scheduler()
    except Exception as e:
        logger.error("Не вдалося запустити XML-планувальник: %s", e, exc_info=True)

@app.on_event("shutdown")
async def shutdown_event():
    try:
        from services.scheduler import stop_scheduler as stop_xml_sync_scheduler
        stop_xml_sync_scheduler()
    except Exception as e:
        logger.error("Не вдалося зупинити XML-планувальник: %s", e, exc_info=True)
    # `bot` закриється у `bot.py`, тут не чіпаємо
    logger.info("FastAPI shutdown.")

# ---
# [НОВИЙ РОУТЕР - ФАЗА 4.1] (Платежі)
# ---
payment_router = APIRouter(prefix="/api/v1/payment", tags=["Payment (LiqPay/Checkbox)"])

@payment_router.post("/create-checkout", response_model=Dict[str, str])
async def create_payment_checkout(
    order_request: SecureCreateOrderRequest, # <-- БЕЗПЕЧНА МОДЕЛЬ
    current_user: User = Depends(get_current_user), # <-- "Охоронець"
    bot: Bot = Depends(get_bot_instance),
    db: AsyncSession = Depends(get_db)
):
    """
    (План 4.1) Створює замовлення в БД (зі статусом 'pending')
    та повертає дані `data` і `signature` для форми LiqPay.
    """
    if not payment_service.payment_api:
        raise HTTPException(status_code=500, detail="LiqPay service is not configured")
        
    user_id = current_user.id # <-- БЕЗПЕЧНО з JWT
    fsm_data = order_request.customer_data.dict()
    
    try:
        # 1. Отримуємо кошик з Redis
        cart_items, total_price = await cart_service.get_cart_contents(user_id)
        if not cart_items:
            raise HTTPException(status_code=400, detail="Cart is empty")
        
        # 2. Створюємо замовлення в БД (статус "new")
        success, order_uid = await order_service.create_order(
            bot=bot, user_id=user_id, fsm_data=fsm_data,
            cart_items=cart_items, total_price=total_price
        )
        if not success:
            raise HTTPException(status_code=500, detail="Failed to create order in DB")
        
        # 3. Готуємо форму для LiqPay (включаючи фіскалізацію Checkbox)
        form_data = payment_service.payment_api.create_payment_form_data(
            amount=total_price,
            order_uid=order_uid,
            description=f"Оплата замовлення {order_uid} в TavernaGroup",
            user_id=user_id,
            cart_items=cart_items # Для Checkbox
        )
        
        return form_data # Повертаємо {"data": "...", "signature": "..."}

    except Exception as e:
        logger.error(f"Помилка в /payment/create-checkout: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

@payment_router.post("/callback")
async def handle_payment_callback(
    data: str = Form(...), 
    signature: str = Form(...),
    db: AsyncSession = Depends(get_db),
    bot: Bot = Depends(get_bot_instance)
):
    """
    (Оновлено для Фази 5.2 / План 20)
    Приймає callback від LiqPay.
    Розрізняє: це оплата Замовлення (TAV...) чи Платна Послуга (SRV...).
    """
    logger.info("Отримано callback від LiqPay...")
    
    # 1. Перевіряємо підпис
    if not payment_service.payment_api or not payment_service.payment_api.validate_callback(data, signature):
        logger.error("Invalid LiqPay callback signature. Attack attempt?")
        raise HTTPException(status_code=400, detail="Invalid signature")
        
    try:
        # 2. Розкодовуємо дані
        callback_data_str = base64.b64decode(data).decode('utf-8')
        callback_data = json.loads(callback_data_str)
        
        uid = callback_data.get('order_id') # Це наш `order_uid` або `service_uid`
        status = callback_data.get('status')
        
        logger.info(f"Callback для ID: {uid}, статус: {status}")
        
        # 3. Розрізняємо тип (План 20 vs План 25)
        if uid.startswith("TAV"):
            # --- ЦЕ ОПЛАТА ЗАМОВЛЕННЯ (План 25) ---
            await handle_order_payment(db, bot, uid, status)
            
        elif uid.startswith("SRV") or uid.startswith("AD-"):
            # --- ЦЕ ОПЛАТА ПОСЛУГИ (План 20) ---
            await handle_service_payment(db, bot, uid, status)
            
        else:
            logger.error(f"Callback: Невідомий формат ID: {uid}")
            
        return HTMLResponse(status_code=200) # Повідомляємо LiqPay, що все ОК

    except Exception as e:
        logger.error(f"Помилка обробки LiqPay callback: {e}", exc_info=True)
        return HTMLResponse(status_code=500)

async def handle_order_payment(db: AsyncSession, bot: Bot, order_uid: str, liqpay_status: str):
    """
    (Фаза 4.1) Обробляє callback для Замовлення Клієнта.
    """
    stmt = select(Order).where(Order.order_uid == order_uid)
    order = (await db.execute(stmt)).scalar_one_or_none()
    
    if not order:
        logger.error(f"Callback (Order): Замовлення {order_uid} не знайдено в БД!")
        return

    # 4. Оновлюємо статус замовлення (ТІЛЬКИ ЯКЩО ВОНО ЩЕ НЕ ОПЛАЧЕНЕ)
    if (liqpay_status == 'success' or liqpay_status == 'sandbox') and order.payment_status == PaymentStatus.pending:
        logger.info(f"Callback (Order): Оплата {order_uid} УСПІШНА.")
        
        # TODO: Визначити 'partial' чи 'paid'
        order.payment_status = PaymentStatus.paid
        order.status = OrderStatus.pending # Готово до відправки
        
        # --- [ПЛАН 24G] ЗАПУСК АВТО-ВИПЛАТИ ---
        asyncio.create_task(
            payout_service.process_payout_for_order(order, bot)
        )
        
        await cart_service.clear_cart(order.user_telegram_id)
        # TODO: Надіслати клієнту повідомлення "Оплачено!"

    elif liqpay_status == 'failure':
        order.payment_status = PaymentStatus.failed
    
    await db.commit()

async def handle_service_payment(db: AsyncSession, bot: Bot, service_uid: str, liqpay_status: str):
    """
    (Оновлено для Фази 5.3 / План 20)
    Обробляє callback для Платних Послуг (Постинг, Реклама).
    """
    stmt = select(PaidService).where(PaidService.service_uid == service_uid)
    service = (await db.execute(stmt)).scalar_one_or_none()

    if not service:
        logger.error(f"Callback (Service): Рахунок {service_uid} не знайдено в БД!")
        return
        
    if (liqpay_status == 'success' or liqpay_status == 'sandbox') and service.status == PaidServiceStatus.pending_payment:
        logger.info(f"Callback (Service): Оплата {service_uid} УСПІШНА.")
        
        service.status = PaidServiceStatus.awaiting_execution
        service.paid_at = datetime.now(timezone.utc)
        
        # --- [ОНОВЛЕНО - ПЛАН 20/27] ---
        # Завантажуємо пов'язані дані
        product = await db.get(Product, service.product_id, options=[selectinload(Product.variants)])
        supplier = await db.get(Supplier, service.supplier_id)

        if not product or not supplier:
            logger.error(f"Не можу виконати послугу {service_uid}: Product або Supplier не знайдено.")
            service.status = PaidServiceStatus.payment_failed # Помилка
            await db.commit()
            return

        if service.type == PaidServiceType.paid_post:
            # --- 1. ПЛАТНИЙ ПОСТИНГ (Фаза 5.2) ---
            logger.info(f"Платний Постинг: Запускаю негайну публікацію {product.sku}...")
            asyncio.create_task(
                publisher_service.publish_product_to_telegram(product, bot)
            )
            service.status = PaidServiceStatus.completed
        
        elif service.type == PaidServiceType.paid_ad:
            # --- 2. ПЛАТНА РЕКЛАМА (Фаза 5.3) ---
            logger.info(f"Платна Реклама: Запускаю кампанію для {product.sku}...")
            asyncio.create_task(
                # --- ОНОВЛЕНО ---
                omnichannel_service.omnichannel_service.execute_paid_ad_campaign(bot, service, product, supplier)
                # ---
            )
            service.status = PaidServiceStatus.completed
        
    elif liqpay_status == 'failure':
        service.status = PaidServiceStatus.payment_failed
        
    await db.commit()

# ---
# [НОВИЙ РОУТЕР - ФАЗА 4.2] (Доставка НП)
# ---
delivery_router = APIRouter(
    prefix="/api/v1/delivery", 
    tags=["Delivery (Nova Poshta)"],
    dependencies=[Depends(get_current_user)] # <-- ЗАХИЩАЄМО
)

@delivery_router.get("/search-cities", response_model=List[Dict[str, Any]])
async def api_search_cities(query: str = Query(..., min_length=2)):
    """
    (План 4.2) "Живий" пошук міст для MiniApp.
    """
    if not delivery_service.np_api or not delivery_service.np_api.is_configured():
        raise HTTPException(status_code=500, detail="Nova Poshta API is not configured")
        
    data = await delivery_service.np_api.search_settlements(query)
    if data is None:
        raise HTTPException(status_code=500, detail="Nova Poshta API error")
        
    # Повертаємо тільки перший список "Addresses"
    return data[0].get("Addresses", [])

@delivery_router.get("/get-warehouses", response_model=List[Dict[str, Any]])
async def api_get_warehouses(city_ref: str = Query(...)):
    """
    (План 4.2) "Живий" пошук відділень для MiniApp.
    """
    if not delivery_service.np_api or not delivery_service.np_api.is_configured():
        raise HTTPException(status_code=500, detail="Nova Poshta API is not configured")
        
    data = await delivery_service.np_api.get_warehouses(city_ref)
    if data is None:
        raise HTTPException(status_code=500, detail="Nova Poshta API error")
        
    return data # Повертаємо повний список відділень

# --- API Endpoints (Оновлено для Безпеки) ---
@app.get(
    "/api/v1/search",
    response_model=List[ProductAPI],
    response_model_by_alias=False,  # MiniApp очікує `sku`, а не `supplier_sku`
)
async def api_search_products(
    query: str = Query(..., min_length=2, max_length=50),
    category: Optional[List[str]] = Query(None, description="AI головна категорія"),
    main_category: Optional[List[str]] = Query(None, description="Аліас category"),
    sub_category: Optional[List[str]] = Query(None, description="AI підкатегорія"),
    season: Optional[List[str]] = Query(None, description="Сезон"),
    target_niche: Optional[List[str]] = Query(None, description="Ніша"),
    niche: Optional[List[str]] = Query(None, description="Аліас target_niche"),
    gender: Optional[List[str]] = Query(None, description="Стать"),
):
    # ... (код без змін) ...
    try:
        categories = [*(main_category or []), *(category or [])]
        niches = [*(niche or []), *(target_niche or [])]
        products_db = await product_service.search_products(
            query,
            category=categories or None,
            sub_category=sub_category,
            season=season,
            target_niche=niches or None,
            gender=gender,
        )
        return products_db
    except Exception as e:
        logger.error(f"Помилка в API /search: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
@app.get(
    "/api/v1/product/{sku}",
    response_model=ProductAPI,
    response_model_by_alias=False,  # MiniApp очікує `sku`, а не `supplier_sku`
)
async def api_get_product_by_sku(sku: str):
    # ... (код без змін) ...
    try:
        product = await product_service.get_product_by_sku(sku)
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        return product 
    except Exception as e:
        logger.error(f"Помилка в API /product/{sku}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

# --- [ОНОВЛЕНО ДЛЯ БЕЗПЕКИ] ---
@app.get("/api/v1/cart", response_class=JSONResponse)
async def api_get_cart(current_user: User = Depends(get_current_user)): # <-- "Охоронець"
    try:
        cart_items, total_price = await cart_service.get_cart_contents(current_user.id) # <-- БЕЗПЕЧНО
        return {"user_id": current_user.id, "items": cart_items, "total_price": total_price}
    except Exception as e:
        logger.error(f"Помилка в API /cart/{current_user.id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get cart data")

@app.post("/api/v1/cart/add", response_class=JSONResponse)
async def api_add_to_cart(
    request_data: SecureAddItemRequest, # <-- БЕЗПЕЧНА МОДЕЛЬ
    current_user: User = Depends(get_current_user) # <-- "Охоронець"
):
    try:
        success, response_data = await cart_service.add_item_to_cart(
            user_id=current_user.id, # <-- БЕЗПЕЧНО
            variant_offer_id=request_data.variant_offer_id,
            quantity=request_data.quantity
        )
        if not success:
            raise HTTPException(status_code=400, detail=response_data.get("message", "Failed to add item"))
        return response_data
    except Exception as e:
        logger.error(f"Помилка в API /cart/add: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

@app.post("/api/v1/cart/update", response_class=JSONResponse)
async def api_update_cart_item(
    request_data: SecureUpdateItemRequest, # <-- БЕЗПЕЧНА МОДЕЛЬ
    current_user: User = Depends(get_current_user) # <-- "Охоронець"
):
    try:
        success, response_data = await cart_service.update_item_quantity(
            user_id=current_user.id, # <-- БЕЗПЕЧНО
            variant_offer_id=request_data.variant_offer_id,
            new_quantity=request_data.new_quantity
        )
        if not success:
            raise HTTPException(status_code=400, detail=response_data.get("message", "Failed to update item"))
        return response_data
    except Exception as e:
        logger.error(f"Помилка в API /cart/update: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

@app.post("/api/v1/cart/remove", response_class=JSONResponse)
async def api_remove_cart_item(
    request_data: SecureRemoveItemRequest, # <-- БЕЗПЕЧНА МОДЕЛЬ
    current_user: User = Depends(get_current_user) # <-- "Охоронець"
):
    try:
        success, response_data = await cart_service.remove_item_from_cart(
            user_id=current_user.id, # <-- БЕЗПЕЧНО
            variant_offer_id=request_data.variant_offer_id
        )
        if not success:
            raise HTTPException(status_code=400, detail=response_data.get("message", "Failed to remove item"))
        return response_data
    except Exception as e:
        logger.error(f"Помилка в API /cart/remove: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")
# ---

@app.post("/api/v1/order/create", response_class=JSONResponse)
async def api_create_cod_order(
    order_request: SecureCreateOrderRequest, # <-- БЕЗПЕЧНА МОДЕЛЬ
    current_user: User = Depends(get_current_user), # <-- "Охоронець"
    bot: Bot = Depends(get_bot_instance),
    db: AsyncSession = Depends(get_db)
):
    fsm_data = order_request.customer_data.dict()
    if fsm_data.get("payment_type") != "cod":
        raise HTTPException(status_code=400, detail="This endpoint is only for 'cod' orders. Use /payment/create-checkout.")
    
    try:
        user_id = current_user.id # <-- БЕЗПЕЧНО
        cart_items, total_price = await cart_service.get_cart_contents(user_id)
        if not cart_items:
            raise HTTPException(status_code=400, detail="Cart is empty")
        
        success, order_uid = await order_service.create_order(
            bot=bot, user_id=user_id, fsm_data=fsm_data,
            cart_items=cart_items, total_price=total_price
        )
        if success:
            await cart_service.clear_cart(user_id)
            return {"success": True, "order_uid": order_uid}
        else:
            raise HTTPException(status_code=500, detail="Failed to create order")
    except Exception as e:
        logger.error(f"Критична помилка в /api/v1/order/create: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

# --- Підключення роутерів (Реєстрація) ---
app.include_router(payment_router)
app.include_router(delivery_router)
app.include_router(twa_auth_router)  # POST /api/v1/auth/telegram
app.include_router(twa_suppliers_router)  # POST /api/v1/suppliers/register (Mini App)
app.include_router(admin_suppliers_router)  # pending / approve / reject / direct-create
app.include_router(admin_rules_router)  # GET/POST/DELETE /api/v1/admin/ai-rules
app.include_router(auth_handlers.router)
app.include_router(supplier_handlers.router)
app.include_router(admin_handlers.router)
app.include_router(supplier_dashboard_handlers.router)
app.include_router(client_handlers.router)
app.include_router(products_router)  # Include products router
app.include_router(orders_router)  # Checkout з Mini App (POST /api/v1/orders/)
app.include_router(users_router)  # PATCH /api/v1/users/me/settings
app.include_router(wallets_router)  # GET /api/v1/wallets/me, /api/v1/wallets/me/transactions
app.include_router(tickets_router)  # POST/GET /api/v1/tickets (Support Tickets + AI-роутинг)
app.include_router(support_ai_router)  # POST /api/v1/support/ai/chat (контекстний AI-чат B2C)

# --- Віддача статичних файлів (Frontend) ---
static_dir = Path(__file__).parent / "static"
js_dir = Path(__file__).parent / "static/js"

@app.get("/", response_class=FileResponse)
async def root():
    html_file = static_dir / "index.html"
    return FileResponse(html_file)
@app.get("/product-details.html", response_class=FileResponse)
async def get_product_details_page():
    html_file = static_dir / "product-details.html"
    return FileResponse(html_file)
@app.get("/cart.html", response_class=FileResponse)
async def get_cart_page():
    html_file = static_dir / "cart.html"
    return FileResponse(html_file)
@app.get("/checkout.html", response_class=FileResponse)
async def get_checkout_page():
    html_file = static_dir / "checkout.html"
    return FileResponse(html_file)
@app.get("/login.html", response_class=FileResponse)
async def get_login_page():
    html_file = static_dir / "login.html"
    return FileResponse(html_file)
@app.get("/supplier-register.html", response_class=FileResponse)
async def get_supplier_register_page():
    html_file = static_dir / "supplier-register.html"
    return FileResponse(html_file)
@app.get("/admin.html", response_class=FileResponse)
async def get_admin_page():
    html_file = static_dir / "admin.html"
    return FileResponse(html_file)

# --- НОВИЙ ENDPOINT: ВІДДАЄ КАБІНЕТ ПОСТАЧАЛЬНИКА ---
@app.get("/supplier-dashboard.html", response_class=FileResponse)
async def get_supplier_dashboard_page():
    """Віддає сторінку Кабінету Постачальника."""
    html_file = static_dir / "supplier-dashboard.html"
    if not html_file.exists():
        return HTMLResponse("<html><body><h1>Файл supplier-dashboard.html не знайдено.</h1></body></html>", status_code=404)
    return FileResponse(html_file)

# --- НОВИЙ ENDPOINT: ВІДДАЄ СТОРІНКУ "МОЇ ТОВАРИ" ---
@app.get("/supplier-products.html", response_class=FileResponse)
async def get_supplier_products_page():
    """Віддає сторінку "Мої Товари" (для платного постингу)."""
    html_file = static_dir / "supplier-products.html"
    if not html_file.exists():
        return HTMLResponse("<html><body><h1>Файл supplier-products.html не знайдено.</h1></body></html>", status_code=44)
    return FileResponse(html_file)

# --- НОВИЙ ENDPOINT: ВІДДАЄ СТОРІНКУ "РЕКЛАМА" ---
@app.get("/supplier-ads.html", response_class=FileResponse)
async def get_supplier_ads_page():
    """Віддає сторінку "Запустити Рекламу"."""
    html_file = static_dir / "supplier-ads.html"
    if not html_file.exists():
        return HTMLResponse("<html><body><h1>Файл supplier-ads.html не знайдено.</h1></body></html>", status_code=404)
    return FileResponse(html_file)

@app.get("/payment-success", response_class=FileResponse)
async def get_payment_success_page():
    # ... (код без змін) ...
    html_file = static_dir / "payment-success.html"
    if not html_file.exists():
         return HTMLResponse("<html><body><h1>Оплата Успішна!</h1></body></html>")
    return FileResponse(html_file)

app.mount("/js", StaticFiles(directory=js_dir), name="js")
app.mount("/static", StaticFiles(directory=static_dir), name="static")