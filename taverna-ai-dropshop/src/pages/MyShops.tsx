import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Store, Plus, Package, Settings, 
  Loader2, Star, ShoppingCart, MessageSquare, Megaphone, Send, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { toast } from "sonner";
import { hapticSelection } from "@/lib/haptics";

interface ShopInfo {
  id: string;
  shop_name: string;
  logo_url: string | null;
  is_active: boolean;
  product_count: number;
  review_count: number;
  role: "owner" | "manager";
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

      // 1. Shops owned by this supplier (by telegram_id)
      if (isSupplier || isAdmin) {
        const telegramId = profile?.telegram_id;
        if (telegramId) {
          const { data: ownedShops } = await supabase
            .from("suppliers")
            .select("id, shop_name, logo_url, is_active")
            .eq("telegram_id", telegramId);

          if (ownedShops) {
            for (const shop of ownedShops) {
              const { count: productCount } = await supabase
                .from("products")
                .select("*", { count: "exact", head: true })
                .eq("supplier_id", shop.id);

              const { data: productIds } = await supabase
                .from("products")
                .select("id")
                .eq("supplier_id", shop.id);

              let reviewCount = 0;
              if (productIds?.length) {
                const { count } = await supabase
                  .from("reviews")
                  .select("*", { count: "exact", head: true })
                  .in("product_id", productIds.map(p => p.id));
                reviewCount = count || 0;
              }

              allShops.push({
                ...shop,
                product_count: productCount || 0,
                review_count: reviewCount,
                role: "owner",
              });
            }
          }
        }

        // DEV FALLBACK: In Lovable dev environment, if no owned shops found for supplier role,
        // fetch first 3 active suppliers as mock "owner" shops for UI testing
        if (allShops.length === 0 && isLovableDevEnvironment() && isSupplier) {
          const { data: devShops } = await supabase
            .from("suppliers")
            .select("id, shop_name, logo_url, is_active")
            .eq("is_active", true)
            .limit(3);

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
                role: "owner",
              });
            }
          }
        }
      }

      // 2. Shops managed via shop_manager_links
      if (profile?.id) {
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

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Package className="h-3 w-3" />
                        {shop.product_count} товарів
                      </span>
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3" />
                        {shop.review_count} відгуків
                      </span>
                      <Badge
                        variant={shop.is_active ? "default" : "destructive"}
                        className="text-[10px]"
                      >
                        {shop.is_active ? "Активний" : "Неактивний"}
                      </Badge>
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
    </div>
  );
}
