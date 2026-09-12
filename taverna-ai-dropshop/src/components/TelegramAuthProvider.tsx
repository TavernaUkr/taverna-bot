import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, ShieldCheck, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { isPreviewDevEnvironment, PREVIEW_PROFILE_ID } from '@/lib/dev-preview';

type AppRole = 'admin' | 'moderator' | 'supplier' | 'shop_manager' | 'customer';
type TestRole = 'guest' | AppRole;

const DEV_ROLE_STORAGE_KEY = 'taverna_dev_role_override';

// Single shared check (never true on the published production domain).
const isLovableDevEnvironment = isPreviewDevEnvironment;

// Check if we're in any development environment (localhost, dev mode)
const isDevEnv = isPreviewDevEnvironment;


const isTestRole = (value: unknown): value is TestRole => {
  return (
    value === 'guest' ||
    value === 'customer' ||
    value === 'supplier' ||
    value === 'shop_manager' ||
    value === 'moderator' ||
    value === 'admin'
  );
};

interface TelegramAuthContextType {
  isAuthenticated: boolean;
  isRealAuthenticated: boolean;
  isLoading: boolean;
  rolesLoading: boolean;
  profile: any;
  realProfile: any;
  addresses: any[];
  sessionToken: string | null;
  error: string | null;
  roles: AppRole[];
  realRoles: AppRole[];
  effectiveRole: TestRole;
  devRoleOverride: TestRole | null;
  canUseDevRoleSwitcher: boolean;
  setDevRoleOverride: (role: TestRole | null) => void;
  logout: () => Promise<void>;
  updateProfile: (updates: any) => Promise<any>;
  addAddress: (address: any) => Promise<any>;
  updateAddress: (id: string, updates: any) => Promise<any>;
  deleteAddress: (id: string) => Promise<boolean>;
}

const TelegramAuthContext = createContext<TelegramAuthContextType | null>(null);

export function useTelegramAuthContext() {
  const context = useContext(TelegramAuthContext);
  if (!context) {
    // Return a safe default context for SSR or when provider is not available
    // This prevents crashes during hot reload or initial render
    console.warn('useTelegramAuthContext called outside of TelegramAuthProvider, returning defaults');
    return {
      isAuthenticated: false,
      isRealAuthenticated: false,
      isLoading: true,
      rolesLoading: true,
      profile: null,
      realProfile: null,
      addresses: [],
      sessionToken: null,
      error: null,
      roles: [] as AppRole[],
      realRoles: [] as AppRole[],
      effectiveRole: 'guest' as TestRole,
      devRoleOverride: null,
      canUseDevRoleSwitcher: false,
      setDevRoleOverride: () => {},
      logout: async () => {},
      updateProfile: async () => null,
      addAddress: async () => null,
      updateAddress: async () => null,
      deleteAddress: async () => false,
    };
  }
  return context;
}

interface TelegramAuthProviderProps {
  children: ReactNode;
}

export function TelegramAuthProvider({ children }: TelegramAuthProviderProps) {
  const auth = useTelegramAuth();
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingAuth, setPendingAuth] = useState(false);
  const [telegramData, setTelegramData] = useState<any>(null);

  // Real roles (from secure user_roles table)
  const [realRoles, setRealRoles] = useState<AppRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);

  // DEV role simulation (only active for real admins in dev env)
  const [devRoleOverride, setDevRoleOverrideState] = useState<TestRole | null>(null);

  const isRealAuthenticated = auth.isAuthenticated;

  useEffect(() => {
    const fetchRoles = async () => {
      if (!auth.profile?.id || !auth.isAuthenticated || !auth.sessionToken) {
        setRealRoles([]);
        return;
      }

      setRolesLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('manage-user-roles', {
          body: { action: 'get_my_roles', session_token: auth.sessionToken },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        setRealRoles((data?.roles || []) as AppRole[]);
      } catch (err) {
        console.error('Error fetching user roles:', err);
        setRealRoles([]);
      } finally {
        setRolesLoading(false);
      }
    };

    fetchRoles();
  }, [auth.isAuthenticated, auth.profile?.id, auth.sessionToken]);

  const isRealAdmin = realRoles.includes('admin');

  // Visible for verified admins everywhere, plus in Lovable preview / localhost for UI development.
  const canUseDevRoleSwitcher = useMemo(() => {
    return isRealAdmin || isPreviewDevEnvironment();
  }, [isRealAdmin]);

  // Load stored override only when allowed
  useEffect(() => {
    if (!canUseDevRoleSwitcher) {
      setDevRoleOverrideState(null);
      return;
    }

    try {
      const stored = localStorage.getItem(DEV_ROLE_STORAGE_KEY);
      if (stored && isTestRole(stored)) {
        setDevRoleOverrideState(stored);
      }
    } catch {
      // ignore
    }
  }, [canUseDevRoleSwitcher]);

  // Persist override only when allowed
  useEffect(() => {
    if (!canUseDevRoleSwitcher) return;

    try {
      if (devRoleOverride) {
        localStorage.setItem(DEV_ROLE_STORAGE_KEY, devRoleOverride);
      } else {
        localStorage.removeItem(DEV_ROLE_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [devRoleOverride, canUseDevRoleSwitcher]);

  const derivedRealRole: TestRole = useMemo(() => {
    if (!auth.isAuthenticated) return 'guest';
    if (realRoles.includes('admin')) return 'admin';
    if (realRoles.includes('moderator')) return 'moderator';
    if (realRoles.includes('supplier')) return 'supplier';
    if (realRoles.includes('shop_manager')) return 'shop_manager';
    return 'customer';
  }, [auth.isAuthenticated, realRoles]);

  // IMPORTANT: override is honored ONLY for real admins in dev env
  // OR in Lovable.dev environment for testing
  const effectiveRole: TestRole = canUseDevRoleSwitcher && devRoleOverride 
    ? devRoleOverride 
    : derivedRealRole;

  const roles: AppRole[] = useMemo(() => {
    if (effectiveRole === 'guest') return [];
    if (effectiveRole === 'customer') return ['customer'] as AppRole[];
    return [effectiveRole] as AppRole[];
  }, [effectiveRole]);

  const isAuthenticated = effectiveRole !== 'guest' && (canUseDevRoleSwitcher ? true : auth.isAuthenticated);
  const previewRoleNames: Record<TestRole, string> = {
    guest: 'Гість',
    customer: 'Клієнт',
    supplier: 'Постачальник',
    shop_manager: 'Менеджер магазину',
    moderator: 'Модератор',
    admin: 'Адмін',
  };
  const previewProfile = canUseDevRoleSwitcher ? {
    id: PREVIEW_PROFILE_ID,
    telegram_id: 123456789,
    first_name: 'Тест',
    last_name: previewRoleNames[effectiveRole],
    phone: '380501234567',
    user_type: effectiveRole === 'supplier' ? 'supplier' : 'customer',
    telegram_username: `test_${effectiveRole}`,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } : null;
  const profile = effectiveRole === 'guest'
    ? null
    : (canUseDevRoleSwitcher && devRoleOverride ? { ...(auth.profile || {}), ...previewProfile } : (auth.profile || previewProfile));


  // Provide test addresses in dev environment when real addresses are empty
  const testAddresses = canUseDevRoleSwitcher && auth.addresses.length === 0 ? [
    {
      id: 'test-addr-1',
      profile_id: '38363307-c867-4dad-835d-e5bf0f301464',
      is_default: true,
      recipient_name: 'Тест Користувач',
      phone: '380501234567',
      delivery_service: 'nova_poshta',
      city: 'Київ',
      city_ref: 'e718a680-4b33-11e4-ab6d-005056801329',
      delivery_type: 'warehouse',
      warehouse_number: '1',
      warehouse_ref: '',
      street_address: null,
      building_number: null,
      apartment: null,
      postal_code: null,
      notes: 'Тестова адреса',
    },
  ] : [];
  const addresses = effectiveRole === 'guest' ? [] : (auth.addresses.length > 0 ? auth.addresses : testAddresses);

  const setDevRoleOverride = (role: TestRole | null) => {
    if (!canUseDevRoleSwitcher) return;
    if (role && !isTestRole(role)) return;
    setDevRoleOverrideState(role);
  };

  // Check for Telegram WebApp on mount
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    
    if (tg?.initDataUnsafe?.user) {
      // We have Telegram user data, store it
      setTelegramData(tg.initDataUnsafe.user);
      
      // If already authenticated, don't show dialog
      if (!auth.isAuthenticated && !auth.isLoading) {
        // Small delay to let the app render first
        setTimeout(() => {
          setShowConfirmDialog(true);
        }, 500);
      }
    }
    
    // Expand Telegram WebApp to full height
    if (tg) {
      tg.expand();
      tg.ready();
    }
  }, [auth.isAuthenticated, auth.isLoading]);

  // Listen for manual auth request from profile
  useEffect(() => {
    const handleAuthRequest = () => {
      const tg = (window as any).Telegram?.WebApp;
      if (tg?.initDataUnsafe?.user && !auth.isAuthenticated) {
        setTelegramData(tg.initDataUnsafe.user);
        setShowConfirmDialog(true);
      }
    };

    window.addEventListener('taverna:request-auth', handleAuthRequest);
    return () => window.removeEventListener('taverna:request-auth', handleAuthRequest);
  }, [auth.isAuthenticated]);

  const handleConfirmAuth = async () => {
    setPendingAuth(true);
    await auth.authenticate();
    setPendingAuth(false);
    setShowConfirmDialog(false);
  };

  const handleDenyAuth = () => {
    setShowConfirmDialog(false);
  };

  const getUserDisplayName = () => {
    if (telegramData) {
      const parts = [telegramData.first_name, telegramData.last_name].filter(Boolean);
      return parts.join(' ') || telegramData.username || 'Користувач Telegram';
    }
    return 'Користувач';
  };

  return (
    <TelegramAuthContext.Provider value={{
      isAuthenticated,
      isRealAuthenticated,
      isLoading: auth.isLoading,
      rolesLoading,
      profile,
      realProfile: auth.profile,
      addresses,
      sessionToken: auth.sessionToken,
      error: auth.error,
      roles,
      realRoles,
      effectiveRole,
      devRoleOverride: canUseDevRoleSwitcher ? devRoleOverride : null,
      canUseDevRoleSwitcher,
      setDevRoleOverride,
      logout: auth.logout,
      updateProfile: auth.updateProfile,
      addAddress: auth.addAddress,
      updateAddress: auth.updateAddress,
      deleteAddress: auth.deleteAddress,
    }}>
      {children}

      {/* Auth Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="sm:max-w-[425px] mx-4">
          <DialogHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="h-8 w-8 text-primary" />
            </div>
            <DialogTitle className="text-xl">Вхід через Telegram</DialogTitle>
            <DialogDescription className="pt-2">
              Ви входите як:
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex items-center gap-4 p-4 bg-muted rounded-lg my-4">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
              {telegramData?.photo_url ? (
                <img 
                  src={telegramData.photo_url} 
                  alt="Avatar" 
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="h-6 w-6 text-primary" />
              )}
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground">{getUserDisplayName()}</p>
              {telegramData?.username && (
                <p className="text-sm text-muted-foreground">@{telegramData.username}</p>
              )}
            </div>
          </div>

          <div className="text-sm text-muted-foreground space-y-2 p-3 bg-muted/50 rounded-lg">
            <p className="font-medium text-foreground">При авторизації ви надаєте згоду на:</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>Обробку вашого імені та аватару з Telegram</li>
              <li>Збереження історії замовлень</li>
              <li>Отримання сповіщень про статус замовлень</li>
            </ul>
          </div>

          <DialogFooter className="flex gap-2 sm:gap-2 mt-4">
            <Button 
              variant="outline" 
              onClick={handleDenyAuth}
              className="flex-1"
              disabled={pendingAuth}
            >
              Скасувати
            </Button>
            <Button 
              onClick={handleConfirmAuth} 
              className="flex-1"
              disabled={pendingAuth}
            >
              {pendingAuth ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Вхід...
                </>
              ) : (
                'Підтвердити'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loading Overlay */}
      {auth.isLoading && !showConfirmDialog && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Завантаження...</p>
          </div>
        </div>
      )}
    </TelegramAuthContext.Provider>
  );
}
