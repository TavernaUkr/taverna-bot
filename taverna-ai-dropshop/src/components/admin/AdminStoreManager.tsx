import { useState, useEffect, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import {
  Store, Settings, Loader2, UserPlus, Send, Shield, Eye,
  Package, Crown, Users, Wallet, AlertTriangle,
  LifeBuoy, TrendingUp, Gift, Trophy, ThumbsUp, MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useToast } from "@/hooks/use-toast";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { hapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { BackendApiError, fetchAdminStores, transferSupplierOwnership } from "@/lib/backendApi";

interface AdminSupplier {
  id: string;
  shop_name: string;
  company_name: string;
  contact_name: string;
  is_active: boolean;
  markup_percentage: number | null;
  created_at: string;
  logo_url: string | null;
  cover_image_url: string | null;
  manager_telegram: string | null;
  allow_bot_chat: boolean | null;
  tax_code: string | null;
  xml_url: string | null;
  description: string | null;
  product_count?: number;
  user_id?: number | null;
  telegram_id?: number | null;
}

export function AdminStoreManager({ filter = 'all' }: { filter?: 'all' | 'partners' | 'my' }) {
  const navigate = useNavigate();
  const { toast: uiToast } = useToast();
  const { profile } = useTelegramAuthContext();
  const [suppliers, setSuppliers] = useState<AdminSupplier[]>([]);
  const [mySupplierIds, setMySupplierIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [transferDialog, setTransferDialog] = useState<{ supplier: AdminSupplier } | null>(null);
  const [transferUsername, setTransferUsername] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);

  const adminTelegramId =
    profile?.telegram_id ||
    (typeof window !== "undefined"
      ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id
      : null);

  useEffect(() => {
    fetchSuppliers();
  }, [filter, adminTelegramId]);

  const fetchSuppliers = async () => {
    setIsLoading(true);
    try {
      const rows = await fetchAdminStores(
        adminTelegramId ? Number(adminTelegramId) : undefined
      );
      const allSuppliers: AdminSupplier[] = rows.map((row) => ({
        id: String(row.id),
        shop_name: row.shop_name,
        company_name: row.company_name || "",
        contact_name: row.contact_name || "",
        is_active: row.is_active,
        markup_percentage: row.markup_percentage ?? null,
        created_at: row.created_at || "",
        logo_url: row.logo_url || null,
        cover_image_url: row.cover_image_url || null,
        manager_telegram: row.manager_telegram || null,
        allow_bot_chat: null,
        tax_code: null,
        xml_url: row.xml_url || null,
        description: row.description || null,
        product_count: row.product_count || 0,
        user_id: row.user_id ?? null,
        telegram_id: row.telegram_id ?? null,
      }));

      const myIdsSet = new Set<string>();
      const adminTg = adminTelegramId ? Number(adminTelegramId) : null;
      allSuppliers.forEach((supplier) => {
        const isAdminOwned =
          supplier.user_id == null ||
          (adminTg != null && Number(supplier.telegram_id) === adminTg);
        if (isAdminOwned) myIdsSet.add(supplier.id);
      });

      const myIds = Array.from(myIdsSet);
      setMySupplierIds(myIds);

      const filteredSuppliers = allSuppliers.filter((supplier) => {
        if (filter === "my") return myIdsSet.has(supplier.id);
        if (filter === "partners") return !myIdsSet.has(supplier.id);
        return true;
      });

      setSuppliers(filteredSuppliers);
    } catch (err) {
      console.error("Error fetching suppliers:", err);
      toast.error("Помилка завантаження магазинів");
      setSuppliers([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTransferOwnership = async () => {
    if (!transferDialog || !transferUsername.trim()) {
      uiToast({
        variant: "destructive",
        title: "Вкажіть @username користувача Telegram",
      });
      return;
    }

    setIsTransferring(true);
    try {
      await transferSupplierOwnership(
        Number(transferDialog.supplier.id),
        transferUsername.trim(),
        adminTelegramId ? Number(adminTelegramId) : undefined
      );
      uiToast({
        title: "Права передано",
        className: "bg-green-600 text-white border-green-700",
      });
      setTransferDialog(null);
      setTransferUsername("");
      await fetchSuppliers();
    } catch (err: any) {
      console.error("Transfer error:", err);
      if (err instanceof BackendApiError && err.status === 404) {
        uiToast({
          variant: "destructive",
          title: "Користувача не знайдено",
        });
        return;
      }
      uiToast({
        variant: "destructive",
        title: err.message || "Помилка передачі магазину",
      });
    } finally {
      setIsTransferring(false);
    }
  };

  const handleToggleStatus = async (supplier: AdminSupplier) => {
    try {
      const { error } = await supabase
        .from("suppliers")
        .update({ is_active: !supplier.is_active } as any)
        .eq("id", supplier.id);
      if (error) throw error;
      toast.success(supplier.is_active ? "Магазин деактивовано" : "Магазин активовано");
      fetchSuppliers();
    } catch (err) {
      toast.error("Помилка зміни статусу");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isMyStores = filter === 'my';
  const isPartners = filter === 'partners';

  const infoText = isMyStores
    ? "Магазини, які ви додали через «+ Додати» або закріплені за вами. Ви маєте повний контроль: налаштування, товари, замовлення."
    : isPartners
    ? "Партнерські магазини (самореєстрація або передані права). Доступ лише для перегляду та активації/деактивації."
    : "Всі магазини платформи. Повне керування доступне лише для ваших магазинів.";

  /** Міні-іконка без тексту (аналогічно MyShops, кнопки 7–10). */
  const HeaderIconButton = ({
    icon: Icon,
    title,
    onClick,
  }: {
    icon: ComponentType<{ className?: string }>;
    title: string;
    onClick: () => void;
  }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        hapticSelection();
        onClick();
      }}
      className="h-8 w-8 shrink-0 rounded-full bg-black/40 backdrop-blur-sm text-white
                 flex items-center justify-center hover:bg-black/60 transition-colors"
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  /** Кнопка grid-cols-2 тіла картки (кнопки 1–4). */
  const GridAction = ({
    icon: Icon,
    label,
    onClick,
    disabled = false,
  }: {
    icon: ComponentType<{ className?: string }>;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      className={cn("h-9 justify-start gap-2 px-3 text-xs font-medium")}
      onClick={(e) => {
        e.stopPropagation();
        hapticSelection();
        onClick();
      }}
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <span className="truncate">{label}</span>
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600 dark:text-slate-300">{suppliers.length} магазинів</p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            {isMyStores ? <Crown className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" /> :
             isPartners ? <Users className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" /> :
             <Shield className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />}
            <p className="text-xs text-slate-600 dark:text-slate-300">{infoText}</p>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-y-auto pb-24">
        <div className="space-y-3 pr-4 pb-24">
          {suppliers.length === 0 ? (
            <div className="text-center py-12">
              <Store className="h-12 w-12 text-slate-400 dark:text-slate-500 mx-auto mb-4" />
              <p className="font-semibold text-slate-900 dark:text-white">
                {isMyStores ? "У вас немає власних магазинів" : isPartners ? "Партнерських магазинів немає" : "Магазинів ще немає"}
              </p>
              {isMyStores && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Створіть магазин через вкладку «+ Додати»
                </p>
              )}
              {isPartners && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Партнерські магазини з'являться тут після реєстрації або передачі прав
                </p>
              )}
              {!isMyStores && !isPartners && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Зареєструйте свій перший магазин
                </p>
              )}
            </div>
          ) : (
            suppliers.map((supplier) => {
              const isMine = mySupplierIds.includes(supplier.id);
              return (
              <Card key={supplier.id} className="overflow-hidden">
                {/* === ХЕДЕР: cover-банер з градієнтом (як у MyShops) === */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/supplier/${supplier.id}`)}
                  onKeyDown={(e) => e.key === "Enter" && navigate(`/supplier/${supplier.id}`)}
                  className="relative h-28 w-full overflow-hidden cursor-pointer group"
                >
                  {supplier.cover_image_url ? (
                    <img
                      src={supplier.cover_image_url}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-r from-primary/40 via-primary/20 to-accent/40" />
                  )}
                  {/* Темний градієнт для читабельності */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/30 pointer-events-none" />

                  {/* Міні-іконки (7, 8, 9, 10) — як у MyShops */}
                  <div className="absolute top-2 right-2 z-10 flex gap-1.5">
                    <HeaderIconButton icon={Gift} title="Бонуси" onClick={() => navigate(`/supplier/${supplier.id}`)} />
                    <HeaderIconButton icon={Trophy} title="Рейтинг" onClick={() => navigate(`/ratings`)} />
                    <HeaderIconButton icon={ThumbsUp} title="Оцінка" onClick={() => navigate(`/supplier/${supplier.id}`)} />
                    <HeaderIconButton icon={MessageCircle} title="Відгуки" onClick={() => navigate(`/supplier/${supplier.id}`)} />
                  </div>

                  {/* Кнопка 6: Eye (Перегляд магазину) — як у MyShops */}
                  <button
                    type="button"
                    title="Перегляд магазину"
                    aria-label="Перегляд магазину"
                    onClick={(e) => {
                      e.stopPropagation();
                      hapticSelection();
                      navigate(`/supplier/${supplier.id}`);
                    }}
                    className="absolute bottom-3 right-14 z-10 h-8 w-8 rounded-full bg-white/20 backdrop-blur-sm text-white
                               flex items-center justify-center hover:bg-white/40 transition-colors"
                  >
                    <Eye className="h-4 w-4" />
                  </button>

                  {/* Перемикач статусу (admin-specific) */}
                  <div className="absolute bottom-2 right-2 z-10 flex items-center gap-2">
                    <Switch
                      checked={supplier.is_active}
                      onCheckedChange={() => handleToggleStatus(supplier)}
                    />
                  </div>

                  {/* Аватар + назва + бейдж власника */}
                  <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2.5 min-w-0 pr-2">
                    <Avatar className="h-11 w-11 rounded-xl border-2 border-white/70 shrink-0">
                      <AvatarImage src={supplier.logo_url || ""} />
                      <AvatarFallback className="rounded-xl bg-primary text-primary-foreground font-bold">
                        {supplier.shop_name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-semibold text-white text-sm truncate drop-shadow">
                          {supplier.shop_name}
                        </h3>
                        {isMine && (
                          <Crown className="h-3.5 w-3.5 text-warning flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-[11px] text-white/80 mt-0.5 truncate">
                        {supplier.company_name || supplier.contact_name || ""}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Статус-стрічка під хедером */}
                <div className="px-3 pt-2 flex flex-wrap items-center gap-2">
                  <Badge variant={supplier.is_active ? "default" : "secondary"} className="text-[10px]">
                    {supplier.is_active ? "Активний" : "Неактивний"}
                  </Badge>
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Package className="h-3 w-3" />
                    {supplier.product_count || 0} товарів
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Націнка: {supplier.markup_percentage || 33}%
                  </span>
                </div>

                {/* === ТІЛО: grid-cols-2 (кнопки 1–4) — лише для СВОЇХ магазинів === */}
                {isMyStores || (filter === 'all' && isMine) ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 p-3">
                      {/* Кнопка 1 (зліва зверху): Керування */}
                      <GridAction
                        icon={Settings}
                        label="Керування"
                        onClick={() => navigate(`/store-management/${supplier.id}`)}
                      />
                      {/* Кнопка 3 (справа зверху): Баланс */}
                      <GridAction
                        icon={Wallet}
                        label="Баланс"
                        onClick={() => navigate(`/wallet/${supplier.id}`)}
                      />
                      {/* Кнопка 2 (зліва знизу): Просування */}
                      <GridAction
                        icon={TrendingUp}
                        label="Просування"
                        onClick={() => navigate(`/manager?shop=${supplier.id}&step=2`)}
                      />
                      {/* Кнопка 4 (справа знизу): Менеджери */}
                      <GridAction
                        icon={Users}
                        label="Менеджери"
                        onClick={() => navigate(`/store-managers/${supplier.id}`)}
                      />
                    </div>

                    {/* === ФУТЕР: адмін-специфічні дії === */}
                    <div className="px-3 pb-3 space-y-2">
                      {/* Кнопка 5: Замовлення / Комунікація — на всю ширину */}
                      <Button
                        size="sm"
                        className="w-full h-9 justify-start gap-2 px-3 text-xs font-medium"
                        onClick={() => navigate("/support/panel")}
                      >
                        <LifeBuoy className="h-4 w-4 shrink-0" />
                        <span>Замовлення / Комунікація</span>
                      </Button>

                      {/* Кнопка 6: Передати права (лише адмін-функціонал) */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full h-9 justify-start gap-2 px-3 text-xs font-medium border-indigo-300 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
                        onClick={() => { setTransferDialog({ supplier }); setTransferUsername(""); }}
                      >
                        <UserPlus className="h-4 w-4 shrink-0" />
                        <span>Передати права</span>
                      </Button>
                    </div>
                  </>
                ) : (
                  /* Партнерські: лише перегляд */
                  <div className="grid grid-cols-2 gap-2 p-3">
                    <GridAction
                      icon={Eye}
                      label="Переглянути"
                      onClick={() => navigate(`/supplier/${supplier.id}`)}
                    />
                    <GridAction
                      icon={Wallet}
                      label="Рахунок"
                      onClick={() => navigate(`/wallet/${supplier.id}`)}
                    />
                  </div>
                )}
              </Card>
              );
            })
          )}
        </div>
      </div>

      {/* Transfer Ownership Dialog */}
      <Dialog open={!!transferDialog} onOpenChange={() => { if (!isTransferring) setTransferDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-indigo-600" />
              Передача прав на магазин
            </DialogTitle>
            <DialogDescription>
              Введіть @username користувача Telegram, якому хочете передати цей магазин. Користувач повинен мати аккаунт у боті.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-destructive">Увага! Ця дія незворотна</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Після передачі ви втратите право керування цим магазином.
                    Новий власник отримає повний контроль.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Telegram username</Label>
              <Input
                value={transferUsername}
                onChange={e => setTransferUsername(e.target.value)}
                placeholder="@username"
                autoComplete="off"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialog(null)} disabled={isTransferring}>Скасувати</Button>
            <Button
              onClick={handleTransferOwnership}
              disabled={isTransferring || !transferUsername.trim()}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {isTransferring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Передати
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
