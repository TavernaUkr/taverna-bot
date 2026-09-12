import { useState, useEffect, useCallback } from 'react';

export interface CartItem {
  id: string;
  productId: string;
  /**
   * ID конкретного варіанту товару (розмір/колір) з нашого FastAPI-бекенду
   * (`product_variants.id`). Потрібен для чекауту (`POST /api/v1/orders/`),
   * щоб бекенд знав ЯКИЙ саме варіант замовили і взяв з БД правильну ціну.
   * Може бути відсутнім, якщо у товару немає варіантів.
   */
  variantId?: string;
  name: string;
  price: number;
  image: string;
  size?: string;
  color?: string;
  quantity: number;
  supplierId?: string;
  supplierName?: string;
}

// [АРХІТЕКТУРНЕ РІШЕННЯ] Кошик товарів з нашого FastAPI-каталогу (integer id)
// НЕ можна тримати в Supabase (там products/cart_items — окрема таблиця з
// uuid-ідентифікаторами): product_id з FastAPI ("5") не існує в Supabase,
// тож cart_add там просто впаде. Тому кошик відтепер завжди локальний
// (React state + localStorage, щоб не губився між переходами/перезавантаженням
// Mini App). Це узгоджено з Кроком 4 (чекаут іде напряму в FastAPI, а не
// в Supabase), тож серверна синхронізація кошика через Supabase більше не
// потрібна.
const CART_STORAGE_KEY = 'taverna_cart_v2';

function loadCartFromStorage(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCartToStorage(items: CartItem[]): void {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage вимкнено/переповнено — кошик просто не переживе перезавантаження
  }
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>(() => loadCartFromStorage());
  const [isLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Зберігаємо кошик у localStorage при КОЖНІЙ зміні.
  useEffect(() => {
    saveCartToStorage(items);
  }, [items]);

  /**
   * Додає товар у кошик.
   *
   * @param quantity  скільки штук додати (за замовчуванням 1)
   * @param variantId ID конкретного варіанту (розмір/колір) з бекенду
   */
  const addItem = useCallback(async (
    productId: string,
    name: string,
    price: number,
    image: string,
    size?: string,
    color?: string,
    quantity: number = 1,
    variantId?: string
  ): Promise<boolean> => {
    setError(null);

    setItems(prev => {
      // Той самий товар + той самий варіант (розмір/колір) -> просто збільшуємо кількість
      const existingIndex = prev.findIndex(
        item =>
          item.productId === productId &&
          item.variantId === variantId &&
          item.size === size &&
          item.color === color
      );

      if (existingIndex > -1) {
        return prev.map((item, idx) =>
          idx === existingIndex ? { ...item, quantity: item.quantity + quantity } : item
        );
      }

      return [
        ...prev,
        {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          productId,
          variantId,
          name,
          price,
          image,
          size,
          color,
          quantity,
        },
      ];
    });

    return true;
  }, []);

  const updateQuantity = useCallback(async (cartItemId: string, quantity: number): Promise<boolean> => {
    if (quantity < 1) return false;
    setItems(prev => prev.map(item => (item.id === cartItemId ? { ...item, quantity } : item)));
    return true;
  }, []);

  const removeItem = useCallback(async (cartItemId: string): Promise<boolean> => {
    setItems(prev => prev.filter(item => item.id !== cartItemId));
    return true;
  }, []);

  const clearCart = useCallback(async (): Promise<boolean> => {
    setItems([]);
    return true;
  }, []);

  // Кошик локальний -> нема звідки "підвантажувати". Лишаємо як no-op,
  // щоб не ламати існуючі виклики `await fetchCart()` в Index.tsx і т.д.
  const fetchCart = useCallback(async (): Promise<void> => {
    setError(null);
  }, []);

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return {
    items,
    isLoading,
    error,
    totalItems,
    totalPrice,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    fetchCart,
  };
}
