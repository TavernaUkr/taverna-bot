import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Store, Plus, Package, Settings,
  Loader2, Star, ShoppingCart, MessageSquare, Megaphone, Send, Wallet, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { toast } from "sonner";
import { hapticSelection } from "@/lib/haptics";
import {
  BackendApiError,
  fetchMySupplier,
  requestSupplierDeletion,
} from "@/lib/backendApi";

interface ShopInfo {
  id: string;
  shop_name: string;
  logo_url: string | null;
  is_active: boolean;
  product_count: number;
  review_count: number;
  role: "owner" | "manager";
  supplier_type?: string | null;
  status?: string;
  completed_products?: number;
  deletion_requested?: boolean;
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

export default function MyShops() {
  const navigate = useNavigate();
  const { effectiveRole, profile } = useTelegramAuthContext();
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [promoShopId, setPromoShopId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
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

  const fetchShops = async () => {
    setIsLoading(true);
    try {
      const allShops: ShopInfo[] = [];

      if (isSupplier || isAdmin) {
        const mine = await fetchMySupplier();
        if (mine?.store_name) {
          allShops.push({
            id: String(mine.id),
            shop_name: mine.store_name,
            logo_url: null,
            is_active: mine.status === "active",
            product_count: mine.product_count || 0,
            review_count: 0,
            role: "owner",
            supplier_type: mine.supplier_type,
            status: mine.status,
            completed_products: mine.completed_products,
            deletion_requested: mine.deletion_requested,
          });
        }
      }

      // Магазини, де користувач — менеджер (поки ще з Supabase-зв'язок)
      if (profile?.id && isShopManager) {
        const { data: links } = await supabase
          .from("shop_manager_links")
          .select("supplier_id")
          .eq("profile_id", profile.id);

        if (links?.length) {
          const supplierIds = links.map((l) => l.supplier_id);
          const existingIds = new Set(allShops.map((s) => s.id));
          const newIds = supplierIds.filter((id) => !existingIds.has(id));

          if (newIds.length) {
            const { data: managedShops } = await supabase
              .from("suppliers")
              .select("id, shop_name, logo_url, is_active")
              .in("id", newIds);

            if (managedShops) {
              for (const shop of managedShops) {
                const { count: productCount } = await supabase
                  .from("products")
                  .select("*", { count: "exact", head: true })
                  .eq("supplier_id", shop.id);

                allShops.push({
                  ...shop,
                  product_count: productCount || 0,
                  review_count: 0,
                  role: "manager",
                });
              }
            }
          }
        }
      }

      // DEV FALLBACK: In Lovable dev environment, if no managed shops found for
      // shop_manager test role, fetch a couple active suppliers as mock "manager"
      // shops so promotion buttons can be tested.
      if (allShops.length === 0 && isLovableDevEnvironment() && isShopManager) {
        const { data: devShops } = await supabase
          .from("suppliers")
          .select("id, shop_name, logo_url, is_active")
          .eq("is_active", true)
          .limit(2);

        if (devShops) {
          for (const shop of devShops) {
            const { count: productCount } = await supabase
              .from("products")
              .select("*", { count: "exact", head: true })
              .eq("supplier_id", shop.id);

            allShops.push({
              ...shop,
              product_count: productCount || 0,
              review_count: 0,
              role: "manager",
            });
          }
        }
      }

      setShops(allShops);
    } catch (err) {
      console.error("Error fetching shops:", err);
      toast.error("Помилка завантаження магазинів");
    } finally {
      setIsLoading(false);
    }
  };

  // Show gear icon for owners, or in dev environment for supplier test role
  const canEditShop = (shop: ShopInfo) => {
    if (shop.role === "owner") return true;
    if (isLovableDevEnvironment() && isSupplier) return true;
    return false;
  };

  const openDeleteDialog = () => {
    hapticSelection();
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
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
            <div>
              <h1 className="font-bold text-lg text-foreground">Керування магазинами</h1>
              <p className="text-xs text-muted-foreground">
                {isShopManager ? "Магазини, якими ви керуєте" : "Ваші магазини та партнерства"}
              </p>
            </div>
          </div>
          {(isSupplier || isAdmin) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                hapticSelection();
                navigate("/partner?mode=additional");
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Додати
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4 pb-24">
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
              <h4 className="font-semibold text-foreground">Магазинів ще немає</h4>
              <p className="text-sm text-muted-foreground mt-1">
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
          shops.map((shop) => (
            <Card key={shop.id} className="overflow-hidden">
              <CardContent className="p-4">
                {/* Header row: avatar + name + badge + gear icon */}
                <div className="flex items-start gap-3 mb-3">
                  <Avatar className="h-14 w-14 rounded-xl">
                    <AvatarImage src={shop.logo_url || undefined} alt={shop.shop_name} />
                    <AvatarFallback className="rounded-xl bg-primary/10 text-primary font-bold text-lg">
                      {shop.shop_name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-foreground truncate">
                        {shop.shop_name}
                      </h3>
                      <Badge
                        variant={shop.role === "owner" ? "default" : "secondary"}
                        className="text-[10px] px-1.5 py-0 shrink-0"
                      >
                        {shop.role === "owner" ? "Власник" : "Менеджер"}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {supplierTypeLabel(shop.supplier_type) && (
                        <span>{supplierTypeLabel(shop.supplier_type)}</span>
                      )}
                      <Badge
                        variant={shop.is_active ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {supplierStatusLabel(shop.status) || (shop.is_active ? "Активний" : "Неактивний")}
                      </Badge>
                      {shop.deletion_requested && (
                        <Badge variant="destructive" className="text-[10px]">
                          Заявка на видалення
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span className="flex items-center gap-1">
                        <Package className="h-3 w-3" />
                        {typeof shop.completed_products === "number"
                          ? `${shop.completed_products} з ${shop.product_count} товарів оброблено`
                          : `${shop.product_count} товарів`}
                      </span>
                      {shop.review_count > 0 && (
                        <span className="flex items-center gap-1">
                          <Star className="h-3 w-3" />
                          {shop.review_count} відгуків
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ⚙️ Gear icon — only for owners (or dev supplier) */}
                  {canEditShop(shop) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="shrink-0 h-10 w-10 rounded-full hover:bg-primary/10"
                      onClick={() => {
                        hapticSelection();
                        navigate(`/store-management/${shop.id}`);
                      }}
                      title="Редагувати магазин"
                    >
                      <Settings className="h-5 w-5 text-primary" />
                    </Button>
                  )}
                </div>

                {/* Balance button — owners & managers */}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-9 mb-2 border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:text-amber-600"
                  onClick={() => {
                    hapticSelection();
                    navigate(`/wallet/${shop.id}`);
                  }}
                >
                  <Wallet className="h-3.5 w-3.5 mr-1.5" />
                  Баланс магазину
                </Button>

                {/* Promotion button — owners & managers */}
                <Button
                  size="sm"
                  variant="premium"
                  className="w-full h-9 mb-2"
                  onClick={() => {
                    hapticSelection();
                    setPromoShopId(shop.id);
                  }}
                >
                  <Megaphone className="h-3.5 w-3.5 mr-1.5" />
                  Просування
                </Button>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-9"
                    onClick={() => {
                      hapticSelection();
                      navigate(`/store-orders/${shop.id}`);
                    }}
                  >
                    <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
                    Замовлення
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-9"
                    onClick={() => {
                      hapticSelection();
                      navigate(`/store-management/${shop.id}${shop.role === "manager" ? "?mode=manager" : ""}`);
                    }}
                  >
                    <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                    Відгуки
                  </Button>
                </div>

                {shop.role === "owner" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-9 mt-2 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                    disabled={shop.deletion_requested}
                    onClick={openDeleteDialog}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    {shop.deletion_requested ? "Заявку надіслано" : "Видалити магазин"}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
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

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!isSubmittingDeletion) {
            setDeleteOpen(open);
            if (!open) setDeleteReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[400px] mx-4">
          <DialogHeader>
            <DialogTitle>Видалити магазин</DialogTitle>
            <DialogDescription>
              Магазин не зникне одразу. Адміністратор отримає заявку і перевірить її вручну.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="deletion-reason">Вкажіть причину видалення (обов'язково)</Label>
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
