# services/mydrop_api.py
"""
Асинхронний клієнт для REST API MyDrop.

Документація: https://mydrop.com.ua/docs/ ; технічна довідка (усі ендпоінти): https://api.mydrop.com.ua

[АРХІТЕКТУРА — ЗАФІКСОВАНО 13.09.2026 після 401-помилки]
У нашій системі MyDrop бере участь у ДВОХ РІЗНИХ ролях, з ДВОМА РІЗНИМИ
ключами — це критично не плутати:

1. СТВОРЕННЯ ЗАМОВЛЕНЬ. Ми (TavernaBot) виступаємо як ОДИН ДРОПШИПЕР
   (Dropshipper) у кабінетах кількох постачальників-вендорів у MyDrop.
   Замовлення летять на `POST /dropshipper/api/orders` з НАШИМ ОДНИМ
   майстер-ключем дропшипера (`config.mydrop_api_key` з `.env`) —
   це ключ НАШОГО дропшиперського кабінету, а НЕ ключ постачальника.
   Кожен товар у замовленні містить `vendor_name` — назву постачальника
   в MyDrop, щоб CRM правильно прив'язала позицію до потрібного вендора.

2. СИНХРОНІЗАЦІЯ КАТАЛОГУ. Ми читаємо ПУБЛІЧНУ YML/Prom-вигрузку КОЖНОГО
   постачальника окремо: `GET /vendor/api/export/products/prom/yml
   ?public_api_key=...`. Це НЕ приватний X-API-KEY — це публічний ключ
   вигрузки, який сам постачальник генерує в себе в кабінеті MyDrop і
   роздає дропшиперам для читання каталогу БЕЗ авторизації (запит
   робиться БЕЗ заголовка `X-API-KEY`). У нашій БД цей публічний ключ
   зберігається в тому самому полі `Supplier.mydrop_api_key`.

До цього фіксу обидва кроки помилково використовували
`Supplier.mydrop_api_key` як приватний X-API-KEY постачальника на
вендорських ендпоінтах (`/vendor/api/...`) — звідси й 401 (ми не є тим
постачальником і не маємо його приватного ключа).
"""
import asyncio
import logging
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiofiles
import aiohttp

logger = logging.getLogger(__name__)

MYDROP_BASE_URL = "https://backend.mydrop.com.ua"

# --- Каталог постачальника: публічна YML/Prom-вигрузка, без авторизації ---
PRODUCTS_EXPORT_YML_PATH = "/vendor/api/export/products/prom/yml"

# --- Створення замовлення: НАШ кабінет дропшипера (майстер-ключ з .env) ---
ORDERS_PATH = "/dropshipper/api/orders"

# --- [DEV FALLBACK] Локальний файл-заглушка каталогу ---
# Якщо MyDrop недоступний (404 через strict_slashes у Flask, тестовий
# public_api_key відкликаний постачальником, сервер лежить тощо) —
# `get_products()` не крашиться і не повертає порожній список, а читає
# ОДИН з цих файлів (перший знайдений, у порядку списку) з кореня проєкту.
# `product_export (3).xml` — саме той шлях, на який очікує наша команда;
# `product_export (2).xml` — реальний дамп каталогу, вже наявний у репо
# (fallback на нього, якщо "(3)" ще не поклали).
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_FALLBACK_XML_CANDIDATES = [
    _PROJECT_ROOT / "docs" / "product_export (3).xml",
    _PROJECT_ROOT / "docs" / "product_export (2).xml",
]


class MyDropAPIError(Exception):
    """Помилка звернення до MyDrop API (мережа, авторизація, невалідна відповідь)."""

    def __init__(self, message: str, status: Optional[int] = None, payload: Optional[Any] = None):
        super().__init__(message)
        self.status = status
        self.payload = payload


# ---------------------------------------------------------------------------
# "Smart Parsing" колірних розмірів.
#
# Проблема даних (типова для постачальників тактичного одягу): в YML-фіді
# колір товару інколи прописують у параметрі з назвою "Розмір"/"Размер"
# (напр. `<param name="Размер">Койот</param>`) замість окремого параметра
# "Колір". Якщо довірити це нашому звичайному grouping-у по назві параметра
# (`mydrop_sync.py`), товар отримає варіант з ОПЦІЄЮ "Розмір=Койот", що
# зламає фільтри розміру на сайті. Тож перевіряємо ЗНАЧЕННЯ параметра:
# якщо назва схожа на "розмір", а значення — явно назва кольору зі словника
# нижче, примусово підмінюємо назву параметра на "Колір".
# ---------------------------------------------------------------------------
_SIZE_LABEL_RE = re.compile(r"розм[іi]р|размер|^size$", re.IGNORECASE)

_COLOR_KEYWORDS = (
    "койот", "мультикам", "мм14", "олива", "оливков", "чорний", "черный",
    "піксель", "пиксель", "хакі", "хаки", "камуфляж", "камо", "тан",
    "пісочн", "песочн", "флора", "мох", "сірий", "серый", "білий", "белый",
    "синій", "синий", "зелений", "зеленый", "жовт", "оранж", "марпат", "nato",
)


def _is_color_value(value: str) -> bool:
    """Перевіряє, чи виглядає значення параметра як назва кольору (а не розміру)."""
    v = (value or "").strip().lower()
    if not v:
        return False
    return any(keyword in v for keyword in _COLOR_KEYWORDS)


def _fix_size_color_param_name(param_name: str, param_value: str) -> str:
    """
    Якщо `param_name` виглядає як "Розмір"/"Размер"/"Size", але `param_value`
    насправді назва кольору (див. `_COLOR_KEYWORDS`) — повертає "Колір"
    замість оригінальної назви. Інакше повертає `param_name` без змін.
    """
    if _SIZE_LABEL_RE.search(param_name or "") and _is_color_value(param_value):
        return "Колір"
    return param_name


class MyDropAPIClient:
    """
    Клієнт stateless щодо ключів: ключ (майстер-ключ дропшипера АБО
    публічний ключ вигрузки постачальника) передається окремо в кожен
    метод, тож один інстанс клієнта можна безпечно використовувати
    одночасно для багатьох постачальників.
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
        Універсальний авторизований (X-API-KEY) JSON-запит до MyDrop.
        Використовується ЛИШЕ для приватних ендпоінтів (наразі — створення
        замовлення в кабінеті дропшипера). Для публічної YML-вигрузки
        каталогу дивись `_fetch_public_yml` (там НЕМАЄ заголовка X-API-KEY).

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
            raise MyDropAPIError("Відсутній MyDrop API-ключ.")

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

    async def _get_yml_text(self, path: str, params: Dict[str, Any]) -> str:
        """
        Один GET-запит на конкретний `path` (з retry на 429/5xx/timeout/
        мережеву помилку). Кидає `MyDropAPIError` (зі встановленим `.status`,
        коли сервер явно відповів кодом помилки) при остаточній невдачі.
        Винесено окремо від `_fetch_public_yml`, щоб можна було спробувати
        ДЕКІЛЬКА варіантів шляху (fix strict_slashes) без дублювання коду.
        """
        url = f"{self.base_url}{path}"
        last_error: Optional[Exception] = None

        for attempt in range(1, self.max_retries + 1):
            await self._throttle()
            try:
                async with aiohttp.ClientSession(timeout=self._timeout) as session:
                    async with session.get(url, params=params) as resp:
                        if resp.status == 429 or resp.status >= 500:
                            retry_after_header = resp.headers.get("Retry-After")
                            delay = float(retry_after_header) if retry_after_header else (2 ** attempt)
                            body_preview = (await resp.text())[:300]
                            logger.warning(
                                "MyDrop YML export %s -> статус %s (спроба %s/%s). Чекаю %.1fс. Тіло: %s",
                                path, resp.status, attempt, self.max_retries, delay, body_preview,
                            )
                            last_error = MyDropAPIError(
                                f"MyDrop YML export тимчасово недоступний (status={resp.status})",
                                status=resp.status,
                            )
                            await asyncio.sleep(delay)
                            continue

                        if resp.status >= 400:
                            body_preview = (await resp.text())[:300]
                            logger.error("MyDrop YML export %s помилка %s: %s", path, resp.status, body_preview)
                            raise MyDropAPIError(
                                f"MyDrop YML export ({path}) повернув помилку {resp.status} "
                                "(перевір public_api_key постачальника — можливо, вигрузка вимкнена/ключ невалідний).",
                                status=resp.status,
                                payload=body_preview,
                            )

                        return await resp.text()

            except MyDropAPIError:
                raise
            except asyncio.TimeoutError as e:
                last_error = e
                logger.warning("MyDrop YML export %s: timeout, спроба %s/%s", path, attempt, self.max_retries)
                await asyncio.sleep(2 ** attempt)
            except aiohttp.ClientError as e:
                last_error = e
                logger.warning(
                    "MyDrop YML export %s: мережева помилка %s, спроба %s/%s", path, e, attempt, self.max_retries,
                )
                await asyncio.sleep(2 ** attempt)

        logger.error("MyDrop YML export %s: усі %s спроби невдалі. Остання помилка: %s", path, self.max_retries, last_error)
        raise MyDropAPIError(f"Не вдалося завантажити YML з {path} після {self.max_retries} спроб: {last_error}")

    async def _fetch_public_yml(self, public_api_key: str) -> str:
        """
        Завантажує публічну YML/Prom-вигрузку каталогу постачальника.

        На відміну від `_request` — тут НЕМАЄ заголовка `X-API-KEY` (це не
        приватний ключ постачальника, а ПУБЛІЧНИЙ ключ його вигрузки,
        призначений для читання каталогу будь-ким без авторизації). Ключ
        передається як query-параметр `public_api_key`.

        [FIX Strict Slashes] Якщо основний шлях (без кінцевого "/") повертає
        404 — це типова поведінка Flask з `strict_slashes=True`, коли
        маршрут насправді зареєстрований З кінцевим "/". Тож при 404
        автоматично пробуємо варіант з "/" на кінці (`.../prom/yml/`),
        перш ніж остаточно визнати запит невдалим.

        GET-запит ідемпотентний — на timeout/мережеву помилку безпечно
        ретраїмо (на відміну від створення замовлення).
        """
        if not public_api_key:
            raise MyDropAPIError("Відсутній публічний ключ вигрузки (public_api_key) постачальника.")

        params = {"public_api_key": public_api_key}
        slash_path = f"{PRODUCTS_EXPORT_YML_PATH}/"

        try:
            return await self._get_yml_text(PRODUCTS_EXPORT_YML_PATH, params)
        except MyDropAPIError as e:
            if e.status != 404:
                raise
            logger.warning(
                "MyDrop YML export: 404 на '%s' (ймовірно Flask strict_slashes) — пробую з кінцевим '/'.",
                PRODUCTS_EXPORT_YML_PATH,
            )
            return await self._get_yml_text(slash_path, params)

    async def _read_fallback_xml(self) -> str:
        """
        [DEV FALLBACK] Асинхронно читає локальний файл-заглушку каталогу
        (дивись `_FALLBACK_XML_CANDIDATES`) — щоб розробка/тестування бази
        й фронтенду не блокувалась статусом сервера MyDrop чи відкликаним
        тестовим `public_api_key` постачальника.

        Читає ЯК БАЙТИ (через `aiofiles`, щоб не блокувати event loop на
        великому файлі) і сама підбирає кодування (`utf-8` -> `cp1251`) —
        експорти MyDrop зазвичай UTF-8, але захист на випадок Windows-1251
        не завадить.
        """
        for path in _FALLBACK_XML_CANDIDATES:
            if not path.exists():
                continue
            logger.info("MyDrop fallback: читаю локальний файл-заглушку каталогу: %s", path)
            async with aiofiles.open(path, mode="rb") as f:
                raw = await f.read()
            # "utf-8-sig" замість "utf-8" — деякі експорти зберігаються з
            # BOM (\ufeff) на початку файлу; звичайний "utf-8" залишає BOM
            # у рядку ПЕРЕД `<?xml ...?>`, і `ET.fromstring` падає з
            # "syntax error: line 1, column 0". "utf-8-sig" сам його прибирає
            # (і коректно декодує файли й БЕЗ BOM теж).
            for encoding in ("utf-8-sig", "cp1251"):
                try:
                    return raw.decode(encoding)
                except UnicodeDecodeError:
                    continue
            return raw.decode("utf-8", errors="replace")

        raise MyDropAPIError(
            "MyDrop недоступний, а локальний файл-заглушка каталогу не знайдений. Шукав: "
            + ", ".join(str(p) for p in _FALLBACK_XML_CANDIDATES)
            + ". Поклади реальний YML-експорт постачальника за одним з цих шляхів для offline-розробки."
        )

    def _parse_yml_to_dicts(self, xml_text: str) -> List[Dict[str, Any]]:
        """
        Розпарсює YML/Prom-фід у список товарів у ТОМУ Ж форматі, який
        раніше повертав JSON-ендпоінт (щоб `services/mydrop_sync.py`
        обробляв обидва джерела однаково, без змін):

            {
                "id": ..., "sku": ..., "title": ..., "description": ...,
                "images": [{"url": ...}, ...], "category_id": ...,
                "drop_price": ...,
                "sizes": [
                    {"id": ..., "title": <значення "Розмір" або None>,
                     "amount": ..., "drop_price": ...,
                     "params": [{"title": ..., "value": ...}, ...]},
                    ...
                ],
            }

        Групування варіацій (розмір/колір) — за тегом `<group_id>` (стандарт
        Prom): усі `<offer>` з однаковим `group_id` вважаються варіаціями
        ОДНОГО товару → одна позиція `sizes[]` на кожен offer. Offer без
        `group_id` — самостійний товар з ОДНИМ варіантом.

        "Smart Parsing": кожен `<param>` проходить через
        `_fix_size_color_param_name` — якщо постачальник помилково поклав
        колір у параметр "Розмір"/"Размер", тут це виправляється на "Колір"
        ДО того, як `mydrop_sync.py` створить опції товару. Саме "справжній"
        розмір (назва параметра не була перевизначена) потрапляє в
        `sizes[].title` (це поле `mydrop_sync.py` завжди трактує як
        значення опції "Розмір").

        Стійкий до помилок: одна зіпсована `<offer>` не зупиняє парсинг
        решти каталогу (пропускається з попередженням у лог).
        """
        # Захист від BOM (\ufeff) на початку рядка — якщо він лишився ПЕРЕД
        # `<?xml ...?>` (напр. з мережі чи через неправильне декодування),
        # `ET.fromstring` впаде з "syntax error: line 1, column 0".
        xml_text = xml_text.lstrip("\ufeff").strip()

        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError as e:
            raise MyDropAPIError(f"MyDrop YML: невалідний XML у відповіді: {e}") from e

        shop = root.find("shop")
        if shop is None:
            logger.warning("MyDrop YML: немає тега <shop> у відповіді — повертаю порожній список.")
            return []

        offers_el = shop.find("offers")
        if offers_el is None:
            logger.warning("MyDrop YML: немає тега <offers> у відповіді — повертаю порожній список.")
            return []

        # group_id (str) -> список розпарсених offer-словників (порядок файлу збережено)
        groups: Dict[str, List[Dict[str, Any]]] = {}
        standalone: List[Dict[str, Any]] = []
        errors = 0

        for offer_el in offers_el.findall("offer"):
            offer_id_attr = offer_el.get("id") or ""
            try:
                available = (offer_el.get("available") or "true").strip().lower() != "false"

                def _text(tag: str) -> str:
                    node = offer_el.find(tag)
                    return (node.text or "").strip() if node is not None and node.text else ""

                name = _text("name") or _text("name_ua")
                description = _text("description") or _text("description_ua")
                vendor_code = _text("vendorCode")
                category_id = _text("categoryId") or None
                group_id = offer_el.get("group_id") or _text("group_id")

                price_raw = _text("drop_price") or _text("price")
                try:
                    drop_price = float(price_raw) if price_raw else 0.0
                except ValueError:
                    drop_price = 0.0

                qty_raw = _text("stock_quantity") or _text("quantity_in_stock") or _text("quantity")
                try:
                    amount = int(float(qty_raw)) if qty_raw else (1 if available else 0)
                except ValueError:
                    amount = 1 if available else 0

                pictures = [
                    (pic.text or "").strip()
                    for pic in offer_el.findall("picture")
                    if pic.text and pic.text.strip()
                ]

                params: List[Dict[str, str]] = []
                size_title = ""
                for param_el in offer_el.findall("param"):
                    raw_name = (param_el.get("name") or "").strip()
                    value = (param_el.text or "").strip()
                    if not raw_name or not value:
                        continue
                    fixed_name = _fix_size_color_param_name(raw_name, value)
                    params.append({"title": fixed_name, "value": value})
                    # У `sizes[].title` кладемо значення ЛИШЕ якщо назва
                    # параметра НЕ була перевизначена Smart Parsing-ом
                    # (інакше це колір, а не розмір — він вже в `params`).
                    if fixed_name == raw_name and _SIZE_LABEL_RE.search(fixed_name) and not size_title:
                        size_title = value

                offer_dict = {
                    "id": offer_id_attr,
                    "sku": vendor_code or offer_id_attr,
                    "title": name,
                    "description": description,
                    "images": pictures,
                    "category_id": category_id,
                    "drop_price": drop_price,
                    "amount": amount,
                    "size_title": size_title or None,
                    "params": params,
                }
            except Exception as e:
                errors += 1
                logger.error("MyDrop YML: помилка парсингу <offer id=%s>: %s", offer_id_attr, e, exc_info=True)
                continue

            if group_id:
                groups.setdefault(group_id, []).append(offer_dict)
            else:
                standalone.append(offer_dict)

        products: List[Dict[str, Any]] = []

        # --- Групи (розмір/колір-варіації одного товару) ---
        for group_id, offers in groups.items():
            base = offers[0]
            sizes = [
                {
                    "id": off["id"],
                    "title": off["size_title"],
                    "amount": off["amount"],
                    "drop_price": off["drop_price"],
                    "params": off["params"],
                }
                for off in offers
            ]
            products.append({
                "id": group_id,
                "sku": base["sku"],
                "title": base["title"],
                "description": base["description"],
                "images": [{"url": u} for u in base["images"]],
                "category_id": base["category_id"],
                "drop_price": base["drop_price"],
                "sizes": sizes,
            })

        # --- Товари без варіацій (один offer = один товар) ---
        for off in standalone:
            products.append({
                "id": off["id"],
                "sku": off["sku"],
                "title": off["title"],
                "description": off["description"],
                "images": [{"url": u} for u in off["images"]],
                "category_id": off["category_id"],
                "drop_price": off["drop_price"],
                "sizes": [{
                    "id": off["id"],
                    "title": off["size_title"],
                    "amount": off["amount"],
                    "drop_price": off["drop_price"],
                    "params": off["params"],
                }],
            })

        logger.info(
            "MyDrop YML: розпарсено %s товарів (%s груп-варіацій, %s самостійних), помилок парсингу: %s.",
            len(products), len(groups), len(standalone), errors,
        )
        return products

    async def get_products(self, public_api_key: str) -> List[Dict[str, Any]]:
        """
        Отримує повний каталог товарів постачальника через його ПУБЛІЧНУ
        YML/Prom-вигрузку (`GET /vendor/api/export/products/prom/yml
        ?public_api_key=...`) — БЕЗ заголовка X-API-KEY.

        [АРХІТЕКТУРНЕ ВИПРАВЛЕННЯ 13.09.2026] Раніше цей метод ходив на
        приватний JSON-ендпоінт (`/vendor/api/export/products/json`) з
        X-API-KEY постачальника — це було неправильно: ми не маємо
        приватного ключа кожного постачальника, лише його ПУБЛІЧНИЙ ключ
        вигрузки (`public_api_key`, той самий, що зберігається в
        `Supplier.mydrop_api_key`).

        Повертає список товарів (dict) у форматі, сумісному з
        `services/mydrop_sync.py` (дивись `_parse_yml_to_dicts`).

        [DEV FALLBACK] Якщо мережевий запит падає з БУДЬ-ЯКОЮ помилкою
        (ClientError, timeout, 404/401/403/429/5xx — усе, що потрапляє у
        `MyDropAPIError`, або будь-яка інша неочікувана помилка), А ТАКОЖ
        якщо сервер відповів `200 OK`, але тілом, яке НЕ парситься як YML
        (напр. HTML-сторінка помилки замість XML — типово для CDN/проксі
        перед "мертвим" бекендом) — цей метод НЕ повертає порожній список
        і НЕ кидає виняток одразу, а читає локальний файл-заглушку
        каталогу (`_read_fallback_xml`), щоб розробка бази/фронтенду не
        блокувалась статусом сервера MyDrop чи тестового `public_api_key`.
        Лише якщо ЩЕ Й локальний файл відсутній/непарситься — тоді таки
        летить MyDropAPIError.
        """
        try:
            xml_text = await self._fetch_public_yml(public_api_key)
            return self._parse_yml_to_dicts(xml_text)
        except Exception as e:
            logger.warning("Мережева помилка MyDrop. Використовую локальний файл-заглушку. (%s)", e)
            fallback_xml_text = await self._read_fallback_xml()
            return self._parse_yml_to_dicts(fallback_xml_text)

    async def create_order(
        self,
        api_key: str,
        order_data: Dict[str, Any],
        order_items: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Створює замовлення в НАШОМУ кабінеті ДРОПШИПЕРА MyDrop
        (`POST /dropshipper/api/orders`). `api_key` тут — НАШ майстер-ключ
        дропшипера (`config.mydrop_api_key`), НЕ ключ постачальника.

        `order_data`:
            customer_name     — ПІБ клієнта (так, обов'язково)
            customer_phone    — телефон клієнта (так, обов'язково)
            vendor_name       — назва постачальника В КАБІНЕТІ MYDROP (так,
                                 обов'язково для API дропшипера — без цього
                                 MyDrop не знає, товару якого вендора це
                                 замовлення). Значення за замовчуванням для
                                 всіх товарів у `order_items`, якщо в
                                 конкретному товарі не задано своє.
            delivery_service  — "nova_poshta" / "ukr_poshta"
            city              — місто відправлення
            warehouse_number  — відділення пошти
            delivery_address  — текстова адреса (fallback — у API дропшипера
                                 НЕМАЄ окремого поля для тексту адреси, лише
                                 city+warehouse_number; якщо їх нема, текст
                                 адреси йде в "description", щоб не загубити
                                 інформацію)
            note              — примітка клієнта
            order_source      — джерело замовлення
            order_uid         — наш internal order_uid -> traffic_source

        `order_items` — список товарів:
            supplier_sku, product_name, quantity, price, options_text,
            (опційно) vendor_name, drop_price.

        Кидає MyDropAPIError при помилці валідації/мережі/авторизації.
        Не ретраїть на timeout/розрив з'єднання (idempotent=False) — щоб
        не створити дублікат замовлення в MyDrop.
        """
        customer_name = str(order_data.get("customer_name") or "").strip()
        customer_phone = str(order_data.get("customer_phone") or "").strip()
        default_vendor_name = str(order_data.get("vendor_name") or "").strip()
        if not customer_name or not customer_phone:
            raise MyDropAPIError("Ім'я та телефон клієнта обов'язкові для створення замовлення в MyDrop.")
        if not order_items:
            raise MyDropAPIError("Список товарів не може бути порожнім.")

        products: List[Dict[str, Any]] = []
        for item in order_items:
            vendor_name = str(item.get("vendor_name") or default_vendor_name).strip()
            if not vendor_name:
                raise MyDropAPIError(
                    f"vendor_name (назва постачальника в MyDrop) обов'язковий для Dropshipper API, "
                    f"але не заданий для товару: {item}"
                )
            title = str(item.get("product_name") or "").strip()
            if not title:
                raise MyDropAPIError(f"product_title обов'язковий для MyDrop (Dropshipper API): {item}")
            sku = str(item.get("supplier_sku") or "").strip()

            try:
                price = float(item.get("price") or 0)
                amount = int(item.get("quantity") or 0)
            except (TypeError, ValueError) as e:
                raise MyDropAPIError(f"Некоректна ціна/кількість товару для MyDrop: {item}") from e
            if amount <= 0:
                raise MyDropAPIError(f"Кількість товару має бути > 0 для MyDrop: {item}")

            product_entry: Dict[str, Any] = {
                "vendor_name": vendor_name,
                "product_title": title,
                "price": price,
                "amount": amount,
            }
            if sku:
                product_entry["sku"] = sku
            if item.get("drop_price") is not None:
                try:
                    product_entry["drop_price"] = float(item["drop_price"])
                except (TypeError, ValueError):
                    pass
            if item.get("options_text"):
                product_entry["size_title"] = str(item["options_text"])
            products.append(product_entry)

        payload: Dict[str, Any] = {
            "name": customer_name,
            "phone": customer_phone,
            "products": products,
            "order_source": order_data.get("order_source") or "TavernaBot MiniApp",
        }
        if order_data.get("delivery_service"):
            payload["delivery_service"] = order_data["delivery_service"]

        has_full_address = bool(order_data.get("city") and order_data.get("warehouse_number"))
        if has_full_address:
            payload["city"] = order_data["city"]
            payload["warehouse_number"] = order_data["warehouse_number"]

        description_parts: List[str] = []
        if order_data.get("note"):
            description_parts.append(str(order_data["note"]))
        if not has_full_address and order_data.get("delivery_address"):
            # [ЧОГО БРАКУЄ] Dropshipper API MyDrop не має поля для тексту
            # адреси доставки (лише city+warehouse_number для служб з
            # повною інтеграцією) — тож не втрачаємо адресу, кладемо її в
            # примітку, щоб оператор постачальника вручну оформив ТТН.
            description_parts.append(f"Адреса доставки: {order_data['delivery_address']}")
        if description_parts:
            payload["description"] = " | ".join(description_parts)

        if order_data.get("order_uid"):
            payload["traffic_source"] = order_data["order_uid"]

        logger.info(
            "MyDrop (Dropshipper API): створення замовлення (товарів: %s, вендор(и): %s).",
            len(products), sorted({p["vendor_name"] for p in products}),
        )
        response = await self._request(
            "POST", ORDERS_PATH, api_key, json_body=payload, idempotent=False,
        )
        if not isinstance(response, dict):
            raise MyDropAPIError(
                "MyDrop API повернув неочікуваний формат відповіді на створення замовлення.",
                payload=response,
            )
        logger.info("MyDrop: замовлення створено (Dropshipper API), id=%s.", response.get("id"))
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
