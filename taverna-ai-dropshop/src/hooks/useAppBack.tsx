import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

type BackHandler = () => boolean;

interface AppBackContextValue {
  register: (handler: BackHandler) => () => void;
  goBack: () => void;
  hasOverlay: boolean;
}

const AppBackContext = createContext<AppBackContextValue | null>(null);

/** Головна `/`: системна «Назад» закриває Mini App. Інші екрани — історія. */

export function AppBackProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [overlayCount, setOverlayCount] = useState(0);
  const stackRef = useRef<{ id: number; handler: BackHandler }[]>([]);
  const nextId = useRef(1);

  const goBack = useCallback(() => {
    const stack = stackRef.current;
    if (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.handler()) return;
    }
    if (location.pathname === "/") return;
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/");
  }, [location.pathname, navigate]);

  const register = useCallback((handler: BackHandler) => {
    const id = nextId.current++;
    stackRef.current = [...stackRef.current, { id, handler }];
    setOverlayCount(stackRef.current.length);
    return () => {
      stackRef.current = stackRef.current.filter((item) => item.id !== id);
      setOverlayCount(stackRef.current.length);
    };
  }, []);

  const value = useMemo(
    () => ({ register, goBack, hasOverlay: overlayCount > 0 }),
    [register, goBack, overlayCount],
  );

  return (
    <AppBackContext.Provider value={value}>
      {children}
    </AppBackContext.Provider>
  );
}

export function useAppBack() {
  const ctx = useContext(AppBackContext);
  if (!ctx) {
    throw new Error("useAppBack must be used within AppBackProvider");
  }
  return ctx;
}

export function useAppBackOptional() {
  return useContext(AppBackContext);
}

/** Коли `enabled` — системна «Назад» (Samsung / Telegram) закриває цей шар. */
export function useRegisterBack(enabled: boolean, handler: () => void) {
  const ctx = useContext(AppBackContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled || !ctx) return;
    return ctx.register(() => {
      handlerRef.current();
      return true;
    });
  }, [enabled, ctx]);
}
