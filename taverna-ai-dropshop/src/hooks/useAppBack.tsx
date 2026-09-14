import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

type BackHandler = () => boolean;

interface AppBackContextValue {
  register: (handler: BackHandler) => () => void;
  goBack: () => void;
}

const AppBackContext = createContext<AppBackContextValue | null>(null);

/** Головні вкладки: системна «Назад» має закривати Mini App, а не йти по історії. */
function isRootTab(pathname: string, search: string) {
  if (pathname === "/suppliers" || pathname === "/support") return true;
  if (pathname !== "/") return false;
  const tab = new URLSearchParams(search).get("tab");
  return !tab || tab === "catalog" || tab === "live" || tab === "account";
}

function telegramWebApp() {
  return (window as any).Telegram?.WebApp as
    | {
        BackButton?: {
          show: () => void;
          hide: () => void;
          onClick: (fn: () => void) => void;
          offClick: (fn: () => void) => void;
        };
        onEvent?: (event: string, fn: () => void) => void;
        offEvent?: (event: string, fn: () => void) => void;
      }
    | undefined;
}

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
    if (isRootTab(location.pathname, location.search)) return;
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/");
  }, [location.pathname, location.search, navigate]);

  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;

  const register = useCallback((handler: BackHandler) => {
    const id = nextId.current++;
    stackRef.current = [...stackRef.current, { id, handler }];
    setOverlayCount(stackRef.current.length);
    return () => {
      stackRef.current = stackRef.current.filter((item) => item.id !== id);
      setOverlayCount(stackRef.current.length);
    };
  }, []);

  useEffect(() => {
    const tg = telegramWebApp();
    const backButton = tg?.BackButton;
    const onBack = () => goBackRef.current();
    const showButton = overlayCount > 0 || !isRootTab(location.pathname, location.search);

    if (backButton) {
      if (showButton) backButton.show();
      else backButton.hide();
      backButton.onClick(onBack);
    }
    tg?.onEvent?.("backButtonClicked", onBack);

    return () => {
      backButton?.offClick(onBack);
      tg?.offEvent?.("backButtonClicked", onBack);
    };
  }, [location.pathname, location.search, overlayCount]);

  return (
    <AppBackContext.Provider value={{ register, goBack }}>
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
