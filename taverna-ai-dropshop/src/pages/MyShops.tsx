import { useState, useEffect, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Store, Plus, Package, Settings, Users, LifeBuoy, Wallet,
  TrendingUp, Megaphone, Send, Loader2, Trash2,
  Eye, Gift, Trophy, ThumbsUp, MessageCircle, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { toast } from "sonner";
import { hapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import {
  BackendApiError,
  getMyShops,
  requestSupplierDeletion,
} from "@/lib/backendApi";

interface ShopInfo {
  id: string;
  shop_name: string;
  logo_url: string | null;
  cover_image_url: string | null;
  is_active: boolean;
  product_count: number;
  review_count: number;
  role: "owner" | "manager";
  supplier_type?: string | null;
  status?: string;
  completed_products?: number;
  deletion_requested?: boolean;
  /** RBAC: права менеджера в цьому магазині (для власника — null, тобто можна все). */
  permissions?: {
    can_edit_info: boolean;
    can_manage_products: boolean;
    can_view_balance: boolean;
    can_resolve_disputes: boolean;
  } | null;
}

function supplierStatusLabel(status?: string) {
  switch (status) {
    case "active":
      return "Активний";
    case "deletion_requested":
      return "Заявка на видалення";
    case "deleted":
      return "Видалено";
    case "banned":
      return "Заблоковано";
    case "pending_admin_approval":
      return "На модерації";
    case "pending_ai_analysis":
    case "ai_in_progress":
      return "AI-аналіз";
    case "rejected":
      return "Відхилено";
    case "disabled":
      return "Вимкнено";
    default:
      return status || "—";
  }
}

function supplierTypeLabel(type?: string | null) {
  if (type === "business") return "ТОВ / юр. особа";
  if (type === "individual") return "ФОП";
  return type || null;
}

const isLovableDevEnvironment = () => {
  try {
    return window.location.hostname.includes('lovable.app') ||
           window.location.hostname.includes('lovableproject.com') ||
           window.location.hostname.includes('id-preview--');
  } catch {
    return false;
  }
};

/**
 * Картка магазину за UX-макетом:
 *
 * ┌──────────────────────────────────┐
 * │ ХЕДЕР: cover-банер + градієнт     │
 * │ [Avatar] Назва [Роль]    7 8 9 10 │ ← міні-іконки (Gift/Trophy/ThumbsUp/MessageCircle)
 * │ Статус, товари                    │
 * ├──────────────────────────────────┤
 * │ grid-cols-2:                      │
 * │ [1 Керування]  [3 Баланс]         │
 * │ [2 Просування] [4 Менеджери]     │
 * ├──────────────────────────────────┤
 * │ [5 Замовлення / Комунікація] w-full│
 * └──────────────────────────────────┘
 */
function StoreCard({
  shop,
  canEdit,
  canViewBalance,
  onView,
  onSettings,
  onManagers,
  onSupport,
  onWallet,
  onPromo,
  onDelete,
  onMiniIcon,
}: {
  shop: ShopInfo;
  canEdit: boolean;
  canViewBalance: boolean;
  onView: (shop: ShopInfo) => void;
  onSettings: (shop: ShopInfo) => void;
  onManagers: (shop: ShopInfo) => void;
  onSupport: (shop: ShopInfo) => void;
  onWallet: (shop: ShopInfo) => void;
  onPromo: (shop: ShopInfo) => void;
  onDelete: (shop: ShopInfo) => void;
  /** Міні-іконки хедера: bonuses / rating / reviews → свій маршрут на магазин. */
  onMiniIcon: (target: "bonuses" | "rating" | "reviews", shop: ShopInfo) => void;
}) {
  /** Міні-іконка без тексту (кнопки 7–10 у хедері картки). */
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

  /** Кнопка тіла картки для grid-cols-2 (кнопки 1–4). */
  const GridAction = ({
    icon: Icon,
    label,
    onClick,
    disabled = false,
    className,
  }: {
    icon: ComponentType<{ className?: string }>;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      className={cn("h-9 justify-start gap-2 px-3 text-xs font-medium", className)}
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
    <Card className="overflow-hidden">
      {/* === 1. ХЕДЕР: cover-банер з градієнтом, клік → сторінка магазину === */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onView(shop)}
        onKeyDown={(e) => e.key === "Enter" && onView(shop)}
        className="relative h-28 w-full overflow-hidden cursor-pointer group"
      >
        {shop.cover_image_url ? (
          <img
            src={shop.cover_image_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-r from-primary/40 via-primary/20 to-accent/40" />
        )}
        {/* Темний градієнт для читабельності тексту */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/30 pointer-events-none" />

        {/* Міні-іконки справа зверху (кнопки 7, 8, 9, 10) */}
        <div className="absolute top-2 right-2 z-10 flex gap-1.5">
          <HeaderIconButton icon={Gift} title="Бонуси магазину" onClick={() => onMiniIcon("bonuses", shop)} />
          <HeaderIconButton icon={Trophy} title="Рейтинг магазину" onClick={() => onMiniIcon("rating", shop)} />
          <HeaderIconButton icon={ThumbsUp} title="Оцінка" onClick={() => onMiniIcon("rating", shop)} />
          <HeaderIconButton icon={MessageCircle} title="Відгуки" onClick={() => onMiniIcon("reviews", shop)} />
        </div>

        {/* Кнопка 6: Eye (Перегляд магазину) — явна іконка перегляду */}
        <button
          type="button"
          title="Перегляд магазину"
          aria-label="Перегляд магазину"
          onClick={(e) => {
            e.stopPropagation();
            hapticSelection();
            onView(shop);
          }}
          className="absolute bottom-2 right-12 z-10 h-8 w-8 rounded-full bg-white/20 backdrop-blur-sm text-white
                     flex items-center justify-center hover:bg-white/40 transition-colors"
        >
          <Eye className="h-4 w-4" />
        </button>

        {/* Видалення магазину (заявка адміну) — лише власник, праворуч знизу хедера */}
        {shop.role === "owner" && (
          <button
            type="button"
            title={shop.deletion_requested ? "Заявку на видалення вже надіслано" : "Видалити магазин"}
            disabled={shop.deletion_requested}
            onClick={(e) => {
              e.stopPropagation();
              hapticSelection();
              onDelete(shop);
            }}
            className="absolute bottom-2 right-2 z-10 h-8 w-8 rounded-full bg-black/40 backdrop-blur-sm text-white
                       flex items-center justify-center hover:bg-destructive/80 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}

        {/* Аватар + назва + роль (зліва внизу хедера) */}
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2.5 min-w-0 pr-2">
          <Avatar className="h-11 w-11 rounded-xl border-2 border-white/70 shrink-0">
            <AvatarImage src={shop.logo_url || undefined} alt={shop.shop_name} />
            <AvatarFallback className="rounded-xl bg-primary text-primary-foreground font-bold">
              {shop.shop_name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="font-semibold text-white text-sm truncate drop-shadow">
                {shop.shop_name}
              </h3>
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 shrink-0 bg-white/20 text-white border-0"
              >
                {shop.role === "owner" ? "Власник" : "Менеджер"}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/80 mt-0.5">
              {supplierTypeLabel(shop.supplier_type) && (
                <span>{supplierTypeLabel(shop.supplier_type)}</span>
              )}
              <span className="flex items-center gap-1">
                <Package className="h-3 w-3" />
                {typeof shop.completed_products === "number"
                  ? `${shop.completed_products}/${shop.product_count}`
                  : `${shop.product_count} тов.`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Статус магазину (стрічка під хедером) */}
      <div className="px-3 pt-2 flex flex-wrap items-center gap-2">
        <Badge variant={shop.is_active ? "default" : "secondary"} className="text-[10px]">
          {supplierStatusLabel(shop.status) || (shop.is_active ? "Активний" : "Неактивний")}
        </Badge>
        {shop.deletion_requested && (
          <Badge variant="destructive" className="text-[10px]">
            Заявка на видалення
          </Badge>
        )}
      </div>

      {/* === 2. ТІЛО: grid-cols-2 з 4 кнопок (кнопки 1–4) === */}
      <div className="grid grid-cols-2 gap-2 p-3">
        {/* Кнопка 1 (зліва зверху): Керування (Settings) — owner або manager з can_edit_info */}
        <GridAction
          icon={Settings}
          label="Керування"
          onClick={() => onSettings(shop)}
          disabled={!canEdit}
        />
        {/* Кнопка 3 (справа зверху): Баланс (Wallet) — owner або manager з can_view_balance */}
        <GridAction icon={Wallet} label="Баланс" onClick={() => onWallet(shop)} disabled={!canViewBalance} />
        {/* Кнопка 2 (зліва знизу): Просування (TrendingUp) */}
        <GridAction icon={TrendingUp} label="Просування" onClick={() => onPromo(shop)} />
        {/* Кнопка 4 (справа знизу): Менеджери — власник; «Для мене» — менеджер
            (дивиться власні права + інструкцію) */}
        <GridAction
          icon={shop.role === "manager" ? User : Users}
          label={shop.role === "manager" ? "Для мене" : "Менеджери"}
          onClick={() => onManagers(shop)}
        />
      </div>

      {/* === 3. ФУТЕР: Замовлення / Комунікація на всю ширину (кнопка 5) === */}
      <div className="px-3 pb-3">
        <Button
          size="sm"
          className="w-full h-9 justify-start gap-2 px-3 text-xs font-medium"
          onClick={(e) => {
            e.stopPropagation();
            hapticSelection();
            onSupport(shop);
          }}
        >
          <LifeBuoy className="h-4 w-4 shrink-0" />
          <span>Замовлення / Комунікація</span>
        </Button>
      </div>
    </Card>
  );
}

export default function MyShops() {
  const navigate = useNavigate();
  const { effectiveRole, profile } = useTelegramAuthContext();
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [promoShopId, setPromoShopId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteShop, setDeleteShop] = useState<ShopInfo | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [isSubmittingDeletion, setIsSubmittingDeletion] = useState(false);

  const isSupplier = effectiveRole === "supplier";
  const isShopManager = effectiveRole === "shop_manager";
  const isAdmin = effectiveRole === "admin";

  const openPromotion = (tab: "posting" | "advertising") => {
    if (!promoShopId) return;
    hapticSelection();
    navigate(`/manager?shop=${promoShopId}&tab=${tab}&step=2`);
    setPromoShopId(null);
  };

  useEffect(() => {
    fetchShops();
  }, [effectiveRole, profile?.id]);

  const fetchShops = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setIsLoading(true);
    try {
      const response = await getMyShops();
      setShops(
        response.map((shop) => ({
          id: String(shop.id),
          shop_name: shop.store_name,
          logo_url: shop.logo_url || null,
          cover_image_url: shop.cover_image_url || null,
          is_active: shop.is_active,
          product_count: shop.product_count || 0,
          review_count: 0,
          role: shop.role === "manager" ? "manager" : "owner",
          supplier_type: shop.supplier_type,
          status: shop.status,
          completed_products: shop.completed_products,
          deletion_requested: shop.deletion_requested,
          permissions: shop.permissions ?? null,
        }))
      );
    } catch (err) {
      console.error("Error fetching shops:", err);
      toast.error("Помилка завантаження магазинів");
    } finally {
      setIsLoading(false);
    }
  };

  // RBAC: «Керування» — власнику або менеджеру з правом can_edit_info
  const canEditShop = (shop: ShopInfo) => {
    if (shop.role === "owner") return true;
    if (isLovableDevEnvironment() && isSupplier) return true;
    return shop.role === "manager" && shop.permissions?.can_edit_info === true;
  };

  // RBAC: «Баланс» — власнику або менеджеру з правом can_view_balance
  const canViewWallet = (shop: ShopInfo) => {
    if (shop.role === "owner") return true;
    return shop.role === "manager" && shop.permissions?.can_view_balance === true;
  };

  const openDeleteDialog = (shop: ShopInfo) => {
    setDeleteShop(shop);
    setDeleteReason("");
    setDeleteOpen(true);
  };

  const submitDeletion = async () => {
    const reason = deleteReason.trim();
    if (reason.length < 3) {
      toast.error("Вкажіть причину видалення (обов'язково)");
      return;
    }
    setIsSubmittingDeletion(true);
    try {
      await requestSupplierDeletion(reason);
      hapticSelection();
      toast.success("Заявка на видалення надіслана адміністратору");
      setDeleteOpen(false);
      setDeleteReason("");
      setDeleteShop(null);
      await fetchShops();
    } catch (error) {
      const message =
        error instanceof BackendApiError ? error.message : "Не вдалося надіслати заявку";
      toast.error(message);
    } finally {
      setIsSubmittingDeletion(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                hapticSelection();
                navigate("/?tab=account");
              }}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="font-bold text-lg text-slate-900 dark:text-white">Керування магазинами</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isShopManager ? "Магазини, якими ви керуєте" : "Ваші магазини та партнерства"}
              </p>
            </div>
          </div>
          {/* Primary кнопка: створення/реєстрація нового магазину */}
          {(isSupplier || isAdmin) && (
            <Button
              size="sm"
              className="shrink-0"
              onClick={() => {
                hapticSelection();
                navigate("/partner");
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Додати магазин
            </Button>
          )}
        </div>
      </div>

      <div className="p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : shops.length === 0 ? (
          <div className="text-center py-12 space-y-4">
            <div className="w-16 h-16 rounded-full bg-muted/50 mx-auto flex items-center justify-center">
              <Store className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <div>
              <h4 className="font-semibold text-slate-900 dark:text-white">Магазинів ще немає</h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {isShopManager
                  ? "Вас ще не призначено менеджером жодного магазину"
                  : "Зареєструйте свій перший магазин"}
              </p>
            </div>
            {(isSupplier || isAdmin) && (
              <Button onClick={() => navigate("/partner")}>
                <Plus className="h-4 w-4 mr-2" />
                Зареєструвати магазин
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4 overflow-y-auto pb-20">
            {shops.map((shop) => (
              <StoreCard
                key={shop.id}
                shop={shop}
                canEdit={canEditShop(shop)}
                canViewBalance={canViewWallet(shop)}
                // Клік по хедеру картки → сторінка магазину /supplier/{id}
                onView={(item) => {
                  hapticSelection();
                  navigate(`/supplier/${item.id}`);
                }}
                // Кнопка 1: Керування → форма редагування магазину
                onSettings={(item) => {
                  hapticSelection();
                  navigate(`/store-management/${item.id}`);
                }}
                // Кнопка 4: Менеджери (owner) / «Для мене» (manager)
                onManagers={(item) => {
                  hapticSelection();
                  navigate(`/store-managers/${item.id}`);
                }}
                // Кнопка 5: Замовлення / Комунікація
                onSupport={() => {
                  hapticSelection();
                  navigate("/support/panel");
                }}
                // Кнопка 3: Баланс магазину
                onWallet={(item) => {
                  hapticSelection();
                  navigate(`/wallet/${item.id}`);
                }}
                // Кнопка 2: Просування — вибір каналу
                onPromo={(item) => {
                  hapticSelection();
                  setPromoShopId(item.id);
                }}
                // Міні-іконки хедера → маршрути конкретного магазину
                onMiniIcon={(target, item) => {
                  hapticSelection();
                  navigate(`/supplier/${item.id}/${target}`);
                }}
                onDelete={openDeleteDialog}
              />
            ))}
          </div>
        )}
      </div>

      {/* Promotion channel chooser */}
      <Dialog open={!!promoShopId} onOpenChange={(open) => !open && setPromoShopId(null)}>
        <DialogContent className="sm:max-w-[380px] mx-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary" />
              Оберіть напрямок
            </DialogTitle>
            <DialogDescription>
              Магазин уже вибрано — далі оберіть товари для просування.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              onClick={() => openPromotion("posting")}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 hover:border-primary hover:bg-primary/5 transition-all"
            >
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Send className="h-6 w-6 text-primary" />
              </div>
              <span className="font-semibold text-sm text-foreground">Постинг</span>
              <span className="text-[11px] text-muted-foreground text-center leading-tight">
                Публікація на платформах
              </span>
            </button>
            <button
              onClick={() => openPromotion("advertising")}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 hover:border-primary hover:bg-primary/5 transition-all"
            >
              <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
                <Megaphone className="h-6 w-6 text-warning" />
              </div>
              <span className="font-semibold text-sm text-foreground">Реклама</span>
              <span className="text-[11px] text-muted-foreground text-center leading-tight">
                Платні кампанії з бюджетом
              </span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete request dialog */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!isSubmittingDeletion) {
            setDeleteOpen(open);
            if (!open) {
              setDeleteReason("");
              setDeleteShop(null);
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-[400px] mx-4">
          <DialogHeader>
            <DialogTitle className="text-slate-900 dark:text-white">Видалити магазин</DialogTitle>
            <DialogDescription className="text-slate-500 dark:text-slate-400">
              Магазин не зникне одразу. Адміністратор отримає заявку і перевірить її вручну.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="deletion-reason" className="text-slate-800 dark:text-slate-200">
              Вкажіть причину видалення (обов'язково)
            </Label>
            <Textarea
              id="deletion-reason"
              value={deleteReason}
              onChange={(event) => setDeleteReason(event.target.value)}
              placeholder="Наприклад: закриваю магазин / змінюю постачальника"
              rows={4}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={isSubmittingDeletion}
            >
              Скасувати
            </Button>
            <Button
              variant="destructive"
              onClick={submitDeletion}
              disabled={isSubmittingDeletion || deleteReason.trim().length < 3}
            >
              {isSubmittingDeletion ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : null}
              Надіслати запит на видалення
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
