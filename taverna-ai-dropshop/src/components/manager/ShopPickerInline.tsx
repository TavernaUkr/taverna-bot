import { useState, useMemo } from "react";
import { Store, Search, Check, Globe2, Home, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ShopOption {
  id: string;
  shop_name: string;
  logo_url: string | null;
  is_active: boolean;
}

interface Props {
  availableShops: ShopOption[];
  myShops: ShopOption[];
  partnerShops: ShopOption[];
  selectedShopIds: string[];
  toggleShop: (id: string) => void;
  selectAllShops: () => void;
  selectMyShops: () => void;
  clearShops: () => void;
  isAdmin?: boolean;
  roleLabel?: string;
}

export function ShopPickerInline({
  availableShops,
  myShops,
  partnerShops,
  selectedShopIds,
  toggleShop,
  selectAllShops,
  selectMyShops,
  clearShops,
  isAdmin,
  roleLabel,
}: Props) {
  const [search, setSearch] = useState("");
  const allSelected =
    selectedShopIds.length === availableShops.length && availableShops.length > 0;

  const filtered = useMemo(() => {
    if (!search) return availableShops;
    const q = search.toLowerCase();
    return availableShops.filter((s) => s.shop_name.toLowerCase().includes(q));
  }, [search, availableShops]);

  const filteredMy = filtered.filter((s) => myShops.some((m) => m.id === s.id));
  const filteredPartner = filtered.filter((s) =>
    partnerShops.some((p) => p.id === s.id),
  );

  // Empty state
  if (availableShops.length === 0) {
    return (
      <Card className="border-dashed border-border">
        <CardContent className="p-4 flex items-center gap-3">
          <Store className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">Магазинів не знайдено</p>
            <p className="text-xs text-muted-foreground">
              Зареєструйте магазин або попросіть власника прив'язати вас як менеджера.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Auto-collapsed: only one shop
  if (availableShops.length === 1) {
    const shop = availableShops[0];
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-3 flex items-center gap-3">
          {shop.logo_url ? (
            <img src={shop.logo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Store className="h-4 w-4 text-primary" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">Магазин</p>
            <p className="text-sm font-semibold truncate">{shop.shop_name}</p>
          </div>
          <Badge variant="secondary" className="text-xs">
            <Check className="h-3 w-3 mr-1" />
            Активний
          </Badge>
        </CardContent>
      </Card>
    );
  }

  const renderShopCard = (shop: ShopOption, badge?: "my" | "partner") => {
    const checked = selectedShopIds.includes(shop.id);
    return (
      <button
        key={shop.id}
        onClick={() => toggleShop(shop.id)}
        type="button"
        className={cn(
          "flex items-center gap-2 p-2 rounded-lg border text-left transition-all",
          checked
            ? "border-primary bg-primary/10 ring-1 ring-primary"
            : "border-border hover:border-primary/50",
        )}
      >
        <div className="relative shrink-0">
          {shop.logo_url ? (
            <img
              src={shop.logo_url}
              alt=""
              className="w-9 h-9 rounded-full object-cover"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
              <Store className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          {checked && (
            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
              <Check className="h-2.5 w-2.5" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{shop.shop_name}</p>
          {badge && (
            <p className="text-[10px] text-muted-foreground">
              {badge === "my" ? "Мій магазин" : "Партнер"}
            </p>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Крок 1. Оберіть магазин(и)</span>
        </div>
        <Badge variant="outline" className="text-[11px]">
          {selectedShopIds.length} / {availableShops.length}
          {roleLabel && <span className="ml-1 text-muted-foreground">· {roleLabel}</span>}
        </Badge>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant={allSelected ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs"
          onClick={allSelected ? clearShops : selectAllShops}
        >
          <Globe2 className="h-3 w-3 mr-1" />
          {allSelected ? "Зняти всі" : "Усі магазини"}
        </Button>
        {isAdmin && myShops.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={selectMyShops}
          >
            <Home className="h-3 w-3 mr-1" />
            Тільки мої ({myShops.length})
          </Button>
        )}
        {selectedShopIds.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={clearShops}
          >
            <X className="h-3 w-3 mr-1" />
            Очистити
          </Button>
        )}
      </div>

      {/* Search (only when many) */}
      {availableShops.length > 6 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук магазину..."
            className="pl-8 h-8 text-xs"
          />
        </div>
      )}

      {/* Shop grid */}
      <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
        {isAdmin && filteredMy.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              🏠 Мої магазини
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {filteredMy.map((s) => renderShopCard(s, "my"))}
            </div>
          </div>
        )}

        {(isAdmin ? filteredPartner : filtered).length > 0 && (
          <div className="space-y-1">
            {isAdmin && (
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                🌐 Партнерські магазини
              </p>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              {(isAdmin ? filteredPartner : filtered).map((s) =>
                renderShopCard(s, isAdmin ? "partner" : undefined),
              )}
            </div>
          </div>
        )}

        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-3">
            Нічого не знайдено
          </p>
        )}
      </div>
    </div>
  );
}
