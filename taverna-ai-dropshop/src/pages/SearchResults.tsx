import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { 
  ArrowLeft, Search, SlidersHorizontal, X, ChevronDown, ChevronUp, 
  Loader2, Package, Filter
} from "lucide-react";
import { ProductCard } from "@/components/ProductCard";
import { useFavoritesContext } from "@/components/FavoritesContext";
import { useCartContext } from "@/contexts/CartContext";
import { supabase } from "@/integrations/supabase/client";
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

  // Fetch categories
  useEffect(() => {
    const fetchCategories = async () => {
      const { data } = await supabase
        .from("categories")
        .select("id, name, slug, product_count")
        .eq("is_active", true)
        .order("name");
      if (data) setCategories(data);
    };
    fetchCategories();
  }, []);

  // Fetch products with filters
  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      let queryBuilder = supabase
        .from("products")
        .select(`
          id, name, price, original_price, images, brand, model, 
          sizes, colors, in_stock, stock_quantity, vendor_code, ai_tags,
          category:categories(id, name, slug)
        `)
        .eq("in_stock", true);

      // Text search (skip if showing all products)
      if (query && !showAll) {
        queryBuilder = queryBuilder.or(
          `name.ilike.%${query}%,description.ilike.%${query}%,brand.ilike.%${query}%,model.ilike.%${query}%,vendor_code.ilike.%${query}%`
        );
      }

      // Category filter
      if (filters.categories.length > 0) {
        queryBuilder = queryBuilder.in("category_id", filters.categories);
      }

      // Price filter
      if (filters.minPrice > 0) {
        queryBuilder = queryBuilder.gte("price", filters.minPrice);
      }
      if (filters.maxPrice < priceRange.max) {
        queryBuilder = queryBuilder.lte("price", filters.maxPrice);
      }

      // Brand filter
      if (filters.brands.length > 0) {
        queryBuilder = queryBuilder.in("brand", filters.brands);
      }

      // Model filter
      if (filters.models.length > 0) {
        queryBuilder = queryBuilder.in("model", filters.models);
      }

      const { data, error } = await queryBuilder.order("created_at", { ascending: false });

      if (error) throw error;

      let filteredData = data || [];

      // Client-side filtering for arrays (colors, sizes)
      if (filters.colors.length > 0) {
        filteredData = filteredData.filter((p) =>
          p.colors?.some((c: string) => filters.colors.includes(c))
        );
      }

      if (filters.sizes.length > 0) {
        filteredData = filteredData.filter((p) =>
          p.sizes?.some((s: string) => filters.sizes.includes(s))
        );
      }

      setProducts(filteredData);

      // Extract available options from all products (before filtering)
      const allColors = new Set<string>();
      const allSizes = new Set<string>();
      const allBrands = new Set<string>();
      const allModels = new Set<string>();
      let minP = Infinity, maxP = 0;

      (data || []).forEach((p) => {
        p.colors?.forEach((c: string) => allColors.add(c));
        p.sizes?.forEach((s: string) => allSizes.add(s));
        if (p.brand) allBrands.add(p.brand);
        if (p.model) allModels.add(p.model);
        if (p.price < minP) minP = p.price;
        if (p.price > maxP) maxP = p.price;
      });

      setAvailableColors(Array.from(allColors).sort());
      setAvailableSizes(Array.from(allSizes).sort());
      setAvailableBrands(Array.from(allBrands).sort());
      setAvailableModels(Array.from(allModels).sort());
      
      if (minP !== Infinity && maxP !== 0) {
        setPriceRange({ min: minP, max: maxP });
        if (filters.maxPrice === defaultFilters.maxPrice) {
          setFilters(prev => ({ ...prev, maxPrice: maxP }));
        }
      }
    } catch (err) {
      console.error("Search error:", err);
      toast.error("Помилка пошуку");
    } finally {
      setIsLoading(false);
    }
  }, [query, filters, showAll]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setSearchParams({ q: searchInput.trim() });
    }
  };

  const handleAddToCart = async (product: Product) => {
    const success = await addItem(
      product.id,
      product.name,
      product.price,
      product.images?.[0]
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
                isFavorite={isFavorite(product.id)}
                onClick={() => navigate(`/product/${product.id}`)}
                onAddToCart={() => handleAddToCart(product)}
                onToggleFavorite={() => handleToggleFavorite(product)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}