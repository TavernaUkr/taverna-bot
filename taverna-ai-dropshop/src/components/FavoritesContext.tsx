import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTelegramAuthContext } from './TelegramAuthProvider';

interface FavoriteItem {
  id: string;
  productId: string;
  name: string;
  price: number;
  image: string;
  addedAt: Date;
}

interface FavoritesContextType {
  favorites: FavoriteItem[];
  totalFavorites: number;
  isLoading: boolean;
  isFavorite: (productId: string) => boolean;
  addFavorite: (productId: string, name: string, price: number, image: string) => Promise<boolean>;
  removeFavorite: (productId: string) => Promise<boolean>;
  toggleFavorite: (productId: string, name: string, price: number, image: string) => Promise<boolean>;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

const STORAGE_KEY = 'taverna_favorites';

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, sessionToken, profile } = useTelegramAuthContext();
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load favorites from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setFavorites(parsed.map((f: any) => ({
          ...f,
          addedAt: new Date(f.addedAt),
        })));
      } catch (e) {
        console.error('Failed to parse favorites:', e);
      }
    }
    setIsLoading(false);
  }, []);

  // Save to localStorage whenever favorites change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  }, [favorites]);

  const isFavorite = useCallback((productId: string) => {
    return favorites.some(f => f.productId === productId);
  }, [favorites]);

  const addFavorite = useCallback(async (
    productId: string, 
    name: string, 
    price: number, 
    image: string
  ): Promise<boolean> => {
    if (isFavorite(productId)) return false;

    const newItem: FavoriteItem = {
      id: `${productId}-${Date.now()}`,
      productId,
      name,
      price,
      image,
      addedAt: new Date(),
    };

    setFavorites(prev => [newItem, ...prev]);
    return true;
  }, [isFavorite]);

  const removeFavorite = useCallback(async (productId: string): Promise<boolean> => {
    setFavorites(prev => prev.filter(f => f.productId !== productId));
    return true;
  }, []);

  const toggleFavorite = useCallback(async (
    productId: string, 
    name: string, 
    price: number, 
    image: string
  ): Promise<boolean> => {
    if (isFavorite(productId)) {
      return removeFavorite(productId);
    } else {
      return addFavorite(productId, name, price, image);
    }
  }, [isFavorite, addFavorite, removeFavorite]);

  return (
    <FavoritesContext.Provider
      value={{
        favorites,
        totalFavorites: favorites.length,
        isLoading,
        isFavorite,
        addFavorite,
        removeFavorite,
        toggleFavorite,
      }}
    >
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavoritesContext() {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error('useFavoritesContext must be used within a FavoritesProvider');
  }
  return context;
}
