import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTelegramAuthContext } from '@/components/TelegramAuthProvider';

export interface CartItem {
  id: string;
  productId: string;
  name: string;
  price: number;
  image: string;
  size?: string;
  color?: string;
  quantity: number;
  supplierId?: string;
  supplierName?: string;
}

interface CartItemDB {
  id: string;
  product_id: string;
  profile_id: string;
  quantity: number;
  size: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
  product: {
    id: string;
    name: string;
    price: number;
    images: string[] | null;
    sizes: string[] | null;
    colors: string[] | null;
    supplier_id: string | null;
    supplier: {
      id: string;
      shop_name: string;
    } | null;
  } | null;
}

// Utility: get session token stored by useTelegramAuth
function getSessionToken(): string | null {
  try { return localStorage.getItem('taverna_session_token'); } catch { return null; }
}

// Map DB cart item to frontend format
const mapCartItem = (dbItem: CartItemDB): CartItem | null => {
  if (!dbItem.product) return null;
  return {
    id: dbItem.id,
    productId: dbItem.product_id,
    name: dbItem.product.name,
    price: dbItem.product.price,
    image: dbItem.product.images?.[0] || '/placeholder.svg',
    size: dbItem.size || undefined,
    color: dbItem.color || undefined,
    quantity: dbItem.quantity,
    supplierId: dbItem.product.supplier_id || undefined,
    supplierName: dbItem.product.supplier?.shop_name || undefined,
  };
};

async function invokeCart(action: string, extra: Record<string, unknown> = {}) {
  const session_token = getSessionToken();
  if (!session_token) return { error: 'No session' } as const;
  const { data, error } = await supabase.functions.invoke('telegram-auth', {
    body: { action, session_token, ...extra },
  });
  if (error) return { error: error.message } as const;
  return { data } as const;
}

export function useCart() {
  const { isAuthenticated, profile } = useTelegramAuthContext();
  const [items, setItems] = useState<CartItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDbAuthenticated = isAuthenticated && !!profile?.id && !!getSessionToken();

  const fetchCart = useCallback(async () => {
    if (!isDbAuthenticated) {
      setItems([]);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const res = await invokeCart('cart_get');
      if ('error' in res) throw new Error(res.error);
      const mapped = (res.data?.items as CartItemDB[] | undefined)
        ?.map(mapCartItem)
        .filter((i): i is CartItem => i !== null) || [];
      setItems(mapped);
    } catch (err) {
      console.error('Error fetching cart:', err);
      setError('Помилка завантаження кошика');
    } finally {
      setIsLoading(false);
    }
  }, [isDbAuthenticated]);

  const addItem = useCallback(async (
    productId: string,
    name: string,
    price: number,
    image: string,
    size?: string,
    color?: string
  ) => {
    if (!isDbAuthenticated) {
      // Local (guest) cart
      const existingIndex = items.findIndex(
        item => item.productId === productId && item.size === size && item.color === color
      );
      if (existingIndex > -1) {
        setItems(prev => prev.map((item, idx) =>
          idx === existingIndex ? { ...item, quantity: item.quantity + 1 } : item
        ));
      } else {
        setItems(prev => [...prev, {
          id: `local-${Date.now()}`, productId, name, price, image, size, color, quantity: 1,
        }]);
      }
      return true;
    }

    try {
      setError(null);
      const res = await invokeCart('cart_add', { product_id: productId, size, color });
      if ('error' in res) throw new Error(res.error);
      await fetchCart();
      return true;
    } catch (err) {
      console.error('Error adding to cart:', err);
      setError('Помилка додавання до кошика');
      return false;
    }
  }, [isDbAuthenticated, items, fetchCart]);

  const updateQuantity = useCallback(async (cartItemId: string, quantity: number) => {
    if (quantity < 1) return false;
    if (cartItemId.startsWith('local-')) {
      setItems(prev => prev.map(item => item.id === cartItemId ? { ...item, quantity } : item));
      return true;
    }
    if (!isDbAuthenticated) return false;
    try {
      setError(null);
      const res = await invokeCart('cart_update', { cart_item_id: cartItemId, quantity });
      if ('error' in res) throw new Error(res.error);
      setItems(prev => prev.map(item => item.id === cartItemId ? { ...item, quantity } : item));
      return true;
    } catch (err) {
      console.error('Error updating quantity:', err);
      setError('Помилка оновлення кількості');
      return false;
    }
  }, [isDbAuthenticated]);

  const removeItem = useCallback(async (cartItemId: string) => {
    if (cartItemId.startsWith('local-')) {
      setItems(prev => prev.filter(item => item.id !== cartItemId));
      return true;
    }
    if (!isDbAuthenticated) return false;
    try {
      setError(null);
      const res = await invokeCart('cart_remove', { cart_item_id: cartItemId });
      if ('error' in res) throw new Error(res.error);
      setItems(prev => prev.filter(item => item.id !== cartItemId));
      return true;
    } catch (err) {
      console.error('Error removing from cart:', err);
      setError('Помилка видалення з кошика');
      return false;
    }
  }, [isDbAuthenticated]);

  const clearCart = useCallback(async () => {
    if (!isDbAuthenticated) {
      setItems([]);
      return true;
    }
    try {
      setError(null);
      const res = await invokeCart('cart_clear');
      if ('error' in res) throw new Error(res.error);
      setItems([]);
      return true;
    } catch (err) {
      console.error('Error clearing cart:', err);
      setError('Помилка очищення кошика');
      return false;
    }
  }, [isDbAuthenticated]);

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  useEffect(() => {
    if (isDbAuthenticated) fetchCart();
  }, [isDbAuthenticated, fetchCart]);

  // Sync local cart into DB after user authenticates
  useEffect(() => {
    const syncLocalCart = async () => {
      if (!isDbAuthenticated) return;
      const localItems = items.filter(item => item.id.startsWith('local-'));
      if (localItems.length === 0) return;
      for (const item of localItems) {
        await invokeCart('cart_add', { product_id: item.productId, size: item.size, color: item.color });
      }
      await fetchCart();
    };
    syncLocalCart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDbAuthenticated]);

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
