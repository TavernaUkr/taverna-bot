import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { authTelegramMiniApp, BackendApiError, type BackendTelegramUser } from '@/lib/backendApi';
import { setHapticEnabled } from '@/hooks/useTelegramUI';

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

interface Profile {
  id: string;
  telegram_id: number | null;
  telegram_username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  user_type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  roles?: string[]; // Roles from secure user_roles table
  haptic_enabled?: boolean;
  notifications_enabled?: boolean;
}

interface DeliveryAddress {
  id: string;
  profile_id: string | null;
  is_default: boolean;
  recipient_name: string;
  phone: string;
  delivery_service: string;
  city: string;
  city_ref?: string | null;
  delivery_type: string;
  warehouse_number?: string | null;
  warehouse_ref?: string | null;
  street_address?: string | null;
  building_number?: string | null;
  apartment?: string | null;
  postal_code?: string | null;
  notes?: string | null;
}

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  profile: Profile | null;
  addresses: DeliveryAddress[];
  sessionToken: string | null;
  error: string | null;
}

const SESSION_TOKEN_KEY = 'taverna_session_token';
const AUTH_CONSENT_KEY = 'isAuthorized';
const INIT_DATA_CACHE_KEY = 'taverna_tg_init_data';
const USER_SETTINGS_CACHE_KEY = 'taverna_user_settings';

function readCachedUserSettings(): { haptic_enabled: boolean; notifications_enabled: boolean } | null {
  try {
    const raw = localStorage.getItem(USER_SETTINGS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { haptic_enabled?: unknown; notifications_enabled?: unknown };
    if (typeof parsed?.haptic_enabled !== 'boolean' && typeof parsed?.notifications_enabled !== 'boolean') {
      return null;
    }
    return {
      haptic_enabled: parsed.haptic_enabled !== false,
      notifications_enabled: parsed.notifications_enabled !== false,
    };
  } catch {
    return null;
  }
}

function cacheUserSettings(settings: { haptic_enabled?: boolean; notifications_enabled?: boolean }) {
  try {
    const prev = readCachedUserSettings() || { haptic_enabled: true, notifications_enabled: true };
    localStorage.setItem(USER_SETTINGS_CACHE_KEY, JSON.stringify({
      haptic_enabled: typeof settings.haptic_enabled === 'boolean' ? settings.haptic_enabled : prev.haptic_enabled,
      notifications_enabled: typeof settings.notifications_enabled === 'boolean' ? settings.notifications_enabled : prev.notifications_enabled,
    }));
  } catch {
    // ignore
  }
}

const cachedUserSettingsOnLoad = readCachedUserSettings();
if (cachedUserSettingsOnLoad) {
  setHapticEnabled(cachedUserSettingsOnLoad.haptic_enabled);
}

function hasAuthConsent(): boolean {
  try {
    return localStorage.getItem(AUTH_CONSENT_KEY) === 'true';
  } catch {
    return false;
  }
}

function setAuthConsent(value: boolean) {
  try {
    if (value) localStorage.setItem(AUTH_CONSENT_KEY, 'true');
    else localStorage.removeItem(AUTH_CONSENT_KEY);
  } catch {
    // ignore
  }
}

function getTelegramWebApp(): any {
  try {
    return (window as any).Telegram?.WebApp;
  } catch {
    return undefined;
  }
}

function readCachedInitData(): string {
  try {
    return sessionStorage.getItem(INIT_DATA_CACHE_KEY) || "";
  } catch {
    return "";
  }
}

function cacheInitData(initData: string) {
  if (!initData) return;
  try {
    sessionStorage.setItem(INIT_DATA_CACHE_KEY, initData);
  } catch {
    // ignore
  }
  try {
    (window as any).__TAVERNA_INIT_DATA__ = initData;
  } catch {
    // ignore
  }
}

function readInitDataFromUrl(): string {
  try {
    const rawHash = String(window.location.hash || "");
    const hash = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
    const fromHash = new URLSearchParams(hash).get("tgWebAppData");
    if (fromHash) return fromHash;
    const fromSearch = new URLSearchParams(window.location.search).get("tgWebAppData");
    if (fromSearch) return fromSearch;
    const encodedMatch = hash.match(/(?:^|&)tgWebAppData=([^&]+)/);
    if (encodedMatch?.[1]) return decodeURIComponent(encodedMatch[1]);
    return "";
  } catch {
    return "";
  }
}

function readTelegramInitData(): string {
  const fromWebApp = String(getTelegramWebApp()?.initData || "");
  if (fromWebApp) {
    cacheInitData(fromWebApp);
    return fromWebApp;
  }
  const early = String((window as any).__TAVERNA_INIT_DATA__ || "");
  if (early) {
    cacheInitData(early);
    return early;
  }
  const cached = readCachedInitData();
  if (cached) return cached;
  const fromUrl = readInitDataFromUrl();
  if (fromUrl) cacheInitData(fromUrl);
  return fromUrl;
}

function readTelegramUnsafeUser(): {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
} | null {
  try {
    return getTelegramWebApp()?.initDataUnsafe?.user || null;
  } catch {
    return null;
  }
}

/** На телефоні та в Telegram Web initData інколи з'являється з затримкою. */
async function waitForTelegramInitData(maxMs = 3000): Promise<string> {
  const existing = readTelegramInitData();
  if (existing) return existing;

  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      try {
        getTelegramWebApp()?.ready?.();
      } catch {
        // ignore
      }
      const data = readTelegramInitData();
      if (data || Date.now() - started >= maxMs) {
        resolve(data);
        return;
      }
      window.setTimeout(tick, 80);
    };
    tick();
  });
}

function mapBackendRole(role?: string | null): string {
  if (!role || role === "guest") return "guest";
  if (role === "client" || role === "user") return "customer";
  return role;
}

function mapBackendUserToProfile(user: BackendTelegramUser, role: string): Profile {
  const mapped = mapBackendRole(role || user.role);
  const tgUser = readTelegramUnsafeUser();
  const cached = readCachedUserSettings();
  const hapticEnabled =
    typeof user.haptic_enabled === 'boolean'
      ? user.haptic_enabled
      : (cached?.haptic_enabled ?? true);
  const notificationsEnabled =
    typeof user.notifications_enabled === 'boolean'
      ? user.notifications_enabled
      : (cached?.notifications_enabled ?? true);
  setHapticEnabled(hapticEnabled);
  cacheUserSettings({
    haptic_enabled: hapticEnabled,
    notifications_enabled: notificationsEnabled,
  });
  return {
    id: String(user.id),
    telegram_id: user.telegram_id || tgUser?.id || null,
    telegram_username: user.username || tgUser?.username || null,
    first_name: user.first_name || tgUser?.first_name || null,
    last_name: user.last_name || tgUser?.last_name || null,
    phone: null,
    email: null,
    avatar_url: tgUser?.photo_url || null,
    user_type: mapped === "supplier" ? "supplier" : "customer",
    is_active: true,
    created_at: user.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    roles: mapped === "guest" ? [] : [mapped],
    haptic_enabled: hapticEnabled,
    notifications_enabled: notificationsEnabled,
  };
}


export function useTelegramAuth() {
  const [state, setState] = useState<AuthState>({
    isLoading: false,
    isAuthenticated: false,
    profile: null,
    addresses: [],
    sessionToken: null,
    error: null,
  });

  // Get session token from storage
  const storeToken = useCallback((token: string | null) => {
    try {
      if (token) {
        localStorage.setItem(SESSION_TOKEN_KEY, token);
      } else {
        localStorage.removeItem(SESSION_TOKEN_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const applyGuest = useCallback((error: string | null = null) => {
    setState({
      isLoading: false,
      isAuthenticated: false,
      profile: null,
      addresses: [],
      sessionToken: null,
      error,
    });
  }, []);

  const authRequestId = useRef(0);

  const authenticate = useCallback(async (options?: { forceTelegram?: boolean }) => {
    const requestId = ++authRequestId.current;
    try {
      setState(prev => ({ ...prev, error: null }));

      const tg = getTelegramWebApp();
      try {
        tg?.ready?.();
        tg?.expand?.();
      } catch {
        // WebApp ще не готовий — не блокуємо додаток
      }

      const initData =
        (await waitForTelegramInitData(options?.forceTelegram ? 4000 : 3000)) ||
        String(getTelegramWebApp()?.initData || "") ||
        readTelegramInitData();

      if (requestId !== authRequestId.current && !options?.forceTelegram) return null;

      if (!initData) {
        if (options?.forceTelegram) {
          const message = "Немає підпису Telegram. Відкрийте Mini App кнопкою в боті, не як звичайну вкладку браузера.";
          applyGuest(message);
          throw new Error(message);
        }
        applyGuest();
        return null;
      }

      cacheInitData(initData);
      const result = await authTelegramMiniApp(initData);
      if (requestId !== authRequestId.current && !options?.forceTelegram) return null;

      const mappedRole = mapBackendRole(result.role || result.user?.role);

      if (
        !result ||
        result.is_guest ||
        mappedRole === "guest" ||
        !result.user?.telegram_id
      ) {
        applyGuest(
          options?.forceTelegram
            ? "Telegram не підтвердив сесію. Закрийте Mini App і відкрийте його знову з бота."
            : null
        );
        if (options?.forceTelegram) {
          throw new Error("Telegram не підтвердив сесію. Закрийте Mini App і відкрийте його знову з бота.");
        }
        return null;
      }

      const profile = mapBackendUserToProfile(result.user, mappedRole);
      setAuthConsent(true);
      setState({
        isLoading: false,
        isAuthenticated: true,
        profile,
        addresses: [],
        sessionToken: initData || null,
        error: null,
      });
      return profile;
    } catch (error: unknown) {
      console.error('Auth error:', error);
      if (requestId !== authRequestId.current && !options?.forceTelegram) return null;
      const message =
        error instanceof BackendApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Не вдалося авторизуватись через Telegram.";
      applyGuest(message);
      if (options?.forceTelegram) {
        throw new Error(message);
      }
      return null;
    }
  }, [applyGuest]);

  const applyProfileSettings = useCallback((updates: {
    haptic_enabled?: boolean;
    notifications_enabled?: boolean;
  }) => {
    if (typeof updates.haptic_enabled === 'boolean') {
      setHapticEnabled(updates.haptic_enabled);
    }
    cacheUserSettings(updates);
    setState(prev => {
      if (!prev.profile) return prev;
      return {
        ...prev,
        profile: {
          ...prev.profile,
          ...updates,
          updated_at: new Date().toISOString(),
        },
      };
    });
  }, []);

  const updateProfile = useCallback(async (updates: Partial<Profile>) => {
    if (!state.profile || !state.sessionToken) return null;
    
    try {
      // Use edge function for profile updates
      const { data, error } = await supabase.functions.invoke('telegram-auth', {
        body: { 
          action: 'update_profile',
          session_token: state.sessionToken,
          updates,
        },
      });
      
      if (error) throw error;
      
      if (data?.profile) {
        setState(prev => ({ ...prev, profile: data.profile }));
        return data.profile;
      }
      return null;
    } catch (error) {
      console.error('Update profile error:', error);
      return null;
    }
  }, [state.profile, state.sessionToken]);

  const addAddress = useCallback(async (address: Omit<DeliveryAddress, 'id' | 'profile_id'>) => {
    if (!state.profile || !state.sessionToken) return null;
    
    try {
      const { data, error } = await supabase.functions.invoke('telegram-auth', {
        body: { 
          action: 'add_address',
          session_token: state.sessionToken,
          address,
        },
      });
      
      if (error) throw error;
      
      if (data?.address) {
        setState(prev => ({ 
          ...prev, 
          addresses: [...prev.addresses, data.address] 
        }));
        return data.address;
      }
      return null;
    } catch (error) {
      console.error('Add address error:', error);
      return null;
    }
  }, [state.profile, state.sessionToken]);

  const updateAddress = useCallback(async (id: string, updates: Partial<DeliveryAddress>) => {
    if (!state.sessionToken) return null;
    
    try {
      const { data, error } = await supabase.functions.invoke('telegram-auth', {
        body: { 
          action: 'update_address',
          session_token: state.sessionToken,
          address_id: id,
          updates,
        },
      });
      
      if (error) throw error;
      
      if (data?.address) {
        setState(prev => ({
          ...prev,
          addresses: prev.addresses.map(a => a.id === id ? data.address : a),
        }));
        return data.address;
      }
      return null;
    } catch (error) {
      console.error('Update address error:', error);
      return null;
    }
  }, [state.sessionToken]);

  const deleteAddress = useCallback(async (id: string) => {
    if (!state.sessionToken) return false;
    
    try {
      const { data, error } = await supabase.functions.invoke('telegram-auth', {
        body: { 
          action: 'delete_address',
          session_token: state.sessionToken,
          address_id: id,
        },
      });
      
      if (error) throw error;
      
      if (data?.success) {
        setState(prev => ({
          ...prev,
          addresses: prev.addresses.filter(a => a.id !== id),
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Delete address error:', error);
      return false;
    }
  }, [state.sessionToken]);

  const logout = useCallback(async () => {
    if (state.sessionToken) {
      // Invalidate server session
      await supabase.functions.invoke('telegram-auth', {
        body: { action: 'logout', session_token: state.sessionToken },
      }).catch(() => {});
    }
    
    storeToken(null);
    setAuthConsent(false);
    setState({
      isLoading: false,
      isAuthenticated: false,
      profile: null,
      addresses: [],
      sessionToken: null,
      error: null,
    });
  }, [state.sessionToken, storeToken]);

  // Без свідомої згоди (isAuthorized) — завжди гість, без запиту на бекенд.
  // Якщо згода вже є — тиха авторизація POST /api/v1/auth/telegram.
  useEffect(() => {
    if (!hasAuthConsent()) {
      applyGuest();
      return;
    }

    let cancelled = false;
    authenticate().then(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [authenticate, applyGuest]);

  return {
    ...state,
    authenticate,
    applyProfileSettings,
    updateProfile,
    addAddress,
    updateAddress,
    deleteAddress,
    logout,
  };
}
