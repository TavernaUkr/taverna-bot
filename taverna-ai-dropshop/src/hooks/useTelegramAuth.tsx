import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

const isDevAuthEnvironment = () => {
  try {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    // Lovable sandbox previews (in-editor iframe and shareable preview) — allow mock auth
    // so the app is testable without a real Telegram Mini App context.
    if (host.startsWith('id-preview--')) return true;
    if (host.endsWith('.lovableproject.com')) return true;
    if (host.endsWith('.lovable.app')) return true;
    return false;
  } catch {
    return false;
  }
};


export function useTelegramAuth() {
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    profile: null,
    addresses: [],
    sessionToken: null,
    error: null,
  });

  // Get session token from storage
  const getStoredToken = useCallback((): string | null => {
    try {
      return localStorage.getItem(SESSION_TOKEN_KEY);
    } catch {
      return null;
    }
  }, []);

  // Store session token
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

  // Validate existing session
  const validateSession = useCallback(async (token: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('telegram-auth', {
        body: { action: 'validate', session_token: token },
      });
      
      if (error || !data?.success) {
        // Clear stale token on validation failure
        storeToken(null);
        return false;
      }
      
      setState({
        isLoading: false,
        isAuthenticated: true,
        profile: data.profile,
        addresses: data.addresses || [],
        sessionToken: token,
        error: null,
      });
      
      return true;
    } catch {
      // Clear stale token on any error (including 401)
      storeToken(null);
      return false;
    }
  }, [storeToken]);

  const authenticate = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      // Check for existing session first
      const existingToken = getStoredToken();
      if (existingToken) {
        const isValid = await validateSession(existingToken);
        if (isValid) {
          return state.profile;
        }
        // Invalid session, clear it
        storeToken(null);
      }
      
      // Check if running in Telegram Mini App
      const tg = (window as any).Telegram?.WebApp;
      let initData = tg?.initData;
      
      // For development, use mock auth
      if (!initData || initData === '') {
        console.log('No Telegram initData, using mock auth for development');
        initData = 'mock_dev_auth';
      }
      
      const { data, error } = await supabase.functions.invoke('telegram-auth', {
        body: { init_data: initData },
      });
      
      if (error) throw error;
      
      if (data?.success && data?.profile) {
        // Store the session token
        if (data.session_token) {
          storeToken(data.session_token);
        }
        
        setState({
          isLoading: false,
          isAuthenticated: true,
          profile: data.profile,
          addresses: data.addresses || [],
          sessionToken: data.session_token || null,
          error: null,
        });
        return data.profile;
      } else {
        throw new Error(data?.error || 'Authentication failed');
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      console.error('Auth error:', errorMessage);
      setState({
        isLoading: false,
        isAuthenticated: false,
        profile: null,
        addresses: [],
        sessionToken: null,
        error: errorMessage,
      });
      return null;
    }
  }, [getStoredToken, storeToken, validateSession]);

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
    setState({
      isLoading: false,
      isAuthenticated: false,
      profile: null,
      addresses: [],
      sessionToken: null,
      error: null,
    });
  }, [state.sessionToken, storeToken]);

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      const existingToken = getStoredToken();
      if (existingToken) {
        const isValid = await validateSession(existingToken);
        if (isValid) return;
        // Stale token — clear and fall through to fresh auth below.
        storeToken(null);
      }

      // If in Telegram WebApp or Lovable test preview, auto-authenticate.
      const tg = (window as any).Telegram?.WebApp;
      if (tg?.initData || isDevAuthEnvironment()) {
        authenticate();
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    };

    checkSession();
  }, [getStoredToken, storeToken, validateSession, authenticate]);

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
