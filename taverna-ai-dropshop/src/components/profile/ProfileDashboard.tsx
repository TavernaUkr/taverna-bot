import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Package,
  Gift,
  Settings,
  User,
  Users,
  ChevronRight,
  LogOut,
  Store,
  HelpCircle,
  BookOpen,
  Shield,
  Flag,
  MessageSquare,
  LifeBuoy,
  Headphones,
  Scale,
  ClipboardList,
  MapPin,
  Archive,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { OrdersHistory } from "@/components/OrdersHistory";
import { toast } from "sonner";
import { SupplierGuideModal } from "@/components/SupplierGuideModal";
import { CustomerGuideModal } from "@/components/CustomerGuideModal";
import { hapticSelection } from "@/lib/haptics";
import { hideMainButton, showMainButton, vibrate } from "@/hooks/useTelegramUI";
import { DevRoleSwitcher } from "@/components/profile/DevRoleSwitcher";
import { AccountSettings } from "@/components/AccountSettings";
import { ModeratorGuideModal } from "@/components/guides/ModeratorGuideModal";
import { ManagerGuideModal } from "@/components/guides/ManagerGuideModal";
import { AppSettingsSheet } from "@/components/profile/AppSettingsSheet";
import { useBonuses } from "@/hooks/useBonuses";
import { getMyShops, type BackendMyShop } from "@/lib/backendApi";

type TestRole = "guest" | "customer" | "supplier" | "shop_manager" | "moderator" | "admin";

function SettingsMenuRow({
  icon: Icon,
  title,
  subtitle,
  onClick,
  extra,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  onClick: () => void;
  extra?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-center min-w-0">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mr-4 shrink-0">
          <Icon className="w-5 h-5 text-muted-foreground" />
        </div>
        <div className="text-left min-w-0">
          <p className="font-medium text-foreground">{title}</p>
          {subtitle ? <div className="text-sm text-muted-foreground">{subtitle}</div> : null}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {extra}
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </div>
    </button>
  );
}

export const ProfileDashboard = () => {
  const navigate = useNavigate();
  const { 
    isAuthenticated,
    isRealAuthenticated,
    effectiveRole,
    canUseDevRoleSwitcher,
    setDevRoleOverride,
    roles,
    realProfile,
    realRoles,
    profile,
    addresses,
    logout,
    authenticate,
    error: authError,
    updateProfile,
    addAddress,
    updateAddress,
    deleteAddress
  } = useTelegramAuthContext();
  const [activeTab, setActiveTab] = useState("orders");
  const [showSupplierGuide, setShowSupplierGuide] = useState(false);
  const [showCustomerGuide, setShowCustomerGuide] = useState(false);
  const [showModeratorGuide, setShowModeratorGuide] = useState(false);
  const [showManagerGuide, setShowManagerGuide] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  // Магазини юзера (власник або менеджер) — для кнопки "Керування магазинами"
  const [myShops, setMyShops] = useState<BackendMyShop[] | null>(null);
  const { reputationScore, balance } = useBonuses();

  const isSupplier = roles.includes('supplier') || roles.includes('admin');
  const isOnlySupplier = roles.includes('supplier');
  const isShopManager = roles.includes('shop_manager');
  const isAdmin = roles.includes('admin');
  const isModerator = roles.includes('moderator');
  const canSeeSupplierGuide = roles.includes('supplier') || isAdmin;
  const canSeeModeratorGuide = roles.includes('moderator') || isAdmin;
  const canSeeManagerGuide = roles.includes('shop_manager') || isAdmin;

  // Юзер має хоча б один магазин (власник ЧИ менеджер) — це надійніше,
  // ніж роль: клієнт з інвайтом менеджера теж отримає доступ.
  const hasShops = Array.isArray(myShops) && myShops.length > 0;

  useEffect(() => {
    // Завантажуємо магазини юзера при відкритті профілю (авторизованого).
    // Помилки ігноруємо — кнопка просто залишиться ролезалежною.
    if (!isAuthenticated) {
      setMyShops(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const shops = await getMyShops();
        if (!cancelled) setMyShops(shops);
      } catch {
        if (!cancelled) setMyShops(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, realRoles]);

  useEffect(() => {
    // If we simulate Guest, ensure sensitive modals are closed.
    if (!isAuthenticated) {
      setShowAccountSettings(false);
    }
  }, [isAuthenticated]);

  const openAppSettings = () => {
    hapticSelection();
    setShowAppSettings(true);
  };

  const handleLogout = async () => {
    await logout();
    toast.success("Ви вийшли з акаунту");
  };

  const handlePartnerClick = () => {
    if (isSupplier || isAdmin || isModerator) {
      // User is already a supplier/admin - go to manager dashboard
      navigate("/manager");
    } else {
      // User is not a supplier - go to registration
      navigate("/partner");
    }
  };

  const getUserInitials = () => {
    if (profile) {
      const first = profile.first_name?.[0] || "";
      const last = profile.last_name?.[0] || "";
      return (first + last).toUpperCase() || "U";
    }
    return "Г";
  };

  const getDisplayName = () => {
    if (profile) {
      const parts = [profile.first_name, profile.last_name].filter(Boolean);
      return parts.join(" ") || profile.telegram_username || "Користувач";
    }
    return "Гість";
  };

  const handleAuthClick = async () => {
    if (authBusy) return;
    vibrate("light");
    setAuthBusy(true);
    try {
      const result = await authenticate({ forceTelegram: true });
      if (result) {
        vibrate("success");
        toast.success("Ви увійшли через Telegram");
      } else {
        vibrate("error");
        toast.error(authError || "Не вдалося підтвердити Telegram. Відкрийте Mini App з бота.");
      }
    } catch (err) {
      vibrate("error");
      toast.error(err instanceof Error ? err.message : "Не вдалося підтвердити Telegram. Відкрийте Mini App з бота.");
    } finally {
      setAuthBusy(false);
    }
  };

  const appSettingsButton = (
    <SettingsMenuRow
      icon={Settings}
      title="Налаштування додатку"
      subtitle="Тема, вібрація та сповіщення"
      onClick={openAppSettings}
    />
  );

  useEffect(() => {
    if (isAuthenticated) {
      hideMainButton();
      return;
    }
    showMainButton(authBusy ? "Перевіряємо..." : "Авторизувати мене", () => {
      void handleAuthClick();
    });
    return () => hideMainButton();
  }, [authBusy, isAuthenticated]);

  return (
    <div className="space-y-4 pb-28 animate-fade-in">
      {/* User Card */}
      <div className="bg-card rounded-xl p-4 border border-border">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/15 to-accent/15 flex items-center justify-center overflow-hidden ring-2 ring-primary/15">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt="Avatar"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-2xl font-bold text-primary">{getUserInitials()}</span>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">{getDisplayName()}</h3>
              {/* DEV Role Switcher - inline next to profile name */}
              {canUseDevRoleSwitcher && (
                <DevRoleSwitcher
                  currentRole={effectiveRole as TestRole}
                  onRoleChange={(r) => setDevRoleOverride(r as TestRole)}
                  profileId={realProfile?.id}
                />
              )}
            </div>
            {isAuthenticated ? (
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm text-muted-foreground">
                  {profile?.telegram_username
                    ? `@${profile.telegram_username}`
                    : profile?.phone || "Авторизовано"}
                </p>
                {isSupplier && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                    Партнер
                  </span>
                )}
                {isAdmin && (
                  <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded-full font-medium">
                    Адмін
                  </span>
                )}
                {isModerator && (
                  <span className="text-xs bg-orange-500/10 text-orange-500 px-2 py-0.5 rounded-full font-medium">
                    Модератор
                  </span>
                )}
                {isShopManager && !isOnlySupplier && (
                  <span className="text-xs bg-teal-500/10 text-teal-500 px-2 py-0.5 rounded-full font-medium">
                    Менеджер магазину
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Увійдіть для повного доступу</p>
            )}
          </div>
        </div>
        {/* Reputation & Bonus mini-stats */}
        {isAuthenticated && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border">
            {reputationScore !== null && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs font-medium">
                <Star className="h-3.5 w-3.5 text-warning fill-warning" />
                <span className="text-foreground">Репутація: {reputationScore}</span>
              </div>
            )}
            {balance > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-xs font-medium text-primary">
                <Gift className="h-3.5 w-3.5" />
                {balance}₴
              </div>
            )}
          </div>
        )}
      </div>

      {isAuthenticated && isAdmin && (
        <div className="bg-orange-500/5 rounded-xl border border-orange-500/20 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-orange-500" />
            <h4 className="font-semibold text-foreground">Швидкі дії</h4>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Link
              to="/admin-dashboard?tab=applications"
              className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border hover:border-orange-500/50 transition-colors min-w-0"
            >
              <ClipboardList className="h-4 w-4 text-orange-500 shrink-0" />
              <span className="text-sm font-medium text-foreground break-words">Заявки</span>
            </Link>
            <Link
              to="/moderator?tab=disputes"
              className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border hover:border-orange-500/50 transition-colors min-w-0"
            >
              <Scale className="h-4 w-4 text-orange-500 shrink-0" />
              <span className="text-sm font-medium text-foreground break-words">Спори</span>
            </Link>
            <Link
              to="/moderator"
              className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border hover:border-orange-500/50 transition-colors min-w-0"
            >
              <Flag className="h-4 w-4 text-orange-500 shrink-0" />
              <span className="text-sm font-medium text-foreground break-words">Скарги</span>
            </Link>
            <Link
              to="/admin-dashboard?tab=roles"
              className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border hover:border-orange-500/50 transition-colors min-w-0"
            >
              <Users className="h-4 w-4 text-orange-500 shrink-0" />
              <span className="text-sm font-medium text-foreground break-words">Користувачі</span>
            </Link>
          </div>
        </div>
      )}

      {isAuthenticated && isModerator && !isAdmin && (
        <div className="bg-orange-500/5 rounded-xl border border-orange-500/20 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-orange-500" />
            <h4 className="font-semibold text-foreground">Швидкі дії</h4>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Link
              to="/moderator"
              className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border hover:border-orange-500/50 transition-colors min-w-0"
            >
              <Flag className="h-4 w-4 text-orange-500 shrink-0" />
              <span className="text-sm font-medium text-foreground break-words">Скарги</span>
            </Link>
            <Link
              to="/moderator?tab=disputes"
              className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border hover:border-orange-500/50 transition-colors min-w-0"
            >
              <Scale className="h-4 w-4 text-orange-500 shrink-0" />
              <span className="text-sm font-medium text-foreground break-words">Спори</span>
            </Link>
            <Link
              to="/manager-chats"
              className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border hover:border-orange-500/50 transition-colors min-w-0"
            >
              <MessageSquare className="h-4 w-4 text-orange-500 shrink-0" />
              <span className="text-sm font-medium text-foreground break-words">Чати</span>
            </Link>
            <Link
              to="/support/panel"
              className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border hover:border-orange-500/50 transition-colors min-w-0"
            >
              <LifeBuoy className="h-4 w-4 text-orange-500 shrink-0" />
              <span className="text-sm font-medium text-foreground break-words">Підтримка</span>
            </Link>
            <Link
              to="/support?contact=1"
              className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border hover:border-orange-500/50 transition-colors min-w-0"
            >
              <Headphones className="h-4 w-4 text-orange-500 shrink-0" />
              <span className="text-sm font-medium text-foreground break-words">Підтримка</span>
            </Link>
          </div>
        </div>
      )}

      {/* Authorization Button for Guests */}
      {!isAuthenticated && (
        <div className="space-y-2">
          <p className="text-[11px] leading-snug text-muted-foreground text-center px-1">
            Натискаючи кнопку, ви даєте згоду на обробку персональних даних згідно з законодавством України
          </p>
          <button
            onClick={handleAuthClick}
            disabled={authBusy}
            className="w-full py-4 px-6 bg-gradient-to-r from-primary to-accent text-primary-foreground rounded-xl font-semibold shadow-lg hover:shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-70"
          >
            <User className="h-5 w-5" />
            <span>
              Авторизувати мене
              {authBusy
                ? "..."
                : (() => {
                const tg = (window as any).Telegram?.WebApp;
                if (tg?.initDataUnsafe?.user) {
                  const user = tg.initDataUnsafe.user;
                  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
                  return ` — "${name || user.username || 'Telegram'}"`;
                }
                return ' через Telegram';
              })()}
            </span>
          </button>
        </div>
      )}

      {/* Partner Panel Button - Only for suppliers/admins/moderators */}
      {/* Admin Panel Button - Only for Admins */}
      {isAuthenticated && isAdmin && (
        <button
          onClick={() => navigate("/admin-dashboard")}
          className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all bg-gradient-to-r from-warning/10 to-amber-500/10 border-warning/30 hover:border-warning"
        >
          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-warning/20">
            <Shield className="h-6 w-6 text-warning" />
          </div>
          <div className="flex-1 text-left">
            <h4 className="font-semibold text-foreground">Адмін-панель</h4>
            <p className="text-xs text-muted-foreground">
              Повний контроль платформи
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-warning" />
        </button>
      )}

      {/* Moderator Panel Button - Only for Moderators (not Admins) */}
      {isAuthenticated && isModerator && !isAdmin && (
        <button
          onClick={() => navigate("/moderator")}
          className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all bg-gradient-to-r from-orange-500/10 to-amber-500/10 border-orange-500/30 hover:border-orange-500"
        >
          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-orange-500/20">
            <Flag className="h-6 w-6 text-orange-500" />
          </div>
          <div className="flex-1 text-left">
            <h4 className="font-semibold text-foreground">Панель модератора</h4>
            <p className="text-xs text-muted-foreground">
              Скарги, чати, бонуси
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-orange-500" />
        </button>
      )}

      {/* Support Panel Button - B2B тікети клієнтів (власник/менеджер магазину) */}
      {isAuthenticated && (isOnlySupplier || isShopManager || hasShops) && (
        <button
          onClick={() => {
            hapticSelection();
            navigate("/support/panel");
          }}
          className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all bg-gradient-to-r from-teal-500/10 to-cyan-500/10 border-teal-500/30 hover:border-teal-500"
        >
          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-gradient-to-br from-teal-500/20 to-cyan-500/20">
            <LifeBuoy className="h-6 w-6 text-teal-500" />
          </div>
          <div className="flex-1 text-left">
            <h4 className="font-semibold text-foreground">Підтримка магазинів</h4>
            <p className="text-xs text-muted-foreground">
              Тікети клієнтів, відповіді, AI-звіти
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-teal-500" />
        </button>
      )}

      {/* Store Management Button - For Suppliers, Shop Managers and anyone with shops (owner/manager) */}
      {isAuthenticated && (isOnlySupplier || isShopManager || hasShops) && !isAdmin && (
        <button
          onClick={() => {
            hapticSelection();
            navigate("/my-shops");
          }}
          className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border-emerald-500/30 hover:border-emerald-500"
        >
          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-gradient-to-br from-emerald-500/20 to-teal-500/20">
            <Store className="h-6 w-6 text-emerald-500" />
          </div>
          <div className="flex-1 text-left">
            <h4 className="font-semibold text-foreground">Керування магазинами</h4>
            <p className="text-xs text-muted-foreground">
              {isShopManager || hasShops ? "Замовлення та відгуки магазинів" : "Магазини, замовлення, налаштування"}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-emerald-500" />
        </button>
      )}

      {/* Become Partner Button - Only for users WITHOUT any shops (hide if has shops, even if role is customer) */}
      {isAuthenticated && !isOnlySupplier && !isAdmin && !isModerator && !isShopManager && !hasShops && (
        <button
          onClick={() => navigate("/partner")}
          className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all bg-card border-border hover:border-primary/50"
        >
          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-muted">
            <Store className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="flex-1 text-left">
            <h4 className="font-semibold text-foreground">Стати партнером</h4>
            <p className="text-xs text-muted-foreground">
              Зареєструйтесь як постачальник
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      )}


      {/* Tabs - Only show tabs when authenticated (Orders & Settings only) */}
      {isAuthenticated ? (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full grid grid-cols-2 h-12">
            <TabsTrigger value="orders" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              <span>Замовлення</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <span>Налаштування</span>
            </TabsTrigger>
          </TabsList>

          {/* Orders Tab */}
          <TabsContent value="orders" className="mt-4 space-y-4">
            <OrdersHistory mode="active" />
            
            {/* History button */}
            <button
              onClick={() => {
                hapticSelection();
                navigate("/orders-history");
              }}
              className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all bg-card border-border hover:border-muted-foreground/50"
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-muted">
                <Archive className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 text-left">
                <h4 className="font-medium text-foreground">Історія замовлень</h4>
                <p className="text-xs text-muted-foreground">Завершені, скасовані, обміняні</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="mt-4 space-y-4">
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              {appSettingsButton}
              <Separator />

              <SettingsMenuRow
                icon={User}
                title="Налаштування профілю"
                subtitle={
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Мої дані, адреси доставки
                  </span>
                }
                extra={
                  <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {addresses?.length || 0}
                  </span>
                }
                onClick={() => {
                  hapticSelection();
                  setShowAccountSettings(true);
                }}
              />

              <Separator />
              <SettingsMenuRow
                icon={HelpCircle}
                title="Як користуватись"
                subtitle="Інструкція для покупців"
                onClick={() => setShowCustomerGuide(true)}
              />

              {canSeeSupplierGuide && (
                <>
                  <Separator />
                  <SettingsMenuRow
                    icon={BookOpen}
                    title="Інструкція постачальника"
                    subtitle="Черга, націнки, реклама"
                    onClick={() => setShowSupplierGuide(true)}
                  />
                </>
              )}

              {canSeeModeratorGuide && (
                <>
                  <Separator />
                  <SettingsMenuRow
                    icon={Shield}
                    title="Інструкція модератора"
                    subtitle="Скарги, повернення, чати"
                    onClick={() => setShowModeratorGuide(true)}
                  />
                </>
              )}

              {canSeeManagerGuide && (
                <>
                  <Separator />
                  <SettingsMenuRow
                    icon={Store}
                    title="Інструкція менеджера"
                    subtitle="Замовлення магазину та чати клієнтів"
                    onClick={() => setShowManagerGuide(true)}
                  />
                </>
              )}
            </div>

            {/* Logout */}
            <Button
              variant="destructive"
              className="w-full"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Вийти з акаунту
            </Button>
          </TabsContent>
        </Tabs>
      ) : (
        /* Guest View - Clear distinction from Client */
        <div className="bg-card rounded-xl p-6 border border-dashed border-muted-foreground/30 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-muted/50 mx-auto flex items-center justify-center">
            <User className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <div>
            <div className="inline-flex items-center gap-2 mb-2">
              <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                👤 Гість
              </span>
            </div>
            <h4 className="font-semibold text-foreground">Ви не авторизовані</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Авторизуйтесь через Telegram для доступу до всіх функцій
            </p>
          </div>
          
          {/* What you get with authorization */}
          <div className="grid grid-cols-3 gap-2 pt-2 opacity-50">
            <div className="p-3 bg-muted/50 rounded-lg border border-dashed border-muted-foreground/20">
              <Package className="h-5 w-5 mx-auto text-muted-foreground/50 mb-1" />
              <p className="text-xs text-muted-foreground/70">Замовлення</p>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg border border-dashed border-muted-foreground/20">
              <Gift className="h-5 w-5 mx-auto text-muted-foreground/50 mb-1" />
              <p className="text-xs text-muted-foreground/70">Бонуси</p>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg border border-dashed border-muted-foreground/20">
              <Settings className="h-5 w-5 mx-auto text-muted-foreground/50 mb-1" />
              <p className="text-xs text-muted-foreground/70">Налаштування</p>
            </div>
          </div>

        </div>
      )}
      {!isAuthenticated && (
        <div className="space-y-3">
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {appSettingsButton}
          </div>
          <button
            type="button"
            onClick={() => {
              hapticSelection();
              setShowCustomerGuide(true);
            }}
            className="w-full py-4 px-5 rounded-xl font-semibold shadow-md hover:shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500/15 to-orange-500/15 border border-amber-500/30 text-foreground"
          >
            <span>🛒 Як користуватись Taverna</span>
          </button>
        </div>
      )}

      {/* Modals */}
      <SupplierGuideModal 
        isOpen={showSupplierGuide} 
        onClose={() => setShowSupplierGuide(false)} 
      />
      <CustomerGuideModal 
        isOpen={showCustomerGuide} 
        onClose={() => setShowCustomerGuide(false)} 
      />
      <ModeratorGuideModal
        isOpen={showModeratorGuide}
        onClose={() => setShowModeratorGuide(false)}
      />
      <ManagerGuideModal
        isOpen={showManagerGuide}
        onClose={() => setShowManagerGuide(false)}
      />
      <AppSettingsSheet
        open={showAppSettings}
        onOpenChange={setShowAppSettings}
      />

      {/* Account Settings Modal */}
      {showAccountSettings && (
        <AccountSettings
          profile={profile}
          addresses={addresses || []}
          onBack={() => setShowAccountSettings(false)}
          onUpdateProfile={updateProfile}
          onAddAddress={addAddress}
          onUpdateAddress={updateAddress}
          onDeleteAddress={deleteAddress}
        />
      )}
    </div>
  );
};
