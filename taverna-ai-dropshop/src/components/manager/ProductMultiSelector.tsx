import { useEffect, useState } from "react";
import { Search, Check, X, Loader2, Package, Globe2, Store } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { ShopPopularProducts } from "./ShopPopularProducts";
import { cn } from "@/lib/utils";

export interface Product {
  id: string;
  name: string;
  price: number;
  images: string[];
  supplier_id?: string;
}

export interface ShopOption {
  id: string;
  shop_name: string;
  logo_url: string | null;
  is_active: boolean;
}

interface Props {
  products: Product[];
  isSearching: boolean;
  productSearch: string;
  setProductSearch: (v: string) => void;
  setProducts: (p: Product[]) => void;
  selectedProducts: Product[];
  setSelectedProducts: (p: Product[]) => void;
  useAllProducts: boolean;
  setUseAllProducts: (v: boolean) => void;
  supplierIds?: string[];
  availableShops?: ShopOption[];
  selectedShopNames?: string[];
}

export function ProductMultiSelector({
  products,
  isSearching,
  productSearch,
  setProductSearch,
  setProducts,
  selectedProducts,
  setSelectedProducts,
  useAllProducts,
  setUseAllProducts,
  supplierIds,
  availableShops,
  selectedShopNames,
}: Props) {
  const [allCount, setAllCount] = useState<number | null>(null);
  const multiShop = (supplierIds?.length || 0) !== 1;
  const shopLabel = selectedShopNames && selectedShopNames.length === 1
    ? selectedShopNames[0]
    : selectedShopNames && selectedShopNames.length > 1
    ? `${selectedShopNames.length} магазинів`
    : "усі магазини";

  // Count of all in-stock products in selected scope
  useEffect(() => {
    const fetchCount = async () => {
      let q = supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("in_stock", true);
      if (supplierIds && supplierIds.length > 0) {
        q = q.in("supplier_id", supplierIds);
      }
      const { count } = await q;
      setAllCount(count ?? 0);
    };
    fetchCount();
  }, [supplierIds?.join(",")]);

  const isSelected = (id: string) => selectedProducts.some((p) => p.id === id);

  const toggleProduct = (p: Product) => {
    if (useAllProducts) return;
    if (isSelected(p.id)) {
      setSelectedProducts(selectedProducts.filter((x) => x.id !== p.id));
    } else {
      setSelectedProducts([...selectedProducts, p]);
    }
  };

  const addAllSearchResults = () => {
    const merged = [...selectedProducts];
    products.forEach((p) => {
      if (!merged.some((x) => x.id === p.id)) merged.push(p);
    });
    setSelectedProducts(merged);
  };

  const clearAll = () => {
    setSelectedProducts([]);
    setUseAllProducts(false);
  };

  return (
    <div className="space-y-3">
      {/* All-products toggle */}
      <Card className={cn("border", useAllProducts && "border-primary bg-primary/5")}>
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                <Globe2 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Усі товари ({shopLabel})</p>
                <p className="text-xs text-muted-foreground">
                  {allCount === null ? "Підрахунок..." : `${allCount} товарів буде просунуто`}
                </p>
              </div>
            </div>
            <Switch
              checked={useAllProducts}
              onCheckedChange={(v) => {
                setUseAllProducts(v);
                if (v) setSelectedProducts([]);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {!useAllProducts && (
        <>
          {/* Search */}
          <div className="space-y-2">
            <Label className="flex items-center justify-between">
              <span>Оберіть товар(и)</span>
              {selectedProducts.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  Обрано: {selectedProducts.length}
                </Badge>
              )}
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Пошук товару... (назва)"
                className="pl-10"
              />
            </div>

            {/* Popular products mini-list per shop (when no search yet) */}
            {!productSearch && availableShops && availableShops.length > 0 && (
              <ShopPopularProducts
                supplierIds={supplierIds || []}
                availableShops={availableShops}
                selectedProducts={selectedProducts}
                onToggleProduct={toggleProduct}
              />
            )}

            {isSearching && (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Пошук...</span>
              </div>
            )}

            {products.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between p-2 border-b border-border bg-muted/50">
                  <span className="text-xs text-muted-foreground">
                    Знайдено: {products.length}
                  </span>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={addAllSearchResults}>
                    <Check className="h-3 w-3 mr-1" />
                    Додати всі
                  </Button>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {products.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => toggleProduct(product)}
                      className={cn(
                        "w-full flex items-center gap-3 p-2.5 hover:bg-muted transition-colors border-b border-border last:border-0",
                        isSelected(product.id) && "bg-primary/5"
                      )}
                    >
                      <Checkbox checked={isSelected(product.id)} className="pointer-events-none" />
                      <div className="w-10 h-10 bg-muted rounded overflow-hidden shrink-0">
                        {product.images?.[0] && (
                          <img src={product.images[0]} alt="" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className="font-medium text-sm truncate">{product.name}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-primary">{product.price} ₴</p>
                          {multiShop && product.supplier_id && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                              <Store className="h-2.5 w-2.5 mr-0.5" />
                              {availableShops?.find((s) => s.id === product.supplier_id)?.shop_name || "—"}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Selected chips */}
          {selectedProducts.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Обрані товари</Label>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearAll}>
                  Очистити
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5 p-2 bg-muted/30 rounded-lg max-h-32 overflow-y-auto">
                {selectedProducts.map((p) => (
                  <Badge key={p.id} variant="secondary" className="gap-1 pr-1">
                    <Package className="h-3 w-3" />
                    <span className="max-w-[140px] truncate">{p.name}</span>
                    <button
                      onClick={() => toggleProduct(p)}
                      className="ml-0.5 hover:text-destructive rounded p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {useAllProducts && (
        <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg text-sm">
          <p className="font-medium text-foreground">
            ✅ Режим: всі товари ({allCount ?? "..."}) з {shopLabel}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            AI-текст застосується як шаблон. Підставляються змінні <code>{"{name}"}</code>,{" "}
            <code>{"{price}"}</code>.
          </p>
        </div>
      )}
    </div>
  );
}
