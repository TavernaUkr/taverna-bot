import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppBackOptional } from "@/hooks/useAppBack";

export type VibrateStyle = "light" | "medium" | "heavy" | "success" | "error";
export type AppTheme = "auto" | "dark" | "light";
export const APP_THEME_STORAGE_KEY = "app-theme";

export type MainButtonParams = {
  text?: string;
  color?: string;
  text_color?: string;
  is_active?: boolean;
  is_visible?: boolean;
};

type TelegramBackButton = {
  show: () => void;
  hide: () => void;
  onClick: (fn: () => void) => void;
  offClick: (fn: () => void) => void;
};

type TelegramMainButton = {
  show: () => void;
  hide: () => void;
  setText?: (text: string) => void;
  setParams?: (params: MainButtonParams) => void;
  onClick?: (fn: () => void) => void;
  offClick?: (fn: () => void) => void;
  enable?: () => void;
  disable?: () => void;
};

type TelegramWebApp = {
  BackButton?: TelegramBackButton;
  MainButton?: TelegramMainButton;
  HapticFeedback?: {
    impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred?: (style: "error" | "success" | "warning") => void;
    selectionChanged?: () => void;
  };
  colorScheme?: "light" | "dark";
  ready?: () => void;
  expand?: () => void;
  enableClosingConfirmation?: () => void;
  setHeaderColor?: (color: "bg_color" | "secondary_bg_color" | string) => void;
  setBackgroundColor?: (color: "bg_color" | "secondary_bg_color" | string) => void;
  onEvent?: (event: string, fn: () => void) => void;
  offEvent?: (event: string, fn: () => void) => void;
};

type TelegramUIContextValue = {
  webApp: TelegramWebApp | undefined;
  isHapticEnabled: boolean;
  setHapticEnabled: (enabled: boolean) => void;
  appTheme: AppTheme;
  setAppTheme: (theme: AppTheme) => void;
  vibrate: (style?: VibrateStyle) => void;
  showMainButton: typeof showMainButton;
  hideMainButton: typeof hideMainButton;
  setMainButtonParams: typeof setMainButtonParams;
};

const TelegramUIContext = createContext<TelegramUIContextValue | null>(null);

let mainButtonClickHandler: (() => void) | null = null;
let hapticEnabledFlag = true;
const hapticEnabledListeners = new Set<(enabled: boolean) => void>();
const appThemeListeners = new Set<(theme: AppTheme) => void>();

export function getTelegramWebApp(): TelegramWebApp | undefined {
  try {
    return (window as any).Telegram?.WebApp as TelegramWebApp | undefined;
  } catch {
    return undefined;
  }
}

export function isHapticEnabledNow() {
  return hapticEnabledFlag;
}

export function setHapticEnabled(enabled: boolean) {
  hapticEnabledFlag = enabled;
  hapticEnabledListeners.forEach((listener) => listener(enabled));
}

/** Тактильний відгук Telegram. У звичайному браузері тихо нічого не робить. */
export function vibrate(style: VibrateStyle = "light") {
  try {
    if (!hapticEnabledFlag) return;
    const haptic = getTelegramWebApp()?.HapticFeedback;
    if (!haptic) return;
    if (style === "success" || style === "error") {
      haptic.notificationOccurred?.(style);
      return;
    }
    haptic.impactOccurred?.(style);
  } catch {
    // поза Telegram Mini App
  }
}

export function setMainButtonParams(params: MainButtonParams) {
  const btn = getTelegramWebApp()?.MainButton;
  if (!btn) return;
  if (btn.setParams) {
    btn.setParams(params);
    return;
  }
  if (params.text) btn.setText?.(params.text);
  if (params.is_visible === true) btn.show();
  if (params.is_visible === false) btn.hide();
  if (params.is_active === true) btn.enable?.();
  if (params.is_active === false) btn.disable?.();
}

export function showMainButton(text?: string, onClick?: () => void) {
  const btn = getTelegramWebApp()?.MainButton;
  if (!btn) return;
  if (text) {
    setMainButtonParams({ text, is_visible: true });
  } else {
    btn.show();
  }
  if (onClick) {
    if (mainButtonClickHandler) btn.offClick?.(mainButtonClickHandler);
    mainButtonClickHandler = onClick;
    btn.onClick?.(onClick);
  }
}

export function hideMainButton() {
  const btn = getTelegramWebApp()?.MainButton;
  if (!btn) return;
  if (mainButtonClickHandler) {
    btn.offClick?.(mainButtonClickHandler);
    mainButtonClickHandler = null;
  }
  btn.hide();
}

export function normalizeAppTheme(raw: string | null | undefined): AppTheme {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "dark" || value === "темна") return "dark";
  if (value === "light" || value === "світла") return "light";
  return "auto";
}

export function getStoredAppTheme(): AppTheme {
  try {
    return normalizeAppTheme(localStorage.getItem(APP_THEME_STORAGE_KEY));
  } catch {
    return "auto";
  }
}

export function resolveAppThemeIsDark(theme: AppTheme = getStoredAppTheme()): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return getTelegramWebApp()?.colorScheme === "dark";
}

export function setAppTheme(theme: AppTheme) {
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
  applyTelegramTheme();
  appThemeListeners.forEach((listener) => listener(theme));
}

/** Фон Mini App: localStorage `app-theme`, інакше тема Telegram. */
export function applyTelegramTheme() {
  const theme = getStoredAppTheme();
  const isDark = resolveAppThemeIsDark(theme);
  try {
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  } catch {
    // ignore
  }
  try {
    const tg = getTelegramWebApp();
    tg?.ready?.();
    tg?.setHeaderColor?.("bg_color");
    tg?.setBackgroundColor?.("bg_color");
  } catch {
    // поза Telegram Mini App
  }
}

/**
 * Нативні фішки Telegram Mini App: хаптика, BackButton, MainButton.
 * BackButton ховається на головній `/`, на інших екранах веде назад.
 */
export function useTelegramUI() {
  const location = useLocation();
  const navigate = useNavigate();
  const appBack = useAppBackOptional();
  const [isHapticEnabled, setIsHapticEnabled] = useState(hapticEnabledFlag);
  const [appTheme, setAppThemeState] = useState<AppTheme>(getStoredAppTheme);

  const hasOverlay = Boolean(appBack?.hasOverlay);
  const goBack = appBack?.goBack;

  const updateHapticEnabled = useCallback((enabled: boolean) => {
    setHapticEnabled(enabled);
    setIsHapticEnabled(enabled);
  }, []);

  const updateAppTheme = useCallback((theme: AppTheme) => {
    setAppTheme(theme);
    setAppThemeState(theme);
  }, []);

  useEffect(() => {
    hapticEnabledListeners.add(setIsHapticEnabled);
    return () => {
      hapticEnabledListeners.delete(setIsHapticEnabled);
    };
  }, []);

  useEffect(() => {
    appThemeListeners.add(setAppThemeState);
    return () => {
      appThemeListeners.delete(setAppThemeState);
    };
  }, []);

  useEffect(() => {
    applyTelegramTheme();
    const tg = getTelegramWebApp();
    tg?.enableClosingConfirmation?.();
    const onThemeChanged = () => {
      if (getStoredAppTheme() === "auto") applyTelegramTheme();
    };
    tg?.onEvent?.("themeChanged", onThemeChanged);
    return () => {
      tg?.offEvent?.("themeChanged", onThemeChanged);
    };
  }, []);

  useEffect(() => {
    const tg = getTelegramWebApp();
    const backButton = tg?.BackButton;
    const onBack = () => {
      if (hasOverlay && goBack) {
        goBack();
        return;
      }
      if (window.history.length > 1) {
        navigate(-1);
        return;
      }
      navigate("/");
    };

    const showButton = location.pathname !== "/" || hasOverlay;

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
  }, [goBack, hasOverlay, location.pathname, navigate]);

  useEffect(() => {
    return () => hideMainButton();
  }, [location.pathname]);

  return useMemo(
    () => ({
      webApp: getTelegramWebApp(),
      isHapticEnabled,
      setHapticEnabled: updateHapticEnabled,
      appTheme,
      setAppTheme: updateAppTheme,
      vibrate,
      showMainButton,
      hideMainButton,
      setMainButtonParams,
    }),
    [appTheme, isHapticEnabled, updateAppTheme, updateHapticEnabled],
  );
}

export function useTelegramUIContext() {
  const ctx = useContext(TelegramUIContext);
  if (!ctx) {
    return {
      webApp: getTelegramWebApp(),
      isHapticEnabled: hapticEnabledFlag,
      setHapticEnabled,
      appTheme: getStoredAppTheme(),
      setAppTheme,
      vibrate,
      showMainButton,
      hideMainButton,
      setMainButtonParams,
    };
  }
  return ctx;
}

/** Підключити нативний UI один раз біля роутера. */
export function TelegramUIBridge({ children }: { children?: ReactNode }) {
  const value = useTelegramUI();
  return (
    <TelegramUIContext.Provider value={value}>
      {children ?? null}
    </TelegramUIContext.Provider>
  );
}
