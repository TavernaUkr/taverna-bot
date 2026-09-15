import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { authTelegramMiniApp, type BackendTelegramUser } from '@/lib/backendApi';

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

function readTelegramInitData(): string {
  return String(getTelegramWebApp()?.initData || "");
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

/** На телефоні WebApp інколи з'являється з мікрозатримкою — чекаємо, не блокуємо UI. */
async function waitForTelegramInitData(maxMs = 800): Promise<string> {
  const existing = readTelegramInitData();
  if (existing) return existing;

  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const data = readTelegramInitData();
      if (data || Date.now() - started >= maxMs) {
        resolve(data);
        return;
      }
      window.setTimeout(tick, 50);
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

  const applyGuest = useCallback(() => {
    setState({
      isLoading: false,
      isAuthenticated: false,
      profile: null,
      addresses: [],
      sessionToken: null,
      error: null,
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
        (await waitForTelegramInitData()) ||
        String(getTelegramWebApp()?.initData || "");

      if (requestId !== authRequestId.current) return null;

      const result = await authTelegramMiniApp(initData);
      if (requestId !== authRequestId.current) return null;

      const mappedRole = mapBackendRole(result.role || result.user?.role);

      if (
        !result ||
        result.is_guest ||
        mappedRole === "guest" ||
        !result.user?.telegram_id
      ) {
        applyGuest();
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
      if (requestId !== authRequestId.current) return null;
      applyGuest();
      return null;
    }
  }, [applyGuest]);

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
    updateProfile,
    addAddress,
    updateAddress,
    deleteAddress,
    logout,
  };
}
