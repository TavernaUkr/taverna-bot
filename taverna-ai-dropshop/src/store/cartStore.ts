import { create } from "zustand";
import { persist } from "zustand/middleware";

// --- Типи --------------------------------------------------------------------

/**
 * Мінімальний «картковий» товар для кошика. В проєкті кілька локальних типів
 * Product (useProducts, ProductDetail, SearchResults), які структурно
 * несумісні між собою (optional/required поля). Кошику достатньо цих полів —
 * будь-який з тих типів структурно підходить сюди, а решта полів (якщо є)
 * збережуться як дані при додаванні.
 */
export interface CartProduct {
  id: string;
  name: string;
  /** Ціле число У ГРИВНАХ (не в копійках!) — як у всьому каталозі. */
  price: number;
  images?: string[];
}

/**
 * Один рядок кошика.
 *
 * `product`      — повний товар (ціна — `product.price`, у грн).
 * `quantity`     — скільки одиниць цього товару покладено.
 * `selectedOptions` — обрані опції товару (напр. { "Розмір": "42", "Колір": "Мультикам" }),
 *                     якщо товар має варіанти. Товар з одним id, але різними
 *                     опціями — це РІЗНІ рядки кошика.
 */
export interface CartItem {
  product: CartProduct;
  quantity: number;
  selectedOptions?: Record<string, string>;
  /**
   * ID конкретного варіанту (розмір+колір) з бекенда (`product_variants.id`).
   * НЕОБХІДНИЙ для чекауту: POST /api/v1/orders/ приймає variant_id,
   * без нього бекенд не знає, який саме варіант замовили.
   */
  variantId?: string;
}

interface CartState {
  items: CartItem[];

  addItem: (
    product: CartProduct,
    quantity?: number,
    options?: Record<string, string>,
    variantId?: string
  ) => void;
  removeItem: (
    productId: string,
    options?: Record<string, string>,
    variantId?: string
  ) => void;
  updateQuantity: (
    productId: string,
    quantity: number,
    options?: Record<string, string>,
    variantId?: string
  ) => void;
  clearCart: () => void;

  getTotalPrice: () => number;
  getTotalItems: () => number;
}

// --- Хелпери для порівняння опцій --------------------------------------------

/** Приводить опції до стабільного вигляду: без порожніх значень, усе — рядки. */
function normalizeOptions(options?: Record<string, string>): Record<string, string> {
  if (!options) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(options)) {
    const strValue = value === null || value === undefined ? "" : `${value}`.trim();
    if (strValue === "") continue;
    result[key] = strValue;
  }
  return result;
}

/**
 * Канонічний «ключ» набору опцій (ключі відсортовані) — щоб
 * { Розмір: "42", Колір: "Олива" } і { Колір: "Олива", Розмір: "42" }
 * вважались однаковими опціями.
 */
function optionsKey(options?: Record<string, string>): string {
  const normalized = normalizeOptions(options);
  return Object.keys(normalized)
    .sort()
    .map((key) => `${key}:${normalized[key]}`)
    .join("|");
}

/**
 * Унікальний ключ рядка кошика: id товару + обрані опції + варіант.
 * Зручний і для пошуку в масиві, і як стабільный `key` для React-списків.
 */
export function cartItemKey(
  productId: string,
  options?: Record<string, string>,
  variantId?: string
): string {
  return `${productId}__${optionsKey(options)}__${variantId ?? ""}`;
}

// --- Стор --------------------------------------------------------------------

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      // 1) Додати товар. Той самий товар (id + опції + варіант) —
      //    збільшуємо quantity. Інакше — новий рядок кошика.
      addItem: (product, quantity = 1, options, variantId) => {
        if (!product || !Number.isFinite(quantity) || quantity <= 0) return;

        const targetKey = cartItemKey(product.id, options, variantId);
        set((state) => {
          const index = state.items.findIndex(
            (item) =>
              cartItemKey(item.product.id, item.selectedOptions, item.variantId) === targetKey
          );
          if (index > -1) {
            const items = [...state.items];
            items[index] = {
              ...items[index],
              quantity: items[index].quantity + quantity,
            };
            return { items };
          }

          const selectedOptions = normalizeOptions(options);
          const newItem: CartItem = {
            product,
            quantity,
            ...(Object.keys(selectedOptions).length > 0 ? { selectedOptions } : {}),
            ...(variantId ? { variantId } : {}),
          };
          return { items: [...state.items, newItem] };
        });
      },

      // 2) Видалити конкретний товар (id + опції + варіант) з кошика.
      removeItem: (productId, options, variantId) => {
        const targetKey = cartItemKey(productId, options, variantId);
        set((state) => ({
          items: state.items.filter(
            (item) =>
              cartItemKey(item.product.id, item.selectedOptions, item.variantId) !== targetKey
          ),
        }));
      },

      // 3) Оновити кількість. quantity <= 0 → рядок видаляється.
      updateQuantity: (productId, quantity, options, variantId) => {
        if (!Number.isFinite(quantity) || quantity <= 0) {
          get().removeItem(productId, options, variantId);
          return;
        }
        const targetKey = cartItemKey(productId, options, variantId);
        set((state) => ({
          items: state.items.map((item) =>
            cartItemKey(item.product.id, item.selectedOptions, item.variantId) === targetKey
              ? { ...item, quantity }
              : item
          ),
        }));
      },

      // 4) Повністю очистити кошик.
      clearCart: () => set({ items: [] }),

      // Сума кошика: product.price * quantity по всіх рядках.
      // УВАГА: price у цьому проєкті — ЦІЛЕ ЧИСЛО У ГРИВНЯХ (не в копійках),
      // тому тут НЕ ділимо на 100. Форматування (₴) — справа UI.
      getTotalPrice: () =>
        get().items.reduce(
          (sum, item) => sum + item.product.price * item.quantity,
          0
        ),

      // Загальна кількість одиниць товару в кошику.
      getTotalItems: () =>
        get().items.reduce((sum, item) => sum + item.quantity, 0),
    }),
    {
      name: "taverna-cart-storage", // ключ у localStorage
      version: 2,
      // У localStorage зберігаємо лише дані (функції/екшени не серіалізуємо).
      partialize: (state) => ({ items: state.items }),
    }
  )
);
