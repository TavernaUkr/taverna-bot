import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { 
  ArrowLeft, Search, SlidersHorizontal, X, ChevronDown, ChevronUp, 
  Loader2, Package, Filter
} from "lucide-react";
import { ProductCard } from "@/components/ProductCard";
import { useFavoritesContext } from "@/components/FavoritesContext";
import { useCartContext } from "@/contexts/CartContext";
import { fetchBackendProducts, BackendApiError, type BackendProductVariant, type BackendProductOption } from "@/lib/backendApi";
import { mapBackendProductToUi, buildCategoriesFromProducts } from "@/hooks/useProducts";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  original_price?: number;
  images?: string[];
  category?: { id: string; name: string; slug: string } | null;
  brand?: string;
  model?: string;
  sizes?: string[];
  colors?: string[];
  in_stock: boolean;
  stock_quantity?: number;
  vendor_code?: string;
  ai_tags?: string[];
  // Потрібно для ProductCard і VariantSelectionModal, щоб знайти ТОЧНИЙ
  // variant_id для обраної комбінації розмір+колір.
  variants?: BackendProductVariant[];
  options?: BackendProductOption[];
}

interface Category {
  id: string;
  name: string;
  slug: string;
  product_count: number;
}

interface FilterState {
  categories: string[];
  minPrice: number;
  maxPrice: number;
  colors: string[];
  sizes: string[];
  brands: string[];
  models: string[];
  inStockOnly: boolean;
}

const defaultFilters: FilterState = {
  categories: [],
  minPrice: 0,
  maxPrice: 50000,
  colors: [],
  sizes: [],
  brands: [],
  models: [],
  inStockOnly: false,
};

export default function SearchResults() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const showAll = searchParams.get("all") === "true";
  
  const [searchInput, setSearchInput] = useState(query);
  // Повний немодифікований каталог з FastAPI-бекенду (без фільтрів/пошуку).
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  
  // Available filter options extracted from products
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  const [availableSizes, setAvailableSizes] = useState<string[]>([]);
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState({ min: 0, max: 50000 });
  
  const { isFavorite, toggleFavorite } = useFavoritesContext();
  const { addItem } = useCartContext();

  // Завантажуємо повний каталог з нашого FastAPI-бекенду ОДИН РАЗ.
  // Пошук/фільтри/категорії застосовуються далі на фронтенді (бекенд ще
  // не приймає query-параметри пошуку — так само, як у useProducts.tsx).
  useEffect(() => {
    const loadCatalog = async () => {
      setIsLoading(true);
      try {
        const backendProducts = await fetchBackendProducts();
        const mapped = backendProducts
          .map(mapBackendProductToUi)
          .filter((p) => p.in_stock);

        setAllProducts(mapped);
        setCategories(buildCategoriesFromProducts(mapped));

        // Діапазон цін по всьому каталогу (до фільтрів)
        let minP = Infinity, maxP = 0;
        mapped.forEach((p) => {
          if (p.price < minP) minP = p.price;
          if (p.price > maxP) maxP = p.price;
        });
        if (minP !== Infinity && maxP !== 0) {
          setPriceRange({ min: minP, max: maxP });
          setFilters((prev) => ({ ...prev, maxPrice: maxP }));
        }
      } catch (err) {
        const message = err instanceof BackendApiError ? err.message : "Помилка завантаження каталогу";
        console.error("Search catalog load error:", err);
        toast.error(message);
      } finally {
        setIsLoading(false);
      }
    };
    loadCatalog();
  }, []);

  // Клієнтська фільтрація/пошук по вже завантаженому каталогу
  useEffect(() => {
    let filtered = allProducts;

    // Текстовий пошук (пропускаємо, якщо показуємо всі товари)
    if (query && !showAll) {
      const q = query.toLowerCase();
      filtered = filtered.filter((p) =>
        [p.name, p.description, p.brand, p.model, p.vendor_code]
          .some((field) => field?.toLowerCase().includes(q))
      );
    }

    // Категорії
    if (filters.categories.length > 0) {
      filtered = filtered.filter((p) => p.category && filters.categories.includes(p.category.id));
    }

    // Ціна
    if (filters.minPrice > 0) {
      filtered = filtered.filter((p) => p.price >= filters.minPrice);
    }
    if (filters.maxPrice < priceRange.max) {
      filtered = filtered.filter((p) => p.price <= filters.maxPrice);
    }

    // Бренд / модель
    if (filters.brands.length > 0) {
      filtered = filtered.filter((p) => p.brand && filters.brands.includes(p.brand));
    }
    if (filters.models.length > 0) {
      filtered = filtered.filter((p) => p.model && filters.models.includes(p.model));
    }

    // Колір / розмір
    if (filters.colors.length > 0) {
      filtered = filtered.filter((p) => p.colors?.some((c) => filters.colors.includes(c)));
    }
    if (filters.sizes.length > 0) {
      filtered = filtered.filter((p) => p.sizes?.some((s) => filters.sizes.includes(s)));
    }

    setProducts(filtered);

    // Доступні опції фільтрів рахуємо по ВСЬОМУ каталогу (не по вже відфільтрованому)
    const allColors = new Set<string>();
    const allSizes = new Set<string>();
    const allBrands = new Set<string>();
    const allModels = new Set<string>();
    allProducts.forEach((p) => {
      p.colors?.forEach((c) => allColors.add(c));
      p.sizes?.forEach((s) => allSizes.add(s));
      if (p.brand) allBrands.add(p.brand);
      if (p.model) allModels.add(p.model);
    });
    setAvailableColors(Array.from(allColors).sort());
    setAvailableSizes(Array.from(allSizes).sort());
    setAvailableBrands(Array.from(allBrands).sort());
    setAvailableModels(Array.from(allModels).sort());
  }, [allProducts, query, showAll, filters, priceRange.max]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setSearchParams({ q: searchInput.trim() });
    }
  };

  const handleAddToCart = async (
    product: Product,
    size?: string,
    color?: string,
    variantId?: string,
    quantity: number = 1
  ) => {
    const success = await addItem(
      product.id,
      product.name,
      product.price,
      product.images?.[0],
      size,
      color,
      quantity,
      variantId
    );
    if (success) toast.success(`${product.name} додано до кошика`);
  };

  const handleToggleFavorite = async (product: Product) => {
    await toggleFavorite(
      product.id,
      product.name,
      product.price,
      product.images?.[0]
    );
  };

  const toggleFilter = (key: keyof FilterState, value: string) => {
    setFilters((prev) => {
      const arr = prev[key] as string[];
      if (arr.includes(value)) {
        return { ...prev, [key]: arr.filter((v) => v !== value) };
      }
      return { ...prev, [key]: [...arr, value] };
    });
  };

  const clearFilters = () => {
    setFilters({ ...defaultFilters, maxPrice: priceRange.max });
  };

  const activeFiltersCount = 
    filters.categories.length + 
    filters.colors.length + 
    filters.sizes.length + 
    filters.brands.length + 
    filters.models.length + 
    (filters.minPrice > 0 ? 1 : 0) + 
    (filters.maxPrice < priceRange.max ? 1 : 0);

  const FilterContent = () => (
    <div className="space-y-4">
      {/* Price Range */}
      <div className="space-y-3">
        <h4 className="font-medium text-foreground">Ціна (₴)</h4>
        <Slider
          value={[filters.minPrice, filters.maxPrice]}
          min={priceRange.min}
          max={priceRange.max}
          step={50}
          onValueChange={([min, max]) => 
            setFilters(prev => ({ ...prev, minPrice: min, maxPrice: max }))
          }
          className="w-full"
        />
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>{filters.minPrice.toLocaleString()} ₴</span>
          <span>{filters.maxPrice.toLocaleString()} ₴</span>
        </div>
      </div>

      <Accordion type="multiple" defaultValue={["categories"]} className="w-full">
        {/* Categories */}
        {categories.length > 0 && (
          <AccordionItem value="categories">
            <AccordionTrigger className="text-sm font-medium">
              Категорії ({categories.length})
            </AccordionTrigger>
            <AccordionContent>
              <ScrollArea className="h-48">
                <div className="space-y-2 pr-4">
                  {categories.map((cat) => (
                    <label key={cat.id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={filters.categories.includes(cat.id)}
                        onCheckedChange={() => toggleFilter("categories", cat.id)}
                      />
                      <span className="text-sm">{cat.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        ({cat.product_count})
                      </span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Colors */}
        {availableColors.length > 0 && (
          <AccordionItem value="colors">
            <AccordionTrigger className="text-sm font-medium">
              Колір ({availableColors.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-wrap gap-2">
                {availableColors.map((color) => (
                  <button
                    key={color}
                    onClick={() => toggleFilter("colors", color)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs border transition-colors",
                      filters.colors.includes(color)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted border-border hover:border-primary"
                    )}
                  >
                    {color}
                  </button>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Sizes */}
        {availableSizes.length > 0 && (
          <AccordionItem value="sizes">
            <AccordionTrigger className="text-sm font-medium">
              Розмір ({availableSizes.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-wrap gap-2">
                {availableSizes.map((size) => (
                  <button
                    key={size}
                    onClick={() => toggleFilter("sizes", size)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs border transition-colors",
                      filters.sizes.includes(size)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted border-border hover:border-primary"
                    )}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Brands */}
        {availableBrands.length > 0 && (
          <AccordionItem value="brands">
            <AccordionTrigger className="text-sm font-medium">
              Бренд ({availableBrands.length})
            </AccordionTrigger>
            <AccordionContent>
              <ScrollArea className="h-48">
                <div className="space-y-2 pr-4">
                  {availableBrands.map((brand) => (
                    <label key={brand} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={filters.brands.includes(brand)}
                        onCheckedChange={() => toggleFilter("brands", brand)}
                      />
                      <span className="text-sm">{brand}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Models */}
        {availableModels.length > 0 && (
          <AccordionItem value="models">
            <AccordionTrigger className="text-sm font-medium">
              Модель ({availableModels.length})
            </AccordionTrigger>
            <AccordionContent>
              <ScrollArea className="h-48">
                <div className="space-y-2 pr-4">
                  {availableModels.map((model) => (
                    <label key={model} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={filters.models.includes(model)}
                        onCheckedChange={() => toggleFilter("models", model)}
                      />
                      <span className="text-sm">{model}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {activeFiltersCount > 0 && (
        <Button variant="outline" onClick={clearFilters} className="w-full">
          Скинути фільтри ({activeFiltersCount})
        </Button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-card border-b border-border">
        <form onSubmit={handleSearch} className="flex items-center gap-3 p-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Пошук товарів..."
              className={cn(
                "w-full h-11 pl-10 pr-10 rounded-xl",
                "bg-muted/50 border border-border",
                "text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary",
                "transition-all"
              )}
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          {/* Mobile Filter Button */}
          <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className={cn(
                  "relative w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                  activeFiltersCount > 0
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <SlidersHorizontal className="h-5 w-5" />
                {activeFiltersCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground rounded-full text-xs flex items-center justify-center">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Filter className="h-5 w-5" />
                  Фільтри
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6">
                <FilterContent />
              </div>
            </SheetContent>
          </Sheet>
        </form>

        {/* Active filters chips */}
        {activeFiltersCount > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-3">
            {filters.categories.map((catId) => {
              const cat = categories.find((c) => c.id === catId);
              return cat ? (
                <button
                  key={catId}
                  onClick={() => toggleFilter("categories", catId)}
                  className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full text-xs"
                >
                  {cat.name}
                  <X className="h-3 w-3" />
                </button>
              ) : null;
            })}
            {filters.colors.map((color) => (
              <button
                key={color}
                onClick={() => toggleFilter("colors", color)}
                className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full text-xs"
              >
                {color}
                <X className="h-3 w-3" />
              </button>
            ))}
            {filters.sizes.map((size) => (
              <button
                key={size}
                onClick={() => toggleFilter("sizes", size)}
                className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full text-xs"
              >
                {size}
                <X className="h-3 w-3" />
              </button>
            ))}
            {filters.brands.map((brand) => (
              <button
                key={brand}
                onClick={() => toggleFilter("brands", brand)}
                className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full text-xs"
              >
                {brand}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="p-4">
        <p className="text-sm text-muted-foreground mb-4">
          {showAll ? (
            <>Всі товари: {products.length}</>
          ) : query ? (
            <>Результати для "{query}": {products.length} товарів</>
          ) : (
            <>Товарів: {products.length}</>
          )}
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              Товарів не знайдено
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Спробуйте змінити пошуковий запит або скинути фільтри
            </p>
            {activeFiltersCount > 0 && (
              <Button variant="outline" onClick={clearFilters} className="mt-4">
                Скинути фільтри
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 pb-20">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                id={product.id}
                name={product.name}
                price={product.price}
                originalPrice={product.original_price}
                image={product.images?.[0]}
                category={product.category?.name}
                inStock={product.in_stock}
                stockQuantity={product.stock_quantity}
                sizes={product.sizes}
                colors={product.colors}
                variants={product.variants}
                options={product.options}
                isFavorite={isFavorite(product.id)}
                onClick={() => navigate(`/product/${product.id}`)}
                onAddToCart={(size, color, variantId, quantity) =>
                  handleAddToCart(product, size, color, variantId, quantity)
                }
                onToggleFavorite={() => handleToggleFavorite(product)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}