/**
 * backendApi.ts
 *
 * HTTP-клієнт для нашого власного FastAPI-бекенду (web_app.py + api/products.py).
 * Використовується замість прямих запитів до Supabase для каталогу товарів.
 *
 * Бекенд піднімається локально командою:
 *   uvicorn web_app:app --reload --port 8000
 * Фронтенд завжди б'є у відносні шляхи `/api/...`.
 * У dev Vite проксує `/api` на FastAPI (127.0.0.1:8000), тому телефон через
 * ngrok ходить на той самий хост, що й Mini App, а не на себе.
 *
 * Якщо потрібно вказати іншу адресу (стейджинг/прод), додай у
 * taverna-ai-dropshop/.env:
 *   VITE_API_BASE_URL=https://your-backend-domain
 */

// --- Базова адреса бекенду -------------------------------------------------
const RAW_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";

export const API_BASE_URL = RAW_BASE_URL.replace(/\/+$/, "");

// Роут зареєстровано в api/products.py як APIRouter(prefix="/api/v1/products")
// з @router.get("/"), тож фінальний шлях обов'язково має слаш в кінці.
export const PRODUCTS_ENDPOINT = `${API_BASE_URL}/api/v1/products/`;

// --- Типи, що повертає FastAPI (api_models.ProductAPI + share_url) --------
export interface BackendProductOptionValue {
  id: number;
  value: string;
}

export interface BackendProductOption {
  id: number;
  name: string;
  values: BackendProductOptionValue[];
}

export interface BackendProductVariant {
  id: number;
  supplier_offer_id: string;
  final_price: number; // ціна клієнта у грн (ціле число)
  quantity: number;
  is_available: boolean;
  option_value_ids: number[];
}

export interface BackendProduct {
  id: number;
  sku: string;
  name: string;
  description?: string | null;
  pictures?: string[] | null;
  category?: string | null;
  sub_category?: string | null;
  season?: string | null;
  target_niche?: string | null;
  gender?: string | null;
  attributes?: Record<string, unknown> | null;
  search_tags?: string[] | null;
  supplier_name?: string | null;
  options: BackendProductOption[];
  variants: BackendProductVariant[];
  share_url: string;
}

export interface BackendProductColorVariant {
  product_id: number;
  color: string;
  // Перше медіа товару (фото АБО відео) — лишили заради сумісності.
  image_url?: string | null;
  // Усі медіа товару. Кружечок кольору має показувати ФОТО, а не відео
  // (CSS/img не вміє відрендерити .mp4 як прев'ю) — обираємо перший
  // не-відео елемент саме з цього масиву.
  images?: string[] | null;
}

export interface BackendCategorySub {
  name: string;
  count: number;
}

export interface BackendCategoryNiche {
  name: string;
  count: number;
  subcategories: BackendCategorySub[];
}

export interface BackendCategory {
  name: string;
  count: number;
  subcategories: BackendCategorySub[];
  niches?: BackendCategoryNiche[];
}

export interface BackendFilterAttribute {
  name: string;
  values: string[];
}

export interface BackendDynamicFilter {
  name: string;
  options: string[];
}

export interface BackendProductFilters {
  target_niche: string[];
  season: string[];
  gender: string[];
  attributes: BackendFilterAttribute[];
  sub_categories?: BackendCategorySub[];
  total?: number;
  categories?: string[];
  dynamic_filters?: BackendDynamicFilter[];
}

export interface BackendProductList {
  items: BackendProduct[];
  total: number;
}

type QueryValue = string | string[] | undefined;

export type BackendProductsQuery = {
  category?: QueryValue;
  main_category?: QueryValue;
  sub_category?: QueryValue;
  season?: QueryValue;
  target_niche?: QueryValue;
  niche?: QueryValue;
  gender?: QueryValue;
  /** JSON-характеристики: ключ «Виробник» → query ?char_Виробник=Китай */
  characteristics?: Record<string, QueryValue>;
  /** Текстовий пошук по назві/опису/артикулу/бренду (бекенд, ilike). */
  search?: string;
  /** Вітрина конкретного магазину: лише товари цього постачальника. */
  supplier_id?: number;
  limit?: number;
  offset?: number;
};

function unwrapProductList(data: BackendProduct[] | BackendProductList | null | undefined): BackendProductList {
  if (Array.isArray(data)) {
    return { items: data, total: data.length };
  }
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = typeof data?.total === "number" ? data.total : items.length;
  return { items, total };
}

// --- Помилки ----------------------------------------------------------------
export class BackendApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "BackendApiError";
    this.status = status;
  }
}

/** 400 від бекенду: XML-посилання або Telegram-канал уже зайняті іншим магазином. */
export function isDuplicateSourceError(error: unknown): boolean {
  if (!(error instanceof BackendApiError) || error.status !== 400) return false;
  const msg = (error.message || "").toLowerCase();
  return (
    msg.includes("вже зареєстровано") ||
    msg.includes("вже існує") ||
    msg.includes("duplicate")
  );
}

// Скільки максимум чекати відповідь бекенду, перш ніж вважати запит "завислим".
// Без цього таймауту fetch() може висіти невизначено довго (наприклад, якщо
// порт мовчки "тримає" з'єднання), а UI — вічно показувати skeleton-лоадери.
const REQUEST_TIMEOUT_MS = 15000;

/**
 * fetch() з примусовим таймаутом через AbortController.
 * Гарантує, що виклик ЗАВЖДИ завершиться (успіхом або помилкою) за
 * прогнозований час, і компонент зможе скинути isLoading -> false.
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const extraHeaders = (init?.headers || {}) as Record<string, string>;
    const { headers: _ignored, ...restInit } = init || {};
    return await fetch(url, {
      method: "GET",
      ...restInit,
      headers: {
        Accept: "application/json",
        "ngrok-skip-browser-warning": "1",
        ...extraHeaders,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * GET-запит до FastAPI бекенду з людяною обробкою помилок.
 * Розрізняє мережеву помилку/CORS (TypeError від fetch), таймаут (AbortError)
 * та HTTP-помилку (4xx/5xx) — і в ЖОДНОМУ з цих випадків не "висне":
 * завжди або повертає дані, або кидає BackendApiError.
 */
async function backendGet<T>(
  url: string,
  extraHeaders?: Record<string, string>
): Promise<T> {
  let response: Response;

  try {
    response = await fetchWithTimeout(
      url,
      REQUEST_TIMEOUT_MS,
      extraHeaders ? { headers: extraHeaders } : undefined
    );
  } catch (networkError) {
    if (networkError instanceof DOMException && networkError.name === "AbortError") {
      throw new BackendApiError(
        `Бекенд не відповів за ${REQUEST_TIMEOUT_MS / 1000}с. Перевірте, чи запущений ` +
          `FastAPI (uvicorn web_app:app) на ${API_BASE_URL}.`
      );
    }
    // fetch кидає TypeError при мережевій помилці або блокуванні CORS —
    // в обох випадках response взагалі не приходить.
    throw new BackendApiError(
      "Не вдалося з'єднатися з сервером бекенду. Перевірте, чи запущений " +
        `FastAPI (uvicorn web_app:app) на ${API_BASE_URL}, та чи дозволений CORS для цього джерела.`
    );
  }

  if (!response.ok) {
    throw new BackendApiError(
      `Бекенд повернув помилку ${response.status} (${response.statusText})`,
      response.status
    );
  }

  return (await response.json()) as T;
}

export const CATEGORIES_ENDPOINT = `${API_BASE_URL}/api/v1/products/categories`;
export const FILTERS_ENDPOINT = `${API_BASE_URL}/api/v1/products/filters`;

function appendQueryValues(params: URLSearchParams, key: string, value: QueryValue) {
  if (!value) return;
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    const trimmed = String(item).trim();
    if (trimmed) params.append(key, trimmed);
  }
}

function appendCharFilters(
  params: URLSearchParams,
  characteristics?: Record<string, QueryValue>
) {
  if (!characteristics) return;
  Object.entries(characteristics).forEach(([name, value]) => {
    const trimmedName = String(name || "").trim();
    if (!trimmedName) return;
    const key = trimmedName.startsWith("char_") ? trimmedName : `char_${trimmedName}`;
    appendQueryValues(params, key, value);
  });
}

/** Отримати AI-категорії для меню MiniApp (без сирих MyDrop ID). */
export async function fetchBackendCategories(): Promise<BackendCategory[]> {
  return backendGet<BackendCategory[]>(CATEGORIES_ENDPOINT);
}

export interface BackendFiltersQuery {
  niche?: QueryValue;
  target_niche?: QueryValue;
  season?: QueryValue;
  main_category?: QueryValue;
  category?: QueryValue;
  gender?: QueryValue;
}

/** Отримати PIM-значення і лічильники підкатегорій під вибрані фільтри. */
export async function fetchBackendFilters(
  filters?: BackendFiltersQuery
): Promise<BackendProductFilters> {
  const params = new URLSearchParams();
  appendQueryValues(params, "niche", filters?.niche ?? filters?.target_niche);
  appendQueryValues(params, "season", filters?.season);
  appendQueryValues(params, "main_category", filters?.main_category ?? filters?.category);
  appendQueryValues(params, "gender", filters?.gender);
  const qs = params.toString();
  return backendGet<BackendProductFilters>(qs ? `${FILTERS_ENDPOINT}?${qs}` : FILTERS_ENDPOINT);
}

/** Каталог: GET /api/v1/products/?limit=50&offset=0. Порожні фільтри не передаємо. */
export async function fetchBackendProductList(
  filters?: BackendProductsQuery
): Promise<BackendProductList> {
  const params = new URLSearchParams();
  appendQueryValues(params, "category", filters?.category ?? filters?.main_category);
  appendQueryValues(params, "sub_category", filters?.sub_category);
  appendQueryValues(params, "season", filters?.season);
  appendQueryValues(params, "target_niche", filters?.target_niche ?? filters?.niche);
  appendQueryValues(params, "gender", filters?.gender);
  appendCharFilters(params, filters?.characteristics);
  const search = (filters?.search ?? "").trim();
  if (search) params.set("search", search);
  if (typeof filters?.supplier_id === "number" && Number.isFinite(filters.supplier_id)) {
    params.set("supplier_id", String(filters.supplier_id));
  }
  const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 100);
  const offset = Math.max(filters?.offset ?? 0, 0);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const data = await backendGet<BackendProduct[] | BackendProductList>(
    `${PRODUCTS_ENDPOINT}?${params.toString()}`
  );
  return unwrapProductList(data);
}

/** Отримати товари з нашого FastAPI-бекенду (пагінація, щоб не вішати сервер). */
export async function fetchBackendProducts(
  filters?: BackendProductsQuery
): Promise<BackendProduct[]> {
  const { items } = await fetchBackendProductList(filters);
  return items;
}

/** Кілька сторінок по 50, максимум 500 товарів — без одного гігантського запиту. */
export async function fetchBackendProductsPaged(
  filters?: Omit<BackendProductsQuery, "limit" | "offset">,
  maxItems = 500
): Promise<BackendProduct[]> {
  const all: BackendProduct[] = [];
  const pageSize = 50;
  let offset = 0;
  while (all.length < maxItems) {
    const page = await fetchBackendProductList({ ...filters, limit: pageSize, offset });
    all.push(...page.items);
    if (page.items.length < pageSize || all.length >= page.total) break;
    offset += pageSize;
  }
  return all;
}

/**
 * Отримати ОДИН товар за ID з бекенду (GET /api/v1/products/{id}).
 * Використовується сторінкою товару (ProductDetail.tsx), щоб не тягнути
 * весь каталог лише для показу однієї картки.
 *
 * Повертає null, якщо товар не знайдено (404) — виклики мають самі
 * показати відповідний UI ("Товар не знайдено").
 */
export async function fetchProductById(id: string | number): Promise<BackendProduct | null> {
  const url = `${PRODUCTS_ENDPOINT}${encodeURIComponent(String(id))}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url);
  } catch (networkError) {
    if (networkError instanceof DOMException && networkError.name === "AbortError") {
      throw new BackendApiError(
        `Бекенд не відповів за ${REQUEST_TIMEOUT_MS / 1000}с. Перевірте, чи запущений ` +
          `FastAPI (uvicorn web_app:app) на ${API_BASE_URL}.`
      );
    }
    throw new BackendApiError(
      "Не вдалося з'єднатися з сервером бекенду. Перевірте, чи запущений " +
        `FastAPI (uvicorn web_app:app) на ${API_BASE_URL}, та чи дозволений CORS для цього джерела.`
    );
  }

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new BackendApiError(
      `Бекенд повернув помилку ${response.status} (${response.statusText})`,
      response.status
    );
  }

  return (await response.json()) as BackendProduct;
}

/**
 * Інші кольори тієї ж моделі: GET /api/v1/products/{id}/colors
 * Порожній масив, якщо базової моделі ще немає в attributes.
 */
export async function fetchProductColorVariants(
  id: string | number
): Promise<BackendProductColorVariant[]> {
  const url = `${PRODUCTS_ENDPOINT}${encodeURIComponent(String(id))}/colors`;
  const data = await backendGet<BackendProductColorVariant[]>(url);
  return Array.isArray(data) ? data : [];
}

/**
 * Пошук товарів через FastAPI-бекенд.
 *
 * Тепер бекенд (GET /api/v1/products/) приймає ?search=, тож пошук
 * виконується на сервері (ilike по name/description/supplier_sku/brand/model)
 * і повертає лише першу сторінку результатів — замість колишнього
 * тягнення всього каталогу на клієнт і фільтрації на фронті.
 *
 * Вітрина магазину: передай { supplier_id } без search — отримаєш товари
 * конкретного постачальника; { supplier_id, search } — пошук лише в ньому.
 */
export async function searchBackendProducts(
  filters: { search?: string; supplier_id?: number; limit?: number } = {}
): Promise<BackendProduct[]> {
  const search = (filters.search ?? "").trim();
  if (!search && filters.supplier_id == null) {
    return fetchBackendProducts({ limit: filters.limit ?? 50 });
  }
  const { items } = await fetchBackendProductList({
    search: search || undefined,
    supplier_id: filters.supplier_id,
    limit: Math.min(Math.max(filters.limit ?? 50, 1), 100),
  });
  return items;
}

// --- Замовлення (Checkout Mini App -> POST /api/v1/orders/) ------------------

// Роут зареєстровано в api/orders.py як APIRouter(prefix="/api/v1/orders")
// з @router.post("/"), тож фінальний шлях обов'язково має слаш в кінці.
export const ORDERS_ENDPOINT = `${API_BASE_URL}/api/v1/orders/`;

export interface BackendOrderItemPayload {
  variant_id?: number | null;
  product_id?: number | null;
  product_name: string;
  quantity: number;
  price: number;
  options_text?: string | null;
}

export interface BackendOrderPayload {
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  delivery_service?: string;
  payment_type?: string;
  note?: string;
  items: BackendOrderItemPayload[];
}

export interface BackendOrderResponse {
  id: number;
  order_uid: string;
  total_price: number;
  status: string;
}

/** Статус замовлення в B2B-хабі (database.models.OrderStatus). */
export type BackendOrderStatus =
  | "new"
  | "pending"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "returned";

/** Позиція замовлення магазину у B2B-хабі (SupplierOrderItemResponse). */
export interface BackendSupplierOrderItem {
  id: number;
  product_name: string;
  quantity: number;
  price_per_item: number;
  options_text?: string | null;
}

/** Замовлення магазину у B2B-хабі (SupplierOrderResponse). */
export interface BackendSupplierOrder {
  id: number;
  order_uid: string;
  status: BackendOrderStatus | string;
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_service?: string | null;
  delivery_address?: string | null;
  payment_type?: string | null;
  note?: string | null;
  total_price: number;
  created_at?: string | null;
  updated_at?: string | null;
  items: BackendSupplierOrderItem[];
}

/**
 * Створює замовлення на нашому FastAPI-бекенді (POST /api/v1/orders/).
 * Використовується в чекауті (`CheckoutModal.tsx`) замість Supabase Edge
 * Function `telegram-auth` (action: create_order / create_guest_order).
 */
export async function createBackendOrder(orderData: BackendOrderPayload): Promise<BackendOrderResponse> {
  let response: Response;

  try {
    response = await fetchWithTimeout(ORDERS_ENDPOINT, REQUEST_TIMEOUT_MS, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(orderData),
    });
  } catch (networkError) {
    if (networkError instanceof DOMException && networkError.name === "AbortError") {
      throw new BackendApiError(
        `Бекенд не відповів за ${REQUEST_TIMEOUT_MS / 1000}с при створенні замовлення.`
      );
    }
    throw new BackendApiError(
      "Не вдалося з'єднатися з сервером бекенду для створення замовлення. Перевірте, чи запущений " +
        `FastAPI (uvicorn web_app:app) на ${API_BASE_URL}.`
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errJson = await response.json();
      if (errJson?.detail) detail = ` (${errJson.detail})`;
    } catch {
      // тіло відповіді не JSON — ігноруємо, покажемо базовий статус помилки
    }
    throw new BackendApiError(
      `Не вдалося створити замовлення: помилка ${response.status}${detail}`,
      response.status
    );
  }

  return (await response.json()) as BackendOrderResponse;
}

// --- B2B Хаб Замовлень: список замовлень магазину + зміна статусу -------------

/**
 * GET /api/v1/orders/supplier/{supplierId} — замовлення магазину для
 * Orders Hub (сторінка «Замовлення магазину», вкладка «Замовлення»).
 * Доступ: лише власник/менеджер магазину (Bearer initData).
 */
export async function getSupplierOrders(supplierId: number): Promise<BackendSupplierOrder[]> {
  const url = `${API_BASE_URL}/api/v1/orders/supplier/${encodeURIComponent(String(supplierId))}`;
  const data = await backendGet<BackendSupplierOrder[] | BackendSupplierOrder>(url, tgAuthHeaders());
  if (Array.isArray(data)) return data.filter(Boolean);
  if (data && typeof data === "object" && "id" in data) return [data];
  return [];
}

/**
 * PATCH /api/v1/orders/{orderId}/status — зміна статусу замовлення
 * менеджером магазину (Orders Hub). Доступ: лише власник/менеджер.
 */
export async function updateOrderStatus(
  orderId: number,
  status: BackendOrderStatus
): Promise<BackendSupplierOrder> {
  return backendPatch<BackendSupplierOrder>(
    `${API_BASE_URL}/api/v1/orders/${encodeURIComponent(String(orderId))}/status`,
    { status },
    "Не вдалося змінити статус замовлення",
    tgAuthHeaders()
  );
}

// --- Авторизація Mini App + заявка партнера ---------------------------------

export const AUTH_TELEGRAM_ENDPOINT = `${API_BASE_URL}/api/v1/auth/telegram`;
export const SUPPLIERS_REGISTER_ENDPOINT = `${API_BASE_URL}/api/v1/suppliers/register`;

export interface BackendTelegramUser {
  id: number;
  telegram_id: number;
  username?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
  created_at?: string | null;
  haptic_enabled?: boolean;
  notifications_enabled?: boolean;
}

export interface BackendTelegramAuthResponse {
  user: BackendTelegramUser;
  role: string;
  is_guest: boolean;
}

export interface BackendPartnerRegisterPayload {
  supplier_type: string;
  name?: string;
  store_name?: string;
  shop_name?: string;
  yml_link?: string | null;
  xml_url?: string | null;
  source_type?: "xml" | "telegram" | null;
  telegram_channel_link?: string | null;
  channel_link?: string | null;
  telegram_channel?: string | null;
  telegram_id?: number;
  full_name?: string | null;
  company_name?: string | null;
  tax_id?: string | null;
  edrpou_ipn?: string | null;
  email?: string | null;
  phone?: string | null;
  telegram_username?: string | null;
  manager_telegram?: string | null;
  description?: string | null;
  store_description?: string | null;
  iban?: string | null;
  payment_iban?: string | null;
  bank_name?: string | null;
  payment_bank_name?: string | null;
}

export interface BackendPartnerRegisterResponse {
  id: number;
  user_id?: number | null;
  name: string;
  supplier_type?: string | null;
  yml_link?: string | null;
  channel_link?: string | null;
  is_verified: boolean;
  created_at?: string | null;
}

async function backendPost<T>(
  url: string,
  body: unknown,
  errorPrefix: string,
  extraHeaders?: Record<string, string>
): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(extraHeaders || {}),
      },
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    if (networkError instanceof DOMException && networkError.name === "AbortError") {
      throw new BackendApiError(`${errorPrefix}: бекенд не відповів за ${REQUEST_TIMEOUT_MS / 1000}с.`);
    }
    throw new BackendApiError(
      `${errorPrefix}: немає з'єднання з FastAPI на ${API_BASE_URL}.`
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errJson = await response.json();
      if (errJson?.detail) {
        detail = typeof errJson.detail === "string" ? ` (${errJson.detail})` : ` (${JSON.stringify(errJson.detail)})`;
      }
    } catch {
      // тіло відповіді не JSON
    }
    throw new BackendApiError(`${errorPrefix}: помилка ${response.status}${detail}`, response.status);
  }

  return (await response.json()) as T;
}

async function backendPatch<T>(
  url: string,
  body: unknown,
  errorPrefix: string,
  extraHeaders?: Record<string, string>
): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(extraHeaders || {}),
      },
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    if (networkError instanceof DOMException && networkError.name === "AbortError") {
      throw new BackendApiError(`${errorPrefix}: бекенд не відповів за ${REQUEST_TIMEOUT_MS / 1000}с.`);
    }
    throw new BackendApiError(
      `${errorPrefix}: немає з'єднання з FastAPI на ${API_BASE_URL}.`
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errJson = await response.json();
      if (errJson?.detail) {
        detail = typeof errJson.detail === "string" ? ` (${errJson.detail})` : ` (${JSON.stringify(errJson.detail)})`;
      }
    } catch {
      // тіло відповіді не JSON
    }
    throw new BackendApiError(`${errorPrefix}: помилка ${response.status}${detail}`, response.status);
  }

  return (await response.json()) as T;
}

async function backendDelete<T>(
  url: string,
  errorPrefix: string,
  extraHeaders?: Record<string, string>
): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        ...(extraHeaders || {}),
      },
    });
  } catch (networkError) {
    if (networkError instanceof DOMException && networkError.name === "AbortError") {
      throw new BackendApiError(`${errorPrefix}: бекенд не відповів за ${REQUEST_TIMEOUT_MS / 1000}с.`);
    }
    throw new BackendApiError(
      `${errorPrefix}: немає з'єднання з FastAPI на ${API_BASE_URL}.`
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errJson = await response.json();
      if (errJson?.detail) {
        detail = typeof errJson.detail === "string" ? ` (${errJson.detail})` : ` (${JSON.stringify(errJson.detail)})`;
      }
    } catch {
      // тіло відповіді не JSON
    }
    throw new BackendApiError(`${errorPrefix}: помилка ${response.status}${detail}`, response.status);
  }

  return (await response.json()) as T;
}

/** POST /api/v1/auth/telegram — валідація initData, Гость vs Клієнт. */
export async function authTelegramMiniApp(
  initData: string
): Promise<BackendTelegramAuthResponse> {
  return backendPost<BackendTelegramAuthResponse>(
    AUTH_TELEGRAM_ENDPOINT,
    { initData, init_data: initData },
    "Не вдалося авторизуватись через Telegram"
  );
}

export const USER_SETTINGS_ENDPOINT = `${API_BASE_URL}/api/v1/users/me/settings`;

export interface BackendUserSettingsUpdate {
  haptic_enabled?: boolean;
  notifications_enabled?: boolean;
}

/** PATCH /api/v1/users/me/settings — вібрація та сповіщення Mini App. */
export async function updateMyUserSettings(
  settings: BackendUserSettingsUpdate
): Promise<BackendUserSettingsUpdate> {
  const initData =
    typeof window !== "undefined"
      ? String(
          window.Telegram?.WebApp?.initData ||
            window.__TAVERNA_INIT_DATA__ ||
            sessionStorage.getItem("taverna_tg_init_data") ||
            ""
        )
      : "";
  const headers: Record<string, string> = {};
  if (initData) {
    headers.Authorization = `Bearer ${initData}`;
  }
  return backendPatch<BackendUserSettingsUpdate>(
    USER_SETTINGS_ENDPOINT,
    settings,
    "Не вдалося зберегти налаштування",
    headers
  );
}

/** POST /api/v1/suppliers/register — заявка «Стати партнером». */
export async function registerPartner(
  payload: BackendPartnerRegisterPayload,
  initData?: string
): Promise<BackendPartnerRegisterResponse> {
  const headers: Record<string, string> = {};
  if (initData) {
    headers.Authorization = `Bearer ${initData}`;
  }
  return backendPost<BackendPartnerRegisterResponse>(
    SUPPLIERS_REGISTER_ENDPOINT,
    payload,
    "Не вдалося надіслати заявку партнера",
    headers
  );
}

export const SUPPLIERS_ME_ENDPOINT = `${API_BASE_URL}/api/v1/suppliers/me`;
export const SUPPLIERS_VERIFY_TELEGRAM_ENDPOINT = `${API_BASE_URL}/api/v1/suppliers/verify-telegram`;
const VERIFY_TELEGRAM_TIMEOUT_MS = 60000;

/** POST /api/v1/suppliers/verify-telegram — жива перевірка доступу до каналу. */
export async function verifyTelegramChannel(
  telegramChannelLink: string
): Promise<{ message: string }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(SUPPLIERS_VERIFY_TELEGRAM_ENDPOINT, VERIFY_TELEGRAM_TIMEOUT_MS, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ telegram_channel_link: telegramChannelLink }),
    });
  } catch (networkError) {
    if (networkError instanceof DOMException && networkError.name === "AbortError") {
      throw new BackendApiError(
        `Не вдалося перевірити канал: бекенд не відповів за ${VERIFY_TELEGRAM_TIMEOUT_MS / 1000}с.`
      );
    }
    throw new BackendApiError("Не вдалося перевірити канал: немає з'єднання з бекендом.");
  }

  if (!response.ok) {
    let detail = "Не вдалося перевірити канал";
    try {
      const errJson = await response.json();
      if (typeof errJson?.detail === "string" && errJson.detail.trim()) {
        detail = errJson.detail;
      }
    } catch {
      // тіло відповіді не JSON
    }
    throw new BackendApiError(detail, response.status);
  }

  return (await response.json()) as { message: string };
}

export const SUPPLIERS_REQUEST_DELETION_ENDPOINT = `${API_BASE_URL}/api/v1/suppliers/me/request-deletion`;
export const SUPPLIERS_IMPORT_PROGRESS_ENDPOINT = `${API_BASE_URL}/api/v1/suppliers/me/import-progress`;
export const MY_SHOPS_ENDPOINT = `${API_BASE_URL}/api/v1/suppliers/me/shops`;
export const MY_WALLET_ENDPOINT = `${API_BASE_URL}/api/v1/wallets/me`;
export const MY_WALLET_TRANSACTIONS_ENDPOINT = `${API_BASE_URL}/api/v1/wallets/me/transactions`;
export const SUPPLIER_DETAIL_ENDPOINT = `${API_BASE_URL}/api/v1/suppliers`;
export const PUBLIC_SUPPLIERS_LIST_ENDPOINT = `${API_BASE_URL}/api/v1/suppliers/public`;
export const ADMIN_PENDING_SUPPLIERS_ENDPOINT = `${API_BASE_URL}/api/v1/admin/suppliers/pending`;
export const ADMIN_DIRECT_CREATE_SUPPLIER_ENDPOINT = `${API_BASE_URL}/api/v1/admin/suppliers/direct-create`;

export interface BackendSupplierMe {
  id: number;
  store_name: string;
  supplier_type?: string | null;
  status: string;
  is_verified: boolean;
  product_count: number;
  completed_products: number;
  deletion_requested: boolean;
  created_at?: string | null;
  approved_at?: string | null;
  restored_at?: string | null;
  deleted_at?: string | null;
}

export type BackendQueueShopStatus = "fetching_xml" | "parsing" | "processing" | "waiting";

export interface BackendWidgetQueueShop {
  shop_name: string;
  status: BackendQueueShopStatus;
  processed: number;
  total: number;
  queue_position: number;
  estimated_minutes: number;
  supplier_id?: number;
  is_fetching_xml?: boolean;
}

export interface BackendSupplierQueueShop {
  supplier_id: number;
  shop_name: string;
  status?: BackendQueueShopStatus;
  total: number;
  processed: number;
  pending_count: number;
  queue_position: number;
  items_ahead: number;
  estimated_minutes: number;
  wait_minutes: number;
  is_processing: boolean;
  is_fetching_xml?: boolean;
}

export interface BackendSupplierImportProgress {
  total: number;
  completed: number;
  processed?: number;
  estimated_minutes: number;
  is_importing: boolean;
  queue_ahead?: number;
  queue_position?: number;
  items_ahead: number;
  shop_name?: string | null;
  supplier_id?: number | null;
  pending_count?: number;
  wait_minutes?: number;
  is_fetching_xml?: boolean;
  shops?: BackendSupplierQueueShop[];
}

export interface BackendAdminAiQueueCurrent {
  supplier_id: number;
  shop_name: string;
  processed: number;
  total: number;
  pending_count?: number;
  remaining_minutes: number;
  wait_minutes?: number;
  estimated_minutes?: number;
  created_at?: string | null;
  is_fetching_xml?: boolean;
}

export interface BackendAdminAiQueueWaitingItem {
  supplier_id: number;
  shop_name: string;
  pending_count: number;
  queue_position: number;
  processed?: number;
  total?: number;
  remaining_minutes?: number;
  wait_minutes?: number;
  estimated_minutes?: number;
  created_at?: string | null;
  is_fetching_xml?: boolean;
}

export interface BackendAdminAiQueue {
  current_processing: BackendAdminAiQueueCurrent | null;
  waiting_list: BackendAdminAiQueueWaitingItem[];
  shops?: BackendSupplierQueueShop[];
}

export interface BackendAdminStore {
  id: number;
  shop_name: string;
  company_name?: string | null;
  contact_name?: string | null;
  is_active: boolean;
  markup_percentage?: number | null;
  created_at?: string | null;
  manager_telegram?: string | null;
  xml_url?: string | null;
  description?: string | null;
  product_count: number;
  user_id?: number | null;
  telegram_id?: number | null;
  status: string;
  logo_url?: string | null;
  cover_image_url?: string | null;
}

export interface BackendPendingSupplierApplication {
  id: number;
  shop_name: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  company_name?: string | null;
  supplier_type?: string | null;
  tax_id?: string | null;
  description?: string | null;
  xml_url?: string | null;
  yml_link?: string | null;
  source_type?: string | null;
  telegram_channel_link?: string | null;
  channel_link?: string | null;
  manager_telegram?: string | null;
  iban?: string | null;
  bank_name?: string | null;
  status: string;
  is_verified: boolean;
  telegram_id?: number | null;
  ai_score_report?: string | null;
  scoring_result?: string | null;
  trial_ends_at?: string | null;
  created_at?: string | null;
  approved_at?: string | null;
  restored_at?: string | null;
  deleted_at?: string | null;
  import_started?: boolean;
  deletion_reason?: string | null;
}

function adminTelegramHeaders(): Record<string, string> {
  const initData =
    typeof window !== "undefined"
      ? String(window.Telegram?.WebApp?.initData || "")
      : "";
  const headers: Record<string, string> = {};
  if (initData) {
    headers.Authorization = `Bearer ${initData}`;
  }
  return headers;
}

/** GET /api/v1/suppliers/me — усі магазини поточного постачальника. */
export async function fetchMySuppliers(): Promise<BackendSupplierMe[]> {
  try {
    const data = await backendGet<BackendSupplierMe[] | BackendSupplierMe>(
      SUPPLIERS_ME_ENDPOINT,
      adminTelegramHeaders()
    );
    if (Array.isArray(data)) {
      return data.filter(Boolean);
    }
    if (data && typeof data === "object" && "id" in data) {
      return [data];
    }
    return [];
  } catch (error) {
    if (error instanceof BackendApiError && (error.status === 404 || error.status === 401)) {
      return [];
    }
    throw error;
  }
}

/** GET /api/v1/suppliers/me — перший магазин (сумісність). */
export async function fetchMySupplier(): Promise<BackendSupplierMe | null> {
  const rows = await fetchMySuppliers();
  return rows[0] ?? null;
}

/** POST /api/v1/suppliers/me/request-deletion — заявка адміну на видалення магазину. */
export async function requestSupplierDeletion(reason: string): Promise<{ ok: boolean; detail?: string }> {
  return backendPost(
    SUPPLIERS_REQUEST_DELETION_ENDPOINT,
    { reason },
    "Не вдалося надіслати заявку на видалення",
    adminTelegramHeaders()
  );
}

// --- B2B Дашборд «Мої Товари» (Products Dashboard) ----------------------------

/** Уніфікований статус товару у B2B-дашборді (api/suppliers.py). */
export type BackendSupplierProductStatus =
  | "active"
  | "inactive"
  | "archived"
  | "deleted"
  | "pending_ai"
  | "processing_ai"
  | "failed_ai";

/** Товар у B2B-дашборді «Мої Товари» (SupplierProductItemResponse). */
export interface BackendSupplierProduct {
  id: number;
  sku: string;
  name: string;
  category?: string | null;
  sub_category?: string | null;
  picture?: string | null;
  /** Ціна першого доступного варіанта, ГРН (ціле число, без копійок). */
  price?: number | null;
  /** Сумарний залишок доступних варіантів. */
  stock: number;
  status: BackendSupplierProductStatus | string;
  created_at?: string | null;
}

export interface BackendSupplierProductList {
  total: number;
  items: BackendSupplierProduct[];
}

/** Вкладки фільтра «Мої Товари». */
export type SupplierProductsTab =
  | "all"
  | "active"
  | "moderation"
  | "drafts";

/**
 * GET /api/v1/suppliers/{supplierId}/products — товари магазину з усіма
 * статусами для дашборду «Мої Товари» (публічний каталог ховає
 * inactive/archived, цей ендпоінт — ні).
 * Доступ: лише власник/менеджер (Bearer initData).
 */
export async function getSupplierProducts(
  supplierId: number,
  options: {
    tab?: SupplierProductsTab;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<BackendSupplierProductList> {
  const params = new URLSearchParams();
  const tab = options.tab ?? "all";
  if (tab === "active") params.set("tab", "active");
  else if (tab === "moderation") params.set("tab", "pending_ai");
  else if (tab === "drafts") params.set("tab", "inactive");
  const search = (options.search ?? "").trim();
  if (search) params.set("search", search);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const qs = params.toString();
  const url = `${API_BASE_URL}/api/v1/suppliers/${encodeURIComponent(
    String(supplierId)
  )}/products${qs ? `?${qs}` : ""}`;
  const data = await backendGet<BackendSupplierProductList | BackendSupplierProduct[]>(
    url,
    tgAuthHeaders()
  );
  if (Array.isArray(data)) return { items: data, total: data.length };
  if (data && Array.isArray(data.items)) {
    return { items: data.items, total: typeof data.total === "number" ? data.total : data.items.length };
  }
  return { items: [], total: 0 };
}


// --- B2B CRUD товару: картка / створення / редагування -----------------------

/** Повна картка товару для форми (SupplierProductDetailResponse). */
export interface BackendSupplierProductDetail {
  id: number;
  sku: string;
  name: string;
  description?: string | null;
  category?: string | null;
  sub_category?: string | null;
  pictures: string[];
  /** Ціна першого доступного варіанта, ГРН. */
  price?: number | null;
  stock: number;
  /** 'active' | 'inactive' | ... (уніфікований статус). */
  status: BackendSupplierProductStatus | string;
  variant_id?: number | null;
  created_at?: string | null;
}

/** Дані для створення товару (POST /suppliers/{id}/products). */
export interface SupplierProductCreateData {
  name: string;
  /** Порожній рядок = очистити (бекенд конвертує в NULL). */
  description?: string | null;
  /** Ціна у ГРН (ціле число, без копійок). */
  price: number;
  stock?: number;
  category?: string | null;
  pictures?: string[];
  /** 'active' — одразу у каталог, 'inactive' — чернетка (за замовчуванням). */
  status?: "active" | "inactive";
}

/** Partial-дані для редагування (PATCH /suppliers/{id}/products/{pid}). */
export interface SupplierProductUpdateData {
  name?: string;
  /** Порожній рядок = очистити опис. */
  description?: string | null;
  price?: number;
  stock?: number;
  /** Порожній рядок = очистити категорію. */
  category?: string | null;
  sub_category?: string | null;
  pictures?: string[];
  status?: "active" | "inactive";
}

/**
 * GET /api/v1/suppliers/{supplierId}/products/{productId} — повна картка
 * товару для форми редагування. Доступ: власник/менеджер (Bearer initData).
 */
export async function getSupplierProduct(
  supplierId: number,
  productId: number
): Promise<BackendSupplierProductDetail> {
  const url = `${API_BASE_URL}/api/v1/suppliers/${encodeURIComponent(
    String(supplierId)
  )}/products/${encodeURIComponent(String(productId))}`;
  return backendGet<BackendSupplierProductDetail>(url, tgAuthHeaders());
}

/**
 * POST /api/v1/suppliers/{supplierId}/products — створити товар вручну.
 * supplier_id береться з URL (не з тіла) — безпека мультитенантності.
 */
export async function createSupplierProduct(
  supplierId: number,
  data: SupplierProductCreateData
): Promise<BackendSupplierProductDetail> {
  return backendPost<BackendSupplierProductDetail>(
    `${API_BASE_URL}/api/v1/suppliers/${encodeURIComponent(String(supplierId))}/products`,
    data,
    "Не вдалося створити товар",
    tgAuthHeaders()
  );
}

/**
 * PATCH /api/v1/suppliers/{supplierId}/products/{productId} — оновити
 * товар (назва/опис/ціна/залишок/категорія/фото/статус).
 */
export async function updateSupplierProduct(
  supplierId: number,
  productId: number,
  data: SupplierProductUpdateData
): Promise<BackendSupplierProductDetail> {
  return backendPatch<BackendSupplierProductDetail>(
    `${API_BASE_URL}/api/v1/suppliers/${encodeURIComponent(
      String(supplierId)
    )}/products/${encodeURIComponent(String(productId))}`,
    data,
    "Не вдалося зберегти товар",
    tgAuthHeaders()
  );
}


// --- Менеджери магазину + інвайт-посилання ----------------------------------

export interface BackendMyShop {
  id: number;
  store_name: string;
  supplier_type?: string | null;
  status: string;
  is_active: boolean;
  /** 'owner' — власник, 'manager' — менеджер через supplier_managers. */
  role: "owner" | "manager";
  shop_url?: string | null;
  logo_url?: string | null;
  cover_image_url?: string | null;
  product_count: number;
  completed_products: number;
  deletion_requested: boolean;
  created_at?: string | null;
  /** RBAC: права поточного менеджера в цьому магазині (власник — null = можна все). */
  permissions?: ManagerPermissions | null;
}

/** GET /api/v1/suppliers/me/shops — магазини, де я власник або менеджер. */
export async function getMyShops(): Promise<BackendMyShop[]> {
  const data = await backendGet<BackendMyShop[]>(
    MY_SHOPS_ENDPOINT,
    adminTelegramHeaders()
  );
  return Array.isArray(data) ? data.filter(Boolean) : [];
}

/** Матриця прав менеджера (RBAC, B2B). */
export interface ManagerPermissions {
  can_edit_info: boolean;
  can_manage_products: boolean;
  can_view_balance: boolean;
  can_resolve_disputes: boolean;
}

/** B2B-тарифи менеджера: СУМИ В КОПІЙКАХ (бекенд-контракт). */
export interface ManagerContractRates {
  rate_per_order: number;
  rate_per_dispute: number;
}

/** Omnichannel: як менеджер отримує комунікацію. */
export interface ManagerCommSettings {
  chat_channel: "webapp" | "telegram" | string;
  receive_notifications: boolean;
}

export interface BackendSupplierManager {
  user_id: number;
  telegram_id?: number | null;
  username?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  permissions?: ManagerPermissions;
  /** B2B-контракт: тарифи (в копійках) та комунікація. */
  rates?: ManagerContractRates;
  comm_settings?: ManagerCommSettings;
}

export interface BackendSupplierInviteLink {
  ok: boolean;
  /** Готове t.me-посилання (поле link у відповіді бекенду). */
  link: string;
  token: string;
  expires_at?: string | null;
}

/** Базовий префікс мультитенантних роутів менеджерів конкретного магазину. */
const supplierManagersEndpoint = (supplierId: number) =>
  `${SUPPLIER_DETAIL_ENDPOINT}/${supplierId}/managers`;

/** GET /api/v1/suppliers/{supplierId}/managers — список менеджерів магазину (лише власник). */
export async function getStoreManagers(
  supplierId: number
): Promise<BackendSupplierManager[]> {
  const data = await backendGet<BackendSupplierManager[]>(
    supplierManagersEndpoint(supplierId),
    adminTelegramHeaders()
  );
  return Array.isArray(data) ? data.filter(Boolean) : [];
}

/**
 * POST /api/v1/suppliers/{supplierId}/invite-link — згенерувати інвайт
 * для конкретного магазину (токен живе 24 год). Лише власник.
 */
export async function generateInviteLink(
  supplierId: number
): Promise<BackendSupplierInviteLink> {
  return backendPost<BackendSupplierInviteLink>(
    `${SUPPLIER_DETAIL_ENDPOINT}/${supplierId}/invite-link`,
    {},
    "Не вдалося згенерувати посилання-запрошення",
    adminTelegramHeaders()
  );
}

/** DELETE /api/v1/suppliers/{supplierId}/managers/{user_id} — видалити менеджера (лише власник). */
export async function removeManager(
  supplierId: number,
  userId: number
): Promise<{ status: string }> {
  return backendDelete<{ status: string }>(
    `${supplierManagersEndpoint(supplierId)}/${userId}`,
    "Не вдалося видалити менеджера",
    adminTelegramHeaders()
  );
}

/**
 * PATCH /api/v1/suppliers/{supplierId}/managers/{user_id}
 * Оновлює контракт менеджера конкретного магазину: тарифи (rates),
 * права (permissions) та/або комунікацію (comm_settings). Лише власник.
 * rates передаються В КОПІЙКАХ — конвертую гривні→копійки робить викликець.
 */
export async function updateManagerContract(
  supplierId: number,
  userId: number,
  payload: {
    rates?: ManagerContractRates;
    permissions?: ManagerPermissions;
    comm_settings?: ManagerCommSettings;
  }
): Promise<{
  status: string;
  rates?: ManagerContractRates | null;
  permissions?: ManagerPermissions | null;
  comm_settings?: ManagerCommSettings | null;
}> {
  return backendPatch<
    | { status: string; rates?: ManagerContractRates | null; permissions?: ManagerPermissions | null; comm_settings?: ManagerCommSettings | null }
  >(
    `${supplierManagersEndpoint(supplierId)}/${userId}`,
    payload,
    "Не вдалося оновити контракт менеджера",
    adminTelegramHeaders()
  );
}

/** Власний контракт менеджера магазину (RBAC-права + тарифи + комунікація). */
export interface BackendMyManagerContract {
  supplier_id: number;
  user_id: number;
  permissions: ManagerPermissions;
  rates: ManagerContractRates;
  comm_settings: ManagerCommSettings;
}

/**
 * GET /api/v1/suppliers/{supplierId}/managers/me — контракт поточного
 * менеджера цього магазину. 403, якщо юзер не менеджер даного магазину.
 */
export async function getMyManagerContract(
  supplierId: number
): Promise<BackendMyManagerContract> {
  return backendGet<BackendMyManagerContract>(
    `${supplierManagersEndpoint(supplierId)}/me`,
    adminTelegramHeaders()
  );
}

// --- Фінансове ядро: Гаманець + Журнал транзакцій (Ledger) ------------------

/**
 * Гаманець користувача з FastAPI. УСІ СУМИ — В КОПІЙКАХ!
 * На UI конвертуємо: (value / 100).toFixed(2).
 */
export interface BackendWallet {
  id: number;
  user_id: number;
  main_balance: number;  // доступно до виводу (копійки)
  hold_balance: number;   // заморожено до закриття угоди (копійки)
  bonus_balance: number;  // внутрішня валюта платформи (бонуси, НЕ копійки)
  updated_at?: string | null;
}

/** Запис журналу транзакцій (Ledger). amount — В КОПІЙКАХ: > 0 нарахування, < 0 списання. */
export interface BackendTransaction {
  id: number;
  wallet_id: number;
  amount: number;          // копійки
  currency: string;        // 'UAH' | 'BONUS'
  type: string;            // 'order_reward', 'dispute_reward', 'withdrawal', 'platform_fee', ...
  description?: string | null;
  reference_id?: string | null;
  created_at?: string | null;
}

/** GET /api/v1/wallets/me — гаманець поточного користувача (створюється при першому виклику). */
export async function getMyWallet(): Promise<BackendWallet> {
  return backendGet<BackendWallet>(
    MY_WALLET_ENDPOINT,
    adminTelegramHeaders()
  );
}

/** GET /api/v1/wallets/me/transactions — журнал транзакцій (новіші першими, limit=50). */
export async function getMyTransactions(limit = 50): Promise<BackendTransaction[]> {
  const data = await backendGet<BackendTransaction[]>(
    `${MY_WALLET_TRANSACTIONS_ENDPOINT}?limit=${encodeURIComponent(String(limit))}`,
    adminTelegramHeaders()
  );
  return Array.isArray(data) ? data.filter(Boolean) : [];
}

/**
 * GET /api/v1/wallets/supplier/{supplierId}/transactions — історія транзакцій
 * ОПЕРАЦІЙНОГО БАЛАНСУ магазину (фінансовий спліт). Доступ: власник або
 * менеджер з правом can_view_balance. amount — В КОПІЙКАХ.
 */
export async function getSupplierTransactions(
  supplierId: number,
  limit = 50,
  offset = 0
): Promise<BackendTransaction[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(Math.max(0, offset)),
  });
  const data = await backendGet<BackendTransaction[]>(
    `${API_BASE_URL}/api/v1/wallets/supplier/${encodeURIComponent(String(supplierId))}/transactions?${params.toString()}`,
    adminTelegramHeaders()
  );
  return Array.isArray(data) ? data.filter(Boolean) : [];
}

// --- Картка магазину: GET/PATCH /suppliers/{id} ------------------------------

export interface BackendSupplierDetail {
  id: number;
  store_name: string;
  store_description?: string | null;
  supplier_type?: string | null;
  status: string;
  is_active: boolean;
  role: "owner" | "manager";
  shop_url?: string | null;
  manager_telegram?: string | null;
  contact_phone?: string | null;
  email?: string | null;
  payout_method?: string | null;
  payout_iban?: string | null;
  payout_card_token?: string | null;
  logo_url?: string | null;
  cover_image_url?: string | null;
  shop_photos?: string[];
  return_policy?: string | null;
  exchange_policy?: string | null;
  shipping_schedule?: string | null;
  shipping_days?: string[];
  return_contact_info?: string | null;
  allow_bot_chat?: boolean;
  telegram_forward_enabled?: boolean;
  product_count: number;
  completed_products: number;
  deletion_requested: boolean;
  /** RBAC: власні права поточного менеджера (owner отримує null — можна все). */
  my_permissions?: ManagerPermissions | null;
  created_at?: string | null;
  approved_at?: string | null;
  /**
   * Фінансовий спліт магазину (У КОПІЙКАХ). Бекенд заповнює лише
   * власнику або менеджеру з правом can_view_balance; інакше 0.
   */
  balance?: number;
  platform_debt?: number;
  managers_debt?: number;
  /** Налаштування авто-виводу (лише власник; менеджер бачить null). */
  auto_payout_enabled?: boolean | null;
  auto_payout_schedule?: "daily" | "weekly" | null;
}

/** Фінансові налаштування магазину з PATCH /suppliers/{id}/finance (SupplierResponse). */
export interface BackendSupplierFinanceSettings {
  id: number;
  balance: number;
  platform_debt: number;
  managers_debt: number;
  auto_payout_enabled: boolean;
  auto_payout_schedule?: "daily" | "weekly" | null;
  [key: string]: unknown;
}

export interface BackendSupplierUpdate {
  store_name?: string;
  store_description?: string;
  manager_telegram?: string;
  payout_method?: "iban" | "card_token";
  payout_iban?: string;
  payout_card_token?: string;
  logo_url?: string;
  cover_image_url?: string;
  shop_photos?: string[];
  return_policy?: string;
  exchange_policy?: string;
  shipping_schedule?: string;
  shipping_days?: string[];
  return_contact_info?: string;
  allow_bot_chat?: boolean;
  telegram_forward_enabled?: boolean;
}

/** GET /api/v1/suppliers/{id} — дані магазину (власник або менеджер). */
export async function getSupplierById(id: string | number): Promise<BackendSupplierDetail> {
  return backendGet<BackendSupplierDetail>(
    `${SUPPLIER_DETAIL_ENDPOINT}/${id}`,
    adminTelegramHeaders()
  );
}

/** PATCH /api/v1/suppliers/{id} — оновити профіль магазину (власник або менеджер). */
export async function updateSupplier(
  id: string | number,
  data: BackendSupplierUpdate
): Promise<BackendSupplierDetail> {
  return backendPatch<BackendSupplierDetail>(
    `${SUPPLIER_DETAIL_ENDPOINT}/${id}`,
    data,
    "Не вдалося зберегти магазин",
    adminTelegramHeaders()
  );
}

/**
 * PATCH /api/v1/suppliers/{id}/finance — налаштування авто-виводу магазину
 * (auto_payout_enabled, auto_payout_schedule 'daily'|'weekly').
 * Доступ: лише власник. Функція потрібна сторінці «Фінанси магазину».
 */
export async function updateSupplierFinance(
  id: string | number,
  data: {
    auto_payout_enabled?: boolean;
    auto_payout_schedule?: "daily" | "weekly" | null;
  }
): Promise<BackendSupplierFinanceSettings> {
  return backendPatch<BackendSupplierFinanceSettings>(
    `${SUPPLIER_DETAIL_ENDPOINT}/${id}/finance`,
    data,
    "Не вдалося зберегти налаштування виплат",
    adminTelegramHeaders()
  );
}

// --- Публічна вітрина магазину (без авторизації) ------------------------------

export interface BackendPublicSupplier {
  id: number;
  name?: string | null;
  store_name: string;
  store_description?: string | null;
  logo_url?: string | null;
  cover_image_url?: string | null;
  telegram_channel_link?: string | null;
  is_active: boolean;
  return_policy?: string | null;
  exchange_policy?: string | null;
  shipping_schedule?: string | null;
  shipping_days?: string[];
  created_at?: string | null;
  /** Заповнюється лише у списку /suppliers/public (сторінка «Постачальники»). */
  product_count?: number;
  completed_products?: number;
}

/**
 * GET /api/v1/suppliers/{id}/public — публічні дані вітрини магазину
 * (сторінка /supplier/{id}). БЕЗ Authorization: покупець може не мати
 * Telegram-авторизації. 404 → null («Магазин не знайдено»).
 */
export async function getPublicSupplier(id: string | number): Promise<BackendPublicSupplier | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${SUPPLIER_DETAIL_ENDPOINT}/${encodeURIComponent(String(id))}/public`
    );
  } catch (networkError) {
    if (networkError instanceof DOMException && networkError.name === "AbortError") {
      throw new BackendApiError(
        `Бекенд не відповів за ${REQUEST_TIMEOUT_MS / 1000}с. Перевірте, чи запущений ` +
          `FastAPI (uvicorn web_app:app) на ${API_BASE_URL}.`
      );
    }
    throw new BackendApiError(
      "Не вдалося з'єднатися з сервером бекенду. Перевірте, чи запущений " +
        `FastAPI (uvicorn web_app:app) на ${API_BASE_URL}, та чи дозволений CORS для цього джерела.`
    );
  }

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new BackendApiError(
      `Бекенд повернув помилку ${response.status} (${response.statusText})`,
      response.status
    );
  }

  return (await response.json()) as BackendPublicSupplier;
}

/**
 * GET /api/v1/suppliers/public — публічний список магазинів (сторінка
 * «Постачальники»). БЕЗ Authorization: покупець може не мати Telegram-
 * авторизації. Статистику (product_count/completed_products) рахує бекенд.
 */
export async function getPublicSuppliers(params: {
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<BackendPublicSupplier[]> {
  const searchParams = new URLSearchParams();
  const search = (params.search ?? "").trim();
  if (search) searchParams.set("search", search);
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);
  searchParams.set("limit", String(limit));
  searchParams.set("offset", String(offset));
  const data = await backendGet<BackendPublicSupplier[] | BackendPublicSupplier>(
    `${PUBLIC_SUPPLIERS_LIST_ENDPOINT}?${searchParams.toString()}`
  );
  if (Array.isArray(data)) {
    return data.filter(Boolean);
  }
  // Бекенд з якихось причин повернув один об'єкт замість масиву — не падаємо.
  if (data && typeof data === "object" && "id" in data) {
    return [data];
  }
  return [];
}

/** GET /api/v1/suppliers/me/import-progress — масив магазинів у XML/AI-черзі. */
export async function fetchSupplierImportProgress(): Promise<BackendWidgetQueueShop[]> {
  const data = await backendGet<BackendWidgetQueueShop[] | { shops?: BackendWidgetQueueShop[] }>(
    SUPPLIERS_IMPORT_PROGRESS_ENDPOINT,
    adminTelegramHeaders()
  );
  if (Array.isArray(data)) {
    return data.filter(Boolean);
  }
  if (data && Array.isArray(data.shops)) {
    return data.shops.filter(Boolean);
  }
  return [];
}

export async function fetchAdminStores(
  telegramId?: number | null
): Promise<BackendAdminStore[]> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendGet<BackendAdminStore[]>(
    `${API_BASE_URL}/api/v1/admin/suppliers/all${params}`,
    adminTelegramHeaders()
  );
}

export async function fetchAdminImportProgress(
  telegramId?: number | null
): Promise<BackendSupplierImportProgress> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendGet<BackendSupplierImportProgress>(
    `${API_BASE_URL}/api/v1/admin/suppliers/import-progress${params}`,
    adminTelegramHeaders()
  );
}

export async function fetchAdminAiQueue(
  telegramId?: number | null
): Promise<BackendAdminAiQueue> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendGet<BackendAdminAiQueue>(
    `${API_BASE_URL}/api/v1/admin/ai-queue${params}`,
    adminTelegramHeaders()
  );
}

export async function fetchPendingSupplierApplications(
  telegramId?: number | null
): Promise<BackendPendingSupplierApplication[]> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendGet<BackendPendingSupplierApplication[]>(
    `${ADMIN_PENDING_SUPPLIERS_ENDPOINT}${params}`,
    adminTelegramHeaders()
  );
}

export async function fetchSupplierDeletionRequests(
  telegramId?: number | null
): Promise<BackendPendingSupplierApplication[]> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendGet<BackendPendingSupplierApplication[]>(
    `${API_BASE_URL}/api/v1/admin/suppliers/deletion-requests${params}`,
    adminTelegramHeaders()
  );
}

export async function fetchSupplierHistory(
  telegramId?: number | null
): Promise<BackendPendingSupplierApplication[]> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendGet<BackendPendingSupplierApplication[]>(
    `${API_BASE_URL}/api/v1/admin/suppliers/history${params}`,
    adminTelegramHeaders()
  );
}

export async function restoreSupplier(
  supplierId: number,
  telegramId?: number | null
): Promise<BackendPendingSupplierApplication> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendPost<BackendPendingSupplierApplication>(
    `${API_BASE_URL}/api/v1/admin/suppliers/${supplierId}/restore${params}`,
    {},
    "Не вдалося відновити магазин",
    adminTelegramHeaders()
  );
}

export async function approveSupplierDeletion(
  supplierId: number,
  telegramId?: number | null
): Promise<{
  ok: boolean;
  supplier_id: number;
  status: string;
  user_reverted: boolean;
  products_archived: number;
  ai_cancelled: number;
  detail?: string;
}> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendPost(
    `${API_BASE_URL}/api/v1/admin/suppliers/${supplierId}/approve-deletion${params}`,
    {},
    "Не вдалося підтвердити видалення",
    adminTelegramHeaders()
  );
}

export async function approveSupplierApplication(
  supplierId: number,
  telegramId?: number | null
): Promise<BackendPendingSupplierApplication> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendPost<BackendPendingSupplierApplication>(
    `${API_BASE_URL}/api/v1/admin/suppliers/${supplierId}/approve${params}`,
    {},
    "Не вдалося схвалити заявку",
    adminTelegramHeaders()
  );
}

export async function rejectSupplierApplication(
  supplierId: number,
  telegramId?: number | null
): Promise<BackendPendingSupplierApplication> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendPost<BackendPendingSupplierApplication>(
    `${API_BASE_URL}/api/v1/admin/suppliers/${supplierId}/reject${params}`,
    {},
    "Не вдалося відхилити заявку",
    adminTelegramHeaders()
  );
}

export async function deleteSupplierAccount(
  supplierId: number,
  telegramId?: number | null
): Promise<{ ok: boolean; supplier_id: number; user_reverted?: boolean; detail?: string }> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendDelete(
    `${API_BASE_URL}/api/v1/admin/suppliers/${supplierId}${params}`,
    "Не вдалося видалити постачальника",
    adminTelegramHeaders()
  );
}

export interface BackendDirectCreateSupplierPayload {
  shop_name: string;
  yml_link?: string | null;
  xml_url?: string | null;
  source_type?: "xml" | "telegram" | null;
  telegram_channel_link?: string | null;
  description?: string | null;
  manager_telegram?: string | null;
  channel_link?: string | null;
  telegram_channel_url?: string | null;
  iban?: string | null;
  payment_iban?: string | null;
  bank_name?: string | null;
  payment_bank_name?: string | null;
  payment_card_holder?: string | null;
  legal_name?: string | null;
}

export async function directCreateSupplier(
  payload: BackendDirectCreateSupplierPayload,
  telegramId?: number | null
): Promise<BackendPendingSupplierApplication> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendPost<BackendPendingSupplierApplication>(
    `${ADMIN_DIRECT_CREATE_SUPPLIER_ENDPOINT}${params}`,
    payload,
    "Не вдалося створити магазин",
    adminTelegramHeaders()
  );
}

export interface BackendSupplierTransferResponse {
  message: string;
}

/** POST /api/v1/admin/suppliers/{id}/transfer — передати магазин за @username. */
export async function transferSupplierOwnership(
  supplierId: number,
  newOwnerUsername: string,
  telegramId?: number | null
): Promise<BackendSupplierTransferResponse> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendPost<BackendSupplierTransferResponse>(
    `${API_BASE_URL}/api/v1/admin/suppliers/${supplierId}/transfer${params}`,
    { new_owner_username: newOwnerUsername },
    "Не вдалося передати права",
    adminTelegramHeaders()
  );
}

export interface BackendAICategorizationRule {
  id: number;
  keyword: string;
  correct_category: string;
  created_at?: string | null;
}

export interface BackendAICategorizationRuleCreate {
  keyword: string;
  correct_category: string;
}

/** GET /api/v1/admin/ai-rules — словник правил ШІ-категоризації. */
export async function fetchAdminAiRules(
  telegramId?: number | null
): Promise<BackendAICategorizationRule[]> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendGet<BackendAICategorizationRule[]>(
    `${API_BASE_URL}/api/v1/admin/ai-rules${params}`,
    adminTelegramHeaders()
  );
}

/** POST /api/v1/admin/ai-rules — додати правило keyword → категорія. */
export async function createAdminAiRule(
  payload: BackendAICategorizationRuleCreate,
  telegramId?: number | null
): Promise<BackendAICategorizationRule> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendPost<BackendAICategorizationRule>(
    `${API_BASE_URL}/api/v1/admin/ai-rules${params}`,
    payload,
    "Не вдалося додати правило",
    adminTelegramHeaders()
  );
}

// --- Тікети підтримки (B2B чат менеджера з клієнтами) ------------------------

/** DELETE /api/v1/admin/ai-rules/{id} — видалити правило. */
export async function deleteAdminAiRule(
  ruleId: number,
  telegramId?: number | null
): Promise<{ ok: boolean; rule_id: number }> {
  const params = telegramId ? `?telegram_id=${encodeURIComponent(String(telegramId))}` : "";
  return backendDelete<{ ok: boolean; rule_id: number }>(
    `${API_BASE_URL}/api/v1/admin/ai-rules/${ruleId}${params}`,
    "Не вдалося видалити правило",
    adminTelegramHeaders()
  );
}

export const TICKETS_ENDPOINT = `${API_BASE_URL}/api/v1/tickets`;

/** Тікет підтримки з нашого FastAPI (api_models.TicketResponse). */
export interface BackendTicket {
  id: number;
  order_id?: number;
  customer_id: number;
  supplier_id: number;
  status: string;                 // 'ai_handling' | 'escalated' | 'closed'
  topic: string;                  // 'delivery' | 'refund' | 'question' | 'other'
  ai_summary?: string;           // 🤖 Коротке резюме від AI після закриття
  created_at: string;
  updated_at?: string;
  message_count?: number;
  last_message_at?: string;
  /** Хто з менеджерів узяв тікет у роботу (білінг при закритті іде йому). */
  assigned_manager_id?: number | null;
}

/** Одне повідомлення тікета (api_models.TicketMessageResponse). */
export interface BackendMessage {
  id: number;
  ticket_id: number;
  sender_id?: number | null;
  sender_role: string;            // 'customer' | 'manager' | 'supplier' | 'ai_bot'
  text: string;
  is_read?: boolean;
  media_url?: string;             // Посилання на файл (голосове/кружечок)
  is_transcribed: boolean;        // Чи розшифровано голосове
  created_at: string;
}

/** Заголовок авторизації з initData Telegram Mini App (Bearer). */
function tgAuthHeaders(): Record<string, string> {
  const initData =
    typeof window !== "undefined"
      ? String(
          window.Telegram?.WebApp?.initData ||
            window.__TAVERNA_INIT_DATA__ ||
            sessionStorage.getItem("taverna_tg_init_data") ||
            ""
        )
      : "";
  const headers: Record<string, string> = {};
  if (initData) {
    headers.Authorization = `Bearer ${initData}`;
  }
  return headers;
}

/** GET /api/v1/tickets/me?role=manager|customer — тікети поточного юзера. */
export async function getMyTickets(
  role: "manager" | "customer",
  supplierId?: number
): Promise<BackendTicket[]> {
  const params = new URLSearchParams();
  params.set("role", role);
  // Orders Hub: тікети саме цього магазину (опціональний фільтр)
  if (typeof supplierId === "number" && Number.isFinite(supplierId)) {
    params.set("supplier_id", String(supplierId));
  }
  const data = await backendGet<BackendTicket[] | BackendTicket>(
    `${TICKETS_ENDPOINT}/me?${params.toString()}`,
    tgAuthHeaders()
  );
  if (Array.isArray(data)) return data.filter(Boolean);
  if (data && typeof data === "object" && "id" in data) return [data];
  return [];
}

/** GET /api/v1/tickets/{ticketId}/messages — історія переписки (старіші → новіші). */
export async function getTicketMessages(ticketId: number): Promise<BackendMessage[]> {
  const data = await backendGet<BackendMessage[]>(
    `${TICKETS_ENDPOINT}/${ticketId}/messages`,
    tgAuthHeaders()
  );
  return Array.isArray(data) ? data.filter(Boolean) : [];
}

/** POST /api/v1/tickets/{ticketId}/assign — «взяти тікет в роботу» (Claim Ticket). */
export async function assignTicket(ticketId: number): Promise<BackendTicket> {
  return backendPost<BackendTicket>(
    `${TICKETS_ENDPOINT}/${ticketId}/assign`,
    {},
    "Не вдалося взяти тікет у роботу",
    tgAuthHeaders()
  );
}

/** POST /api/v1/tickets/{ticketId}/messages — написати повідомлення в тікет. */
export async function sendTicketMessage(
  ticketId: number,
  text: string,
  role: string
): Promise<BackendMessage> {
  return backendPost<BackendMessage>(
    `${TICKETS_ENDPOINT}/${ticketId}/messages`,
    { text, sender_role: role },
    "Не вдалося надіслати повідомлення",
    tgAuthHeaders()
  );
}

/** PATCH /api/v1/tickets/{ticketId}/close — закрити тікет (менеджер/власник). */
export async function closeTicket(ticketId: number): Promise<BackendTicket> {
  return backendPatch<BackendTicket>(
    `${TICKETS_ENDPOINT}/${ticketId}/close`,
    {},
    "Не вдалося закрити тікет",
    tgAuthHeaders()
  );
}

// --- Контекстний AI-чат підтримки (B2C): Категорії → AI → Тікет ----------------

/** Категорії флоу «Підтримка» (екран 1). */
export type SupportCategory = "supplier" | "tech" | "complaint" | "rating";

/** Одне повідомлення історії AI-чату підтримки. */
export interface SupportAiMessage {
  role: "user" | "assistant";
  content: string;
}

/** POST /api/v1/support/ai/chat — відповідь контекстного AI. */
export interface SupportAiChatResult {
  reply: string;
  escalate: boolean;
  ticket_topic?: string | null;
  ticket_text?: string | null;
}

/**
 * POST /api/v1/support/ai/chat
 * Приймає категорію + історію повідомлень, повертає відповідь AI,
 * прапорець ескалації до живої людини та зібраний текст тікета.
 * Системний промт живе на бекенді і залежить від категорії.
 */
export async function supportAiChat(
  category: SupportCategory,
  messages: SupportAiMessage[],
  context?: { supplier_id?: number; order_id?: number }
): Promise<SupportAiChatResult> {
  return backendPost<SupportAiChatResult>(
    `${API_BASE_URL}/api/v1/support/ai/chat`,
    {
      category,
      messages,
      supplier_id: context?.supplier_id ?? null,
      order_id: context?.order_id ?? null,
    },
    "AI-асистент недоступний",
    tgAuthHeaders()
  );
}

/** Тема тікета для POST /api/v1/tickets/ (topic). */
export type CreateTicketTopic = "delivery" | "refund" | "question" | "other" | "complaint";

/**
 * POST /api/v1/tickets/ — клієнт створює тікет (ескалація до людини).
 * Перше повідомлення створюється бекендом з payload.text.
 * topic='complaint' + supplier_id службового магазину — скарги на персонал.
 */
export async function createBackendTicket(
  payload: {
    supplier_id: number;
    order_id?: number | null;
    topic: CreateTicketTopic;
    text: string;
  }
): Promise<BackendTicket> {
  return backendPost<BackendTicket>(
    `${TICKETS_ENDPOINT}/`,
    payload,
    "Не вдалося створити звернення",
    tgAuthHeaders()
  );
}

/**
 * GET /api/v1/support/ai/support-shop — ID службового магазину платформи
 * «Taverna Support». До нього прив'язуємо тікети тех. підтримки та скарг
 * на модератора/адміна (supplier_id NOT NULL у тікетах).
 */
export async function resolveSupportShopId(): Promise<number | null> {
  try {
    const data = await backendGet<{ supplier_id?: number }>(
      `${API_BASE_URL}/api/v1/support/ai/support-shop`
    );
    const id = Number(data?.supplier_id);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
