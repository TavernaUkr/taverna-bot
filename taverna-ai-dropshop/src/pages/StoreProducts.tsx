import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Edit3,
  ImageOff,
  Loader2,
  Package,
  PackageSearch,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { hapticSelection } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import {
  type BackendSupplierProduct,
  getSupplierProducts,
  type SupplierProductsTab,
} from "@/lib/backendApi";

/**
 * «Мої Товари» (Products Dashboard) — B2B-сторінка керування асортиментом
 * конкретного магазину. Маршрут: /supplier/:id/products (кнопка «Мої Товари»
 * на картці магазину у MyShops).
 *
 * Вкладки фільтрації:
 * - «Всі»      — усі товари магазину (total з бекенду);
 * - «Активні»  — status=active (у публічному каталозі);
 * - «На модерації» — AI ще не обробив (pending_ai / processing_ai);
 * - «Чернетки/Приховані» — inactive (не показуються в каталозі).
 */

const PAGE_SIZE = 50;

// --- Статусні бейджі --------------------------------------------------------

const STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  active: { label: "Активний", className: "bg-emerald-500/10 text-emerald-600" },
  inactive: { label: "Прихований", className: "bg-muted text-muted-foreground" },
  archived: { label: "Архів", className: "bg-amber-500/10 text-amber-600" },
  deleted: { label: "Видалений", className: "bg-red-500/10 text-red-600" },
  pending_ai: { label: "На модерації", className: "bg-sky-500/10 text-sky-600" },
  processing_ai: { label: "AI обробляє", className: "bg-blue-500/10 text-blue-600" },
  failed_ai: { label: "Помилка AI", className: "bg-red-500/10 text-red-600" },
};

const statusMeta = (status: string) =>
  STATUS_META[status] ?? { label: status, className: "bg-muted text-muted-foreground" };

// --- Картка товару ----------------------------------------------------------

function ProductRow({
  product,
  onEdit,
}: {
  product: BackendSupplierProduct;
  onEdit: (product: BackendSupplierProduct) => void;
}) {
  const meta = statusMeta(product.status);
  const price = typeof product.price === "number" ? product.price : null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        <div className="flex gap-3">
          {/* Мініатюра */}
          <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted flex items-center justify-center shrink-0">
            {product.picture ? (
              <img
                src={product.picture}
                alt={product.name}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                  const parent = (e.currentTarget as HTMLImageElement).parentElement;
                  if (parent) parent.className = "w-16 h-16 rounded-lg bg-muted flex items-center justify-center";
                }}
              />
            ) : (
              <ImageOff className="h-6 w-6 text-muted-foreground/50" />
            )}
          </div>

          {/* Назва + артикул + статус */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-medium text-sm text-foreground line-clamp-2 leading-snug min-w-0">
                {product.name}
              </h3>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0",
                  meta.className
                )}
              >
                {meta.label}
              </span>
            </div>

            {product.sku && (
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                Артикул: {product.sku}
              </p>
            )}

            {product.category && (
              <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">
                {product.category}
                {product.sub_category ? ` · ${product.sub_category}` : ""}
              </p>
            )}

            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {price != null ? (
                <span className="font-bold text-primary text-sm">
                  {price.toLocaleString("uk-UA")} ₴
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground">Ціну не задано</span>
              )}
              {product.stock > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  Залишок: {product.stock}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Дії */}
        <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-border">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              hapticSelection();
              onEdit(product);
            }}
          >
            <Edit3 className="h-3.5 w-3.5" />
            Редагувати
          </Button>
        </div>
    </CardContent>
    </Card>
  );
}

// --- Сторінка ----------------------------------------------------------------

export default function StoreProducts() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const supplierId = Number(id);
  const isValidId = Number.isInteger(supplierId) && supplierId > 0;

  const [products, setProducts] = useState<BackendSupplierProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [activeTab, setActiveTab] = useState<SupplierProductsTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    if (!isValidId) {
      setIsLoading(false);
      return;
    }
    try {
      const data = await getSupplierProducts(supplierId, {
        tab: activeTab,
        search: searchQuery || undefined,
        limit: PAGE_SIZE,
      });
      setProducts(data.items);
      setTotal(data.total);
      setLoadError(null);
    } catch (err) {
      console.error("Error loading supplier products:", err);
      setLoadError(
        err instanceof Error ? err.message : "Не вдалося завантажити товари"
      );
    } finally {
      setIsLoading(false);
    }
  }, [isValidId, supplierId, activeTab, searchQuery]);

  useEffect(() => {
    setIsLoading(true);
    void loadProducts();
  }, [loadProducts]);

  const handleSearch = () => {
    setSearchQuery(searchInput.trim());
  };

  const handleEdit = (product: BackendSupplierProduct) => {
    navigate(`/supplier/${supplierId}/products/${product.id}/edit`);
  };

  const handleAddProduct = () => {
    hapticSelection();
    navigate(`/supplier/${supplierId}/products/new`);
  };

  // Невалідний :id → порожній стан (замість crash)
  if (!isValidId) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader onAdd={handleAddProduct} />
        <EmptyState
          type="default"
          title="Магазин не знайдено"
          description="Некоректний ідентифікатор магазину у посиланні"
          action={{ label: "До моїх магазинів", onClick: () => navigate("/my-shops") }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader onAdd={handleAddProduct} />

      <div className="p-4 space-y-4">
        {/* Пошук */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Пошук за назвою або артикулом..."
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="icon" onClick={handleSearch} aria-label="Шукати">
            <Search className="h-4 w-4" />
          </Button>
        </div>

        {/* Вкладки фільтрації за статусом */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            hapticSelection();
            setActiveTab(v as SupplierProductsTab);
          }}
        >
          <TabsList className="w-full grid grid-cols-4 h-11">
            <TabsTrigger value="all" className="flex items-center gap-1.5 text-xs">
              <Package className="h-3.5 w-3.5" />
              Всі
            </TabsTrigger>
            <TabsTrigger value="active" className="flex items-center gap-1.5 text-xs">
              <Package className="h-3.5 w-3.5 text-emerald-500" />
              Активні
            </TabsTrigger>
            <TabsTrigger value="moderation" className="flex items-center gap-1.5 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 text-sky-500" />
              На модерації
            </TabsTrigger>
            <TabsTrigger value="drafts" className="flex items-center gap-1.5 text-xs">
              <PackageSearch className="h-3.5 w-3.5 text-muted-foreground" />
              Чернетки
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Лічильник */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Товарів: <span className="font-semibold text-foreground">{total}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => void loadProducts()}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        {/* Список / стани */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <div className="p-4 space-y-3 text-center">
            <AlertTriangle className="h-8 w-8 mx-auto text-warning" />
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void loadProducts()}>
              Спробувати ще
            </Button>
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            type="products"
            title={
              searchQuery
                ? "Нічого не знайдено"
                : activeTab === "all"
                  ? "Товарів ще немає"
                  : "У цій вкладці порожньо"
            }
            description={
              searchQuery
                ? "Спробуйте інший запит або скиньте пошук"
                : activeTab === "all"
                  ? "Товари з'являться тут після імпорту каталогу"
                  : "Перейдіть на вкладку «Всі», щоб побачити всі товари магазину"
            }
            action={
              searchQuery
                ? {
                    label: "Скинути пошук",
                    onClick: () => {
                      setSearchInput("");
                      setSearchQuery("");
                    },
                  }
                : undefined
            }
          />
        ) : (
          <div className="space-y-2.5">
            {products.map((product) => (
              <ProductRow key={product.id} product={product} onEdit={handleEdit} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Шапка сторінки: назад, заголовок, «+ Додати товар». */
function PageHeader({ onAdd }: { onAdd: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            hapticSelection();
            navigate("/my-shops");
          }}
          aria-label="Назад до магазинів"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="font-bold text-lg text-foreground">Мої Товари</h1>
          <p className="text-xs text-muted-foreground">Керування асортиментом магазину</p>
        </div>
        <Button size="sm" className="shrink-0 gap-1.5" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          Додати товар
        </Button>
      </div>
    </div>
  );
}
