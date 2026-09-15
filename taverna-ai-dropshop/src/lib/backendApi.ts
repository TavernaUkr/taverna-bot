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
  attributes?: Record<string, string> | null;
  supplier_name?: string | null;
  options: BackendProductOption[];
  variants: BackendProductVariant[];
  share_url: string;
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

export interface BackendProductFilters {
  target_niche: string[];
  season: string[];
  gender: string[];
  attributes: BackendFilterAttribute[];
  sub_categories?: BackendCategorySub[];
  total?: number;
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
      headers: { Accept: "application/json", ...extraHeaders },
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

type QueryValue = string | string[] | undefined;

function appendQueryValues(params: URLSearchParams, key: string, value: QueryValue) {
  if (!value) return;
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    const trimmed = String(item).trim();
    if (trimmed) params.append(key, trimmed);
  }
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

/** Отримати всі товари з нашого FastAPI-бекенду. */
export async function fetchBackendProducts(filters?: {
  category?: QueryValue;
  main_category?: QueryValue;
  sub_category?: QueryValue;
  season?: QueryValue;
  target_niche?: QueryValue;
  niche?: QueryValue;
  gender?: QueryValue;
}): Promise<BackendProduct[]> {
  const params = new URLSearchParams();
  appendQueryValues(params, "category", filters?.category ?? filters?.main_category);
  appendQueryValues(params, "sub_category", filters?.sub_category);
  appendQueryValues(params, "season", filters?.season);
  appendQueryValues(params, "target_niche", filters?.target_niche ?? filters?.niche);
  appendQueryValues(params, "gender", filters?.gender);
  const qs = params.toString();
  return backendGet<BackendProduct[]>(qs ? `${PRODUCTS_ENDPOINT}?${qs}` : PRODUCTS_ENDPOINT);
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
 * Пошук товарів через FastAPI-бекенд.
 *
 * Бекенд (GET /api/v1/products/) поки не приймає query-параметри пошуку,
 * тож фільтруємо на фронтенді по всьому каталогу — так само, як це робить
 * `useProducts().searchProducts`. Якщо бекенд згодом отримає власний
 * пошуковий ендпоінт (`?search=`), достатньо буде оновити тільки цю функцію.
 */
export async function searchBackendProducts(query: string): Promise<BackendProduct[]> {
  const all = await fetchBackendProducts();
  const q = query.trim().toLowerCase();
  if (!q) return all;

  return all.filter((p) => {
    const haystack = [
      p.name,
      p.description ?? "",
      p.sku,
      p.category ?? "",
      p.sub_category ?? "",
      p.season ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
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

export const SUPPLIERS_IMPORT_PROGRESS_ENDPOINT = `${API_BASE_URL}/api/v1/suppliers/me/import-progress`;
export const ADMIN_PENDING_SUPPLIERS_ENDPOINT = `${API_BASE_URL}/api/v1/admin/suppliers/pending`;
export const ADMIN_DIRECT_CREATE_SUPPLIER_ENDPOINT = `${API_BASE_URL}/api/v1/admin/suppliers/direct-create`;

export interface BackendSupplierImportProgress {
  total: number;
  completed: number;
  estimated_minutes: number;
  is_importing: boolean;
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
  channel_link?: string | null;
  manager_telegram?: string | null;
  iban?: string | null;
  bank_name?: string | null;
  status: string;
  is_verified: boolean;
  telegram_id?: number | null;
  ai_score_report?: string | null;
  trial_ends_at?: string | null;
  created_at?: string | null;
  import_started?: boolean;
}

function adminTelegramHeaders(): Record<string, string> {
  const initData =
    typeof window !== "undefined"
      ? String((window as any).Telegram?.WebApp?.initData || "")
      : "";
  const headers: Record<string, string> = {};
  if (initData) {
    headers.Authorization = `Bearer ${initData}`;
  }
  return headers;
}

/** GET /api/v1/suppliers/me/import-progress — прогрес AI-категоризації товарів. */
export async function fetchSupplierImportProgress(): Promise<BackendSupplierImportProgress> {
  return backendGet<BackendSupplierImportProgress>(
    SUPPLIERS_IMPORT_PROGRESS_ENDPOINT,
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
