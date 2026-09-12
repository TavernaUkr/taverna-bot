import { createContext, useContext, ReactNode } from 'react';
import { useCart, CartItem } from '@/hooks/useCart';

interface CartContextType {
  items: CartItem[];
  isLoading: boolean;
  error: string | null;
  totalItems: number;
  totalPrice: number;
  addItem: (
    productId: string,
    name: string,
    price: number,
    image: string,
    size?: string,
    color?: string
  ) => Promise<boolean>;
  updateQuantity: (cartItemId: string, quantity: number) => Promise<boolean>;
  removeItem: (cartItemId: string) => Promise<boolean>;
  clearCart: () => Promise<boolean>;
  fetchCart: () => Promise<void>;
}

const CartContext = createContext<CartContextType | null>(null);

export function useCartContext() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCartContext must be used within CartProvider');
  }
  return context;
}

interface CartProviderProps {
  children: ReactNode;
}

export function CartProvider({ children }: CartProviderProps) {
  const cart = useCart();

  return (
    <CartContext.Provider value={cart}>
      {children}
    </CartContext.Provider>
  );
}
