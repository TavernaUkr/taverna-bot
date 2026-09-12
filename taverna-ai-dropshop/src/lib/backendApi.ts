/**
 * backendApi.ts
 *
 * HTTP-клієнт для нашого власного FastAPI-бекенду (web_app.py + api/products.py).
 * Використовується замість прямих запитів до Supabase для каталогу товарів.
 *
 * Бекенд піднімається локально командою:
 *   uvicorn web_app:app --reload --port 8000
 * і має бути доступний за адресою http://localhost:8000.
 *
 * Якщо потрібно вказати іншу адресу (стейджинг/прод), додай у
 * taverna-ai-dropshop/.env:
 *   VITE_API_BASE_URL=https://your-backend-domain
 */

// --- Базова адреса бекенду -------------------------------------------------
const RAW_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || "http://localhost:8000";

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
  options: BackendProductOption[];
  variants: BackendProductVariant[];
  share_url: string;
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

/**
 * GET-запит до FastAPI бекенду з людяною обробкою помилок.
 * Розрізняє мережеву помилку/CORS (TypeError від fetch) та HTTP-помилку (4xx/5xx).
 */
async function backendGet<T>(url: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (networkError) {
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

/** Отримати всі товари з нашого FastAPI-бекенду. */
export async function fetchBackendProducts(): Promise<BackendProduct[]> {
  return backendGet<BackendProduct[]>(PRODUCTS_ENDPOINT);
}
