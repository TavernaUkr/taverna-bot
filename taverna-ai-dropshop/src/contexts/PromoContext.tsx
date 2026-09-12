import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface ActivePromo {
  code: string;
  discountPercent?: number;
  discountAmount?: number;
  minOrderAmount?: number;
}

interface PromoContextType {
  activePromo: ActivePromo | null;
  setActivePromo: (promo: ActivePromo | null) => void;
  clearPromo: () => void;
  applyPromoFromStorage: () => void;
}

const PromoContext = createContext<PromoContextType | undefined>(undefined);

const PROMO_STORAGE_KEY = "taverna_active_promo";

export function PromoProvider({ children }: { children: ReactNode }) {
  const [activePromo, setActivePromoState] = useState<ActivePromo | null>(null);

  // Load promo from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(PROMO_STORAGE_KEY);
    if (stored) {
      try {
        const promo = JSON.parse(stored);
        setActivePromoState(promo);
      } catch {
        localStorage.removeItem(PROMO_STORAGE_KEY);
      }
    }
  }, []);

  const setActivePromo = (promo: ActivePromo | null) => {
    setActivePromoState(promo);
    if (promo) {
      localStorage.setItem(PROMO_STORAGE_KEY, JSON.stringify(promo));
    } else {
      localStorage.removeItem(PROMO_STORAGE_KEY);
    }
  };

  const clearPromo = () => {
    setActivePromoState(null);
    localStorage.removeItem(PROMO_STORAGE_KEY);
  };

  const applyPromoFromStorage = () => {
    const stored = localStorage.getItem(PROMO_STORAGE_KEY);
    if (stored) {
      try {
        const promo = JSON.parse(stored);
        setActivePromoState(promo);
      } catch {
        // ignore
      }
    }
  };

  return (
    <PromoContext.Provider value={{ activePromo, setActivePromo, clearPromo, applyPromoFromStorage }}>
      {children}
    </PromoContext.Provider>
  );
}

export function usePromoContext() {
  const context = useContext(PromoContext);
  if (context === undefined) {
    throw new Error("usePromoContext must be used within a PromoProvider");
  }
  return context;
}
