import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Package,
  Gift,
  Settings,
  User,
  Bell,
  ChevronRight,
  LogOut,
  Store,
  HelpCircle,
  BookOpen,
  Users,
  Shield,
  Flag,
  MessageSquare,
  MapPin,
  
  Archive,
  Star,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { OrdersHistory } from "@/components/OrdersHistory";
import { toast } from "sonner";
import { SupplierGuideModal } from "@/components/SupplierGuideModal";
import { CustomerGuideModal } from "@/components/CustomerGuideModal";
import { hapticSelection } from "@/lib/haptics";
import { DevRoleSwitcher } from "@/components/profile/DevRoleSwitcher";
import { AccountSettings } from "@/components/AccountSettings";
import { useBonuses } from "@/hooks/useBonuses";

type TestRole = "guest" | "customer" | "supplier" | "shop_manager" | "moderator" | "admin";

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
    updateProfile,
    addAddress,
    updateAddress,
    deleteAddress
  } = useTelegramAuthContext();
  const [activeTab, setActiveTab] = useState("orders");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [showSupplierGuide, setShowSupplierGuide] = useState(false);
  const [showCustomerGuide, setShowCustomerGuide] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const { reputationScore, balance } = useBonuses();

  const isSupplier = roles.includes('supplier') || roles.includes('admin');
  const isOnlySupplier = roles.includes('supplier');
  const isShopManager = roles.includes('shop_manager');
  const isAdmin = roles.includes('admin');
  const isModerator = roles.includes('moderator');

  useEffect(() => {
    // If we simulate Guest, ensure sensitive modals are closed.
    if (!isAuthenticated) {
      setShowAccountSettings(false);
    }
  }, [isAuthenticated]);


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

  const handleAuthClick = () => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
      // Trigger the auth confirmation dialog
      window.dispatchEvent(new CustomEvent('taverna:request-auth'));
    } else {
      toast.error('Відкрийте додаток через Telegram');
    }
  };

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

      {/* Authorization Button for Guests */}
      {!isAuthenticated && (
        <button
          onClick={handleAuthClick}
          className="w-full py-4 px-6 bg-gradient-to-r from-primary to-accent text-primary-foreground rounded-xl font-semibold shadow-lg hover:shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-3"
        >
          <User className="h-5 w-5" />
          <span>
            Авторизувати мене
            {(() => {
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

      {/* Store Management Button - For Suppliers and Shop Managers */}
      {isAuthenticated && (isOnlySupplier || isShopManager) && !isAdmin && (
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
              {isShopManager ? "Замовлення та відгуки магазинів" : "Магазини, замовлення, налаштування"}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-emerald-500" />
        </button>
      )}

      {/* Become Partner Button - For Customers (not suppliers/admin/moderator/shop_manager) */}
      {isAuthenticated && !isOnlySupplier && !isAdmin && !isModerator && !isShopManager && (
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
              {/* Notifications */}
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">Сповіщення</p>
                    <p className="text-sm text-muted-foreground">
                      Отримувати сповіщення про замовлення
                    </p>
                  </div>
                </div>
                <Switch
                  checked={notificationsEnabled}
                  onCheckedChange={setNotificationsEnabled}
                />
              </div>

              {/* Account Settings Button */}
              <button 
                onClick={() => {
                  hapticSelection();
                  setShowAccountSettings(true);
                }}
                className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <div className="text-left">
                    <p className="font-medium text-foreground">Налаштування профілю</p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      Мої дані, адреси доставки
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {addresses?.length || 0}
                  </span>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </div>
              </button>

              {/* Help Guides */}
              <Separator />
              <button 
                onClick={() => setShowCustomerGuide(true)}
                className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <HelpCircle className="h-5 w-5 text-muted-foreground" />
                  <div className="text-left">
                    <p className="font-medium text-foreground">Як користуватись</p>
                    <p className="text-sm text-muted-foreground">
                      Інструкція для покупців
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>

              {(isSupplier || isAdmin) && (
                <button 
                  onClick={() => setShowSupplierGuide(true)}
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors border-t border-border"
                >
                  <div className="flex items-center gap-3">
                    <BookOpen className="h-5 w-5 text-primary" />
                    <div className="text-left">
                      <p className="font-medium text-foreground">Гід для партнерів</p>
                      <p className="text-sm text-muted-foreground">
                        Черга, націнки, реклама
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-primary" />
                </button>
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

          {/* Help button for guests */}
          <button 
            onClick={() => setShowCustomerGuide(true)}
            className="w-full flex items-center justify-center gap-2 p-3 bg-muted/50 rounded-xl text-muted-foreground hover:bg-muted transition-colors"
          >
            <HelpCircle className="h-4 w-4" />
            <span className="text-sm font-medium">Як користуватись Taverna</span>
          </button>
        </div>
      )}
      
      {/* Moderator Quick Actions - Only for moderators */}
      {isAuthenticated && isModerator && !isAdmin && (
        <div className="bg-orange-500/5 rounded-xl border border-orange-500/20 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-orange-500" />
            <h4 className="font-semibold text-foreground">Швидкі дії модератора</h4>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Link
              to="/moderator"
              className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border hover:border-orange-500/50 transition-colors"
            >
              <Flag className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-medium text-foreground">Скарги</span>
            </Link>
            <Link
              to="/support"
              className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border hover:border-orange-500/50 transition-colors"
            >
              <MessageSquare className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-medium text-foreground">Чати</span>
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            ⚠️ Акції, бонуси та розіграші потребують підтвердження адміна
          </p>
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
