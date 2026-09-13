# services/mydrop_api.py
"""
Асинхронний клієнт для REST API MyDrop (постачальницька версія).

Документація: https://mydrop.com.ua/docs/dropshipper/api/
Технічна довідка (усі ендпоінти): https://api.mydrop.com.ua

ВАЖЛИВО (перевірено в документації MyDrop 13.09.2026):
- Кожен постачальник має ВЛАСНИЙ API-ключ (розділ "Інтеграції"/"API" в його
  кабінеті MyDrop). Ключ передається в заголовку `X-API-KEY`.
- Ендпоінт `GET /vendor/api/export/products/json` віддає ПОВНИЙ каталог
  товарів САМЕ ЦЬОГО постачальника (той самий каталог, що і його YML/XML
  вигрузка, але у форматі JSON). Постачальник має заздалегідь включити
  вигрузку товарів у своєму кабінеті MyDrop — інакше ендпоінт може
  повернути порожній список.
- MyDrop НЕ документує параметри пагінації (page/limit) саме для цього
  ендпоінту — це один JSON-документ з усіма товарами. Так само НЕ
  документовані офіційні rate limit'и. Тому:
    * пагінація нижче реалізована як "заготовка на майбутнє" (якщо MyDrop
      колись почне віддавати `next_page`/`page` у відповіді, код це
      підхопить автоматично) — а не обов'язковий механізм зараз;
    * захист від навантаження — клієнтський throttling + retry з
      експоненційною затримкою на 429/5xx.
"""
import asyncio
import logging
from typing import Any, Dict, List, Optional

import aiohttp

logger = logging.getLogger(__name__)

MYDROP_BASE_URL = "https://backend.mydrop.com.ua"
PRODUCTS_EXPORT_PATH = "/vendor/api/export/products/json"
# "Vendor"-версія створення замовлення (наш кабінет постачальника, X-API-KEY
# постачальника з `Supplier.mydrop_api_key`). Є ще "dropshipper"-версія
# (/dropshipper/api/orders), але вона не для нас — ми працюємо ЗА
# постачальника, не як його дропшипер.
ORDERS_PATH = "/vendor/api/orders"


class MyDropAPIError(Exception):
    """Помилка звернення до MyDrop API (мережа, авторизація, невалідна відповідь)."""

    def __init__(self, message: str, status: Optional[int] = None, payload: Optional[Any] = None):
        super().__init__(message)
        self.status = status
        self.payload = payload


class MyDropAPIClient:
    """
    Клієнт stateless щодо API-ключа: ключ передається окремо в кожен метод,
    тож один інстанс клієнта можна безпечно використовувати одночасно для
    багатьох постачальників (кожен зі своїм `api_key`).
    """

    def __init__(self, base_url: str = MYDROP_BASE_URL, timeout: int = 60, max_retries: int = 3):
        self.base_url = base_url.rstrip("/")
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        self.max_retries = max_retries

        # MyDrop не публікує офіційний rate limit, але тримаємо клієнт
        # "чемним" — мінімальний інтервал між запитами, щоб не отримати
        # блокування ключа за надто часті звернення.
        self._min_request_interval = 0.5
        self._last_request_at: float = 0.0
        self._lock = asyncio.Lock()

    async def _throttle(self) -> None:
        async with self._lock:
            loop = asyncio.get_event_loop()
            now = loop.time()
            wait = self._min_request_interval - (now - self._last_request_at)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_request_at = loop.time()

    async def _request(
        self,
        method: str,
        path: str,
        api_key: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Any] = None,
        idempotent: bool = True,
    ) -> Any:
        """
        Універсальний запит до MyDrop з обробкою мережевих помилок.
        - 429 / 5xx -> retry з експоненційною затримкою (поважає Retry-After).
          Це відповідь, яку СЕРВЕР явно повернув — тобто запит точно
          "не пройшов" на його боці, тож повторити його безпечно завжди.
        - 401 / 403 -> одразу MyDropAPIError (невалідний/відкликаний ключ, retry марний).
        - інші 4xx -> одразу MyDropAPIError.
        - Timeout / розрив з'єднання (не отримали ЖОДНОЇ відповіді) -> якщо
          `idempotent=True` (напр. GET), безпечно ретраїмо. Якщо
          `idempotent=False` (напр. POST створення замовлення) — НЕ ретраїмо,
          бо ми не знаємо, чи запит вже виконався на боці MyDrop (інакше є
          ризик створити ДУБЛІКАТ замовлення).
        """
        if not api_key:
            raise MyDropAPIError("Відсутній MyDrop API-ключ постачальника.")

        url = f"{self.base_url}{path}"
        headers = {
            "X-API-KEY": api_key,
            "Content-Type": "application/json",
        }

        last_error: Optional[Exception] = None

        for attempt in range(1, self.max_retries + 1):
            await self._throttle()
            try:
                async with aiohttp.ClientSession(timeout=self._timeout) as session:
                    async with session.request(
                        method, url, headers=headers, params=params, json=json_body
                    ) as resp:
                        if resp.status == 429 or resp.status >= 500:
                            retry_after_header = resp.headers.get("Retry-After")
                            delay = float(retry_after_header) if retry_after_header else (2 ** attempt)
                            body_preview = (await resp.text())[:300]
                            logger.warning(
                                "MyDrop API %s %s -> статус %s (спроба %s/%s). Чекаю %.1fс. Тіло: %s",
                                method, path, resp.status, attempt, self.max_retries, delay, body_preview,
                            )
                            last_error = MyDropAPIError(
                                f"MyDrop API тимчасово недоступний (status={resp.status})",
                                status=resp.status,
                            )
                            await asyncio.sleep(delay)
                            continue

                        if resp.status in (401, 403):
                            body_preview = (await resp.text())[:300]
                            logger.error(
                                "MyDrop API: невалідний/відкликаний API-ключ (status=%s): %s",
                                resp.status, body_preview,
                            )
                            raise MyDropAPIError(
                                "Невалідний або відкликаний MyDrop API-ключ.",
                                status=resp.status,
                                payload=body_preview,
                            )

                        if resp.status >= 400:
                            body_preview = (await resp.text())[:300]
                            logger.error(
                                "MyDrop API помилка %s %s -> %s: %s",
                                method, path, resp.status, body_preview,
                            )
                            raise MyDropAPIError(
                                f"MyDrop API повернув помилку {resp.status}",
                                status=resp.status,
                                payload=body_preview,
                            )

                        try:
                            return await resp.json(content_type=None)
                        except (aiohttp.ContentTypeError, ValueError) as e:
                            body_preview = (await resp.text())[:300]
                            logger.error("MyDrop API: невалідний JSON у відповіді: %s (тіло: %s)", e, body_preview)
                            raise MyDropAPIError("MyDrop API повернув невалідний JSON.", payload=body_preview) from e

            except MyDropAPIError:
                raise
            except asyncio.TimeoutError as e:
                last_error = e
                logger.warning("MyDrop API timeout (%s %s), спроба %s/%s", method, path, attempt, self.max_retries)
                if not idempotent:
                    # Не знаємо, чи запит виконався на боці MyDrop — не ретраїмо
                    # неідемпотентний запит (напр. створення замовлення).
                    raise MyDropAPIError(
                        f"Таймаут запиту до MyDrop ({method} {path}). "
                        f"Замовлення МОЖЕ бути створено на боці MyDrop — перевірте вручну."
                    ) from e
                await asyncio.sleep(2 ** attempt)
            except aiohttp.ClientError as e:
                last_error = e
                logger.warning(
                    "MyDrop API мережева помилка (%s %s): %s, спроба %s/%s",
                    method, path, e, attempt, self.max_retries,
                )
                if not idempotent:
                    raise MyDropAPIError(
                        f"Мережева помилка запиту до MyDrop ({method} {path}): {e}. "
                        f"Замовлення МОЖЕ бути створено на боці MyDrop — перевірте вручну."
                    ) from e
                await asyncio.sleep(2 ** attempt)

        logger.error(
            "MyDrop API: усі %s спроби невдалі (%s %s). Остання помилка: %s",
            self.max_retries, method, path, last_error,
        )
        raise MyDropAPIError(f"Не вдалося виконати запит до MyDrop після {self.max_retries} спроб: {last_error}")

    async def get_products(self, api_key: str) -> List[Dict[str, Any]]:
        """
        Отримує повний каталог товарів постачальника з MyDrop.

        Повертає список товарів (dict). Кожен товар очікувано містить:
        id, title, sku, category_id, drop_price, price, description,
        sizes_available, sizes: [{id, title, amount, params?, images?}],
        images, vendor_manufacturer, params.

        Кидає MyDropAPIError, якщо запит не вдався (мережа/авторизація/формат).
        """
        params: Dict[str, Any] = {}
        page = 1
        all_products: List[Dict[str, Any]] = []
        categories_count = 0

        while True:
            data = await self._request("GET", PRODUCTS_EXPORT_PATH, api_key, params=params or None)

            # Очікуваний формат: {"categories": [...], "products": [...]}.
            # Робимо стійким і до варіанту, коли API поверне "плаский" список товарів.
            if isinstance(data, dict):
                page_products = data.get("products") or []
                categories_count = len(data.get("categories") or [])
            elif isinstance(data, list):
                page_products = data
            else:
                logger.warning("MyDrop API: неочікуваний формат відповіді (%s), пропускаю.", type(data))
                page_products = []

            all_products.extend(page_products)

            # --- Заготовка під пагінацію (MyDrop наразі її не документує) ---
            next_page = None
            if isinstance(data, dict):
                next_page = data.get("next_page") or data.get("nextPage")
                pagination = data.get("pagination") or {}
                if not next_page and pagination.get("has_next"):
                    next_page = page + 1

            if not next_page or not page_products:
                break
            page = next_page
            params = {"page": page}

        logger.info(
            "MyDrop API: отримано %s товарів (%s категорій).",
            len(all_products), categories_count,
        )
        return all_products

    async def create_order(
        self,
        api_key: str,
        order_data: Dict[str, Any],
        order_items: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Створює замовлення в кабінеті постачальника MyDrop
        (`POST /vendor/api/orders`).

        `order_data` (усі ключі опціональні, крім `customer_name`/`customer_phone`):
            customer_name      — ПІБ клієнта (так, обов'язково)
            customer_phone     — телефон клієнта (так, обов'язково)
            delivery_service   — "nova_poshta" / "ukr_poshta" / "meest"
            city               — місто відправлення (для служб з повною інтеграцією)
            warehouse_number   — номер відділення (для служб з повною інтеграцією)
            delivery_address   — адреса доставки текстом (fallback, якщо
                                  city/warehouse_number не відомі окремо —
                                  MyDrop приймає такий варіант для служб
                                  без повної інтеграції)
            note               — примітка до замовлення
            order_source       — джерело замовлення (напр. "TavernaBot MiniApp")
            order_uid          — наш внутрішній order_uid (кладемо в traffic_source,
                                  щоб можна було зіставити замовлення MyDrop <-> наше)

        `order_items` — список товарів, кожен елемент:
            supplier_sku   — артикул товару в постачальника (Product.supplier_sku)
            product_name   — назва товару (fallback, якщо supplier_sku немає)
            quantity       — кількість (так, обов'язково)
            price          — ціна продажу за 1 шт., яку бачив клієнт (так, обов'язково)
            options_text   — напр. "Розмір: XL" -> підставиться в size_title

        Повертає dict з відповіддю MyDrop (створене замовлення, з полем "id").
        Кидає MyDropAPIError при помилці валідації/мережі/авторизації.
        Не ретраїть на timeout/розрив з'єднання (idempotent=False) — щоб не
        створити дублікат замовлення в MyDrop.
        """
        customer_name = str(order_data.get("customer_name") or "").strip()
        customer_phone = str(order_data.get("customer_phone") or "").strip()
        if not customer_name or not customer_phone:
            raise MyDropAPIError("Ім'я та телефон клієнта обов'язкові для створення замовлення в MyDrop.")
        if not order_items:
            raise MyDropAPIError("Список товарів не може бути порожнім.")

        products: List[Dict[str, Any]] = []
        for item in order_items:
            sku = str(item.get("supplier_sku") or "").strip()
            title = str(item.get("product_name") or "").strip()
            if not sku and not title:
                raise MyDropAPIError(f"Товар без sku і назви не можна відправити в MyDrop: {item}")

            try:
                price = float(item.get("price") or 0)
                amount = int(item.get("quantity") or 0)
            except (TypeError, ValueError) as e:
                raise MyDropAPIError(f"Некоректна ціна/кількість товару для MyDrop: {item}") from e
            if amount <= 0:
                raise MyDropAPIError(f"Кількість товару має бути > 0 для MyDrop: {item}")

            product_entry: Dict[str, Any] = {"price": price, "amount": amount}
            if title:
                product_entry["product_title"] = title
            if sku:
                product_entry["product_sku"] = sku
            options_text = item.get("options_text")
            if options_text:
                product_entry["size_title"] = str(options_text)
            products.append(product_entry)

        payload: Dict[str, Any] = {
            "name": customer_name,
            "phone": customer_phone,
            "products": products,
            "order_source": order_data.get("order_source") or "TavernaBot MiniApp",
        }
        if order_data.get("delivery_service"):
            payload["delivery_service"] = order_data["delivery_service"]
        if order_data.get("city"):
            payload["city"] = order_data["city"]
        if order_data.get("warehouse_number"):
            payload["warehouse_number"] = order_data["warehouse_number"]
        # `delivery_address` (текст) шлемо лише якщо city/warehouse_number
        # окремо не відомі — так документує MyDrop для служб без повної
        # інтеграції (наш чекаут з Mini App наразі не розбиває адресу на
        # city_ref/warehouse_ref, тож для nova_poshta/ukr_poshta теж
        # передаємо текстову адресу як fallback).
        if order_data.get("delivery_address") and not (order_data.get("city") and order_data.get("warehouse_number")):
            payload["delivery_address"] = order_data["delivery_address"]
        if order_data.get("note"):
            payload["description"] = order_data["note"]
        if order_data.get("order_uid"):
            payload["traffic_source"] = order_data["order_uid"]

        logger.info(
            "MyDrop: створення замовлення в кабінеті постачальника (товарів: %s, джерело: %s).",
            len(products), payload["order_source"],
        )
        response = await self._request(
            "POST", ORDERS_PATH, api_key, json_body=payload, idempotent=False,
        )
        if not isinstance(response, dict):
            raise MyDropAPIError(
                "MyDrop API повернув неочікуваний формат відповіді на створення замовлення.",
                payload=response,
            )
        logger.info("MyDrop: замовлення створено, id=%s.", response.get("id"))
        return response


async def create_order_in_mydrop(
    api_key: str,
    order_data: Dict[str, Any],
    order_items: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Зручна функція-обгортка над `MyDropAPIClient.create_order` (щоб не
    створювати інстанс клієнта в кожному місці викликів, напр. в `api/orders.py`).
    Дивись докстрінг `MyDropAPIClient.create_order` щодо формату аргументів.
    """
    client = MyDropAPIClient()
    return await client.create_order(api_key, order_data, order_items)
