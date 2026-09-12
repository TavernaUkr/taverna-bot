import { useEffect, useState } from "react";
import { Flame, Plus, Check, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Product {
  id: string;
  name: string;
  price: number;
  images: string[];
  supplier_id?: string;
}

interface ShopOption {
  id: string;
  shop_name: string;
  logo_url: string | null;
}

interface Props {
  supplierIds: string[];
  availableShops: ShopOption[];
  selectedProducts: Product[];
  onToggleProduct: (p: Product) => void;
}

interface ShopBucket {
  shop: ShopOption;
  products: Product[];
}

export function ShopPopularProducts({
  supplierIds,
  availableShops,
  selectedProducts,
  onToggleProduct,
}: Props) {
  const [buckets, setBuckets] = useState<ShopBucket[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      // Determine target shops: limited to current scope, max 3
      const scopeIds =
        supplierIds.length > 0
          ? supplierIds
          : availableShops.map((s) => s.id);
      const targetShops = availableShops
        .filter((s) => scopeIds.includes(s.id))
        .slice(0, 3);

      if (targetShops.length === 0) {
        setBuckets([]);
        return;
      }

      setLoading(true);
      try {
        const results = await Promise.all(
          targetShops.map(async (shop) => {
            const { data } = await supabase
              .from("products")
              .select("id, name, price, images, supplier_id, views_count")
              .eq("supplier_id", shop.id)
              .eq("in_stock", true)
              .order("views_count", { ascending: false, nullsFirst: false })
              .order("created_at", { ascending: false })
              .limit(8);
            return {
              shop,
              products: (data || []) as unknown as Product[],
            };
          }),
        );
        setBuckets(results.filter((r) => r.products.length > 0));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [supplierIds.join(","), availableShops.map((s) => s.id).join(",")]);

  if (buckets.length === 0 && !loading) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Flame className="h-4 w-4 text-orange-500" />
        <span className="text-xs font-medium text-foreground">
          Популярні товари магазинів
        </span>
        <Badge variant="outline" className="text-[10px]">
          швидкий вибір
        </Badge>
      </div>

      {buckets.map(({ shop, products }) => (
        <div key={shop.id} className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {shop.logo_url ? (
              <img src={shop.logo_url} alt="" className="w-4 h-4 rounded-full object-cover" />
            ) : (
              <Store className="h-3 w-3" />
            )}
            <span className="truncate">{shop.shop_name}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
            {products.map((p) => {
              const isSelected = selectedProducts.some((x) => x.id === p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onToggleProduct(p)}
                  className={cn(
                    "shrink-0 w-24 snap-start rounded-lg border overflow-hidden text-left transition-all",
                    isSelected
                      ? "border-primary ring-1 ring-primary"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  <div className="relative aspect-square bg-muted">
                    {p.images?.[0] && (
                      <img
                        src={p.images[0]}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    )}
                    <div
                      className={cn(
                        "absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center backdrop-blur",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "bg-background/70 text-foreground",
                      )}
                    >
                      {isSelected ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                    </div>
                  </div>
                  <div className="p-1.5">
                    <p className="text-[10px] font-medium leading-tight line-clamp-2">
                      {p.name}
                    </p>
                    <p className="text-[10px] text-primary font-semibold mt-0.5">
                      {p.price} ₴
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
