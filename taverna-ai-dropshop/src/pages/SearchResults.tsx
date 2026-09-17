import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { 
  ArrowLeft, Search, SlidersHorizontal, X, ChevronDown, ChevronUp, 
  Loader2, Package, Filter, Clapperboard
} from "lucide-react";
import { ProductCard } from "@/components/ProductCard";
import { ProductFeedView } from "@/components/catalog/ProductFeedView";
import { useFavoritesContext } from "@/components/FavoritesContext";
import { useCartContext } from "@/contexts/CartContext";
import { fetchBackendProductsPaged, fetchBackendCategories, fetchBackendFilters, BackendApiError, type BackendProductVariant, type BackendProductOption, type BackendFilterAttribute, type BackendCategorySub } from "@/lib/backendApi";
import { mapBackendProductToUi, buildCategoriesFromProducts } from "@/hooks/useProducts";
import {
  PimFilterPills,
  FALLBACK_SEASONS,
  FALLBACK_NICHES,
  mergeUniqueLabels,
} from "@/components/catalog/PimFilterPills";
import {
  displayNameForSubcategories,
  encodeSubCategoryParam,
  groupSubcategories,
  isGroupSelected,
  matchSmartGroup,
  readSubCategoryParams,
  type SmartSubcategoryGroup,
} from "@/utils/categoryParser";
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
  sub_category?: string;
  season?: string;
  target_niche?: string;
  gender?: string;
  supplier_name?: string;
  attributes?: Record<string, string>;
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
  subCategories: string[];
  niches: string[];
  seasons: string[];
  genders: string[];
  attributes: Record<string, string[]>;
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
  subCategories: [],
  niches: [],
  seasons: [],
  genders: [],
  attributes: {},
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
  const urlCategory = searchParams.get("category") || "";
  const searchString = searchParams.toString();
  const urlSubCategories = useMemo(
    () => readSubCategoryParams(new URLSearchParams(searchString)),
    [searchString]
  );
  const urlSubCategoryLabel = useMemo(
    () => displayNameForSubcategories(urlSubCategories),
    [urlSubCategories]
  );
  const nicheParam = searchParams.get("target_niche") || searchParams.get("niche") || "";
  const seasonParam = searchParams.get("season") || "";
  const urlNiches = useMemo(
    () => nicheParam.split(",").map((item) => item.trim()).filter(Boolean),
    [nicheParam]
  );
  const urlSeasons = useMemo(
    () => seasonParam.split(",").map((item) => item.trim()).filter(Boolean),
    [seasonParam]
  );
  const urlGender = searchParams.get("gender") || "";
  
  const [searchInput, setSearchInput] = useState(query);
  // Повний немодифікований каталог з FastAPI-бекенду (без фільтрів/пошуку).
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...defaultFilters,
    niches: urlNiches,
    seasons: urlSeasons,
    subCategories: urlSubCategories,
  }));
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isFeedOpen, setIsFeedOpen] = useState(false);

  const urlSubKey = urlSubCategories.join("|");
  useEffect(() => {
    setFilters((prev) => {
      const same =
        prev.subCategories.length === urlSubCategories.length &&
        prev.subCategories.every((name, index) => name === urlSubCategories[index]);
      if (same) return prev;
      return { ...prev, subCategories: urlSubCategories };
    });
  }, [urlSubKey]);
  
  // Available filter options extracted from products
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  const [availableSizes, setAvailableSizes] = useState<string[]>([]);
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableNiches, setAvailableNiches] = useState<string[]>(FALLBACK_NICHES);
  const [availableSeasons, setAvailableSeasons] = useState<string[]>(FALLBACK_SEASONS);
  const [availableGenders, setAvailableGenders] = useState<string[]>([]);
  const [availableAttributes, setAvailableAttributes] = useState<BackendFilterAttribute[]>([]);
  const [availableSubCategories, setAvailableSubCategories] = useState<BackendCategorySub[]>([]);
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
        const backendProducts = await fetchBackendProductsPaged();
        const mapped = backendProducts
          .map(mapBackendProductToUi)
          .filter((p) => p.in_stock);

        setAllProducts(mapped);
        try {
          const backendCategories = await fetchBackendCategories();
          if (backendCategories.length > 0) {
            setCategories(
              backendCategories.map((cat) => ({
                id: cat.name,
                name: cat.name,
                slug: cat.name,
                product_count: cat.count,
              }))
            );
          } else {
            setCategories(buildCategoriesFromProducts(mapped));
          }
        } catch {
          setCategories(buildCategoriesFromProducts(mapped));
        }

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

  // Динамічні лічильники підкатегорій з бекенду під вибрані фільтри.
  useEffect(() => {
    const loadPimFilters = async () => {
      try {
        const mainCategory = Array.from(
          new Set([urlCategory, ...filters.categories].filter(Boolean))
        );
        const niches = Array.from(
          new Set([...urlNiches, ...filters.niches].filter(Boolean))
        );
        const seasons = Array.from(
          new Set([...urlSeasons, ...filters.seasons].filter(Boolean))
        );
        const genders = Array.from(
          new Set([urlGender, ...filters.genders].filter(Boolean))
        );
        const pimFilters = await fetchBackendFilters({
          main_category: mainCategory,
          niche: niches,
          season: seasons,
          gender: genders,
        });
        setAvailableNiches(mergeUniqueLabels(pimFilters.target_niche || [], FALLBACK_NICHES));
        setAvailableSeasons(mergeUniqueLabels(pimFilters.season || [], FALLBACK_SEASONS));
        if (pimFilters.gender?.length) setAvailableGenders(pimFilters.gender);
        if (pimFilters.attributes?.length) setAvailableAttributes(pimFilters.attributes);
        setAvailableSubCategories(pimFilters.sub_categories || []);
      } catch {
        // fallback нижче з товарів
      }
    };
    loadPimFilters();
  }, [
    urlCategory,
    urlNiches,
    urlSeasons,
    urlGender,
    filters.categories,
    filters.niches,
    filters.seasons,
    filters.genders,
  ]);

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

    // Категорії з URL (AI текстові назви) + чекбокси фільтрів
    if (urlCategory) {
      filtered = filtered.filter(
        (p) => p.category?.id === urlCategory || p.category?.name === urlCategory
      );
    }
    const selectedSubs = Array.from(
      new Set(
        [...urlSubCategories, ...filters.subCategories]
          .map((name) => name.trim())
          .filter(Boolean)
      )
    );
    if (selectedSubs.length > 0) {
      const selectedKeys = new Set(selectedSubs.map((name) => name.toLowerCase()));
      filtered = filtered.filter(
        (p) => p.sub_category && selectedKeys.has(p.sub_category.toLowerCase())
      );
    }
    if (urlGender) {
      filtered = filtered.filter((p) => p.gender === urlGender);
    }
    if (filters.categories.length > 0) {
      filtered = filtered.filter((p) => p.category && filters.categories.includes(p.category.id));
    }
    if (filters.niches.length > 0) {
      filtered = filtered.filter((p) => p.target_niche && filters.niches.includes(p.target_niche));
    }
    if (filters.seasons.length > 0) {
      filtered = filtered.filter((p) => p.season && filters.seasons.includes(p.season));
    }
    if (filters.genders.length > 0) {
      filtered = filtered.filter((p) => p.gender && filters.genders.includes(p.gender));
    }
    const attrEntries = Object.entries(filters.attributes).filter(([, values]) => values.length > 0);
    if (attrEntries.length > 0) {
      filtered = filtered.filter((p) =>
        attrEntries.every(([key, values]) => {
          const productValue = p.attributes?.[key];
          return !!productValue && values.includes(productValue);
        })
      );
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

    if (availableNiches.length === 0) {
      const niches = new Set<string>();
      allProducts.forEach((p) => { if (p.target_niche) niches.add(p.target_niche); });
      setAvailableNiches(Array.from(niches).sort());
    }
    if (availableSeasons.length === 0) {
      const seasons = new Set<string>();
      allProducts.forEach((p) => { if (p.season) seasons.add(p.season); });
      setAvailableSeasons(Array.from(seasons).sort());
    }
    if (availableGenders.length === 0) {
      const genders = new Set<string>();
      allProducts.forEach((p) => { if (p.gender) genders.add(p.gender); });
      setAvailableGenders(Array.from(genders).sort());
    }
    if (availableAttributes.length === 0) {
      const attrMap = new Map<string, Set<string>>();
      allProducts.forEach((p) => {
        Object.entries(p.attributes || {}).forEach(([key, value]) => {
          if (!key || !value) return;
          if (!attrMap.has(key)) attrMap.set(key, new Set());
          attrMap.get(key)!.add(value);
        });
      });
      setAvailableAttributes(
        Array.from(attrMap.entries()).map(([name, values]) => ({
          name,
          values: Array.from(values).sort(),
        }))
      );
    }
  }, [allProducts, query, showAll, filters, priceRange.max, urlCategory, urlSubCategories, urlGender, availableNiches.length, availableSeasons.length, availableGenders.length, availableAttributes.length]);

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

  const groupedSubCategories = useMemo(() => {
    if (availableSubCategories.length > 0) {
      return groupSubcategories(availableSubCategories);
    }
    const counts = new Map<string, number>();
    allProducts.forEach((product) => {
      const name = product.sub_category?.trim();
      if (!name) return;
      if (urlCategory && product.category?.id !== urlCategory && product.category?.name !== urlCategory) {
        return;
      }
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return groupSubcategories(
      Array.from(counts.entries()).map(([name, count]) => ({ name, count }))
    );
  }, [availableSubCategories, allProducts, urlCategory]);

  const selectedSubGroups = useMemo(
    () => groupSubcategories(filters.subCategories.map((name) => ({ name, count: 1 }))),
    [filters.subCategories]
  );

  const setSubCategoryFilter = (originals: string[]) => {
    setFilters((prev) => ({ ...prev, subCategories: originals }));
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (originals.length > 0) next.set("sub_category", encodeSubCategoryParam(originals));
      else next.delete("sub_category");
      return next;
    }, { replace: true });
  };

  const toggleSubcategoryGroup = (group: SmartSubcategoryGroup) => {
    const selected = filters.subCategories;
    const allOn = isGroupSelected(group, selected);
    if (allOn) {
      setSubCategoryFilter(
        selected.filter((name) => {
          if (group.id.startsWith("raw:")) {
            return name.toLowerCase() !== group.name.toLowerCase();
          }
          return matchSmartGroup(name)?.id !== group.id;
        })
      );
    } else {
      const seen = new Set(selected.map((name) => name.toLowerCase()));
      const merged = [...selected];
      for (const name of group.originals) {
        if (!seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          merged.push(name);
        }
      }
      setSubCategoryFilter(merged);
    }
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

  const toggleAttribute = (key: string, value: string) => {
    setFilters((prev) => {
      const current = prev.attributes[key] || [];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      const attributes = { ...prev.attributes };
      if (next.length === 0) {
        delete attributes[key];
      } else {
        attributes[key] = next;
      }
      return { ...prev, attributes };
    });
  };

  const clearFilters = () => {
    setFilters({ ...defaultFilters, maxPrice: priceRange.max });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("sub_category");
      return next;
    }, { replace: true });
  };

  const attributeFiltersCount = Object.values(filters.attributes).reduce(
    (sum, values) => sum + values.length,
    0
  );

  const activeFiltersCount = 
    filters.categories.length +
    selectedSubGroups.length +
    filters.niches.length +
    filters.seasons.length +
    filters.genders.length +
    attributeFiltersCount +
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

      <Accordion type="multiple" defaultValue={["niches", "subcategories", "categories"]} className="w-full">
        {availableNiches.length > 0 && (
          <AccordionItem value="niches">
            <AccordionTrigger className="text-sm font-medium">
              Ніша ({availableNiches.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-wrap gap-2">
                {availableNiches.map((niche) => (
                  <button
                    key={niche}
                    onClick={() => toggleFilter("niches", niche)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs border transition-colors",
                      filters.niches.includes(niche)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted border-border hover:border-primary"
                    )}
                  >
                    {niche}
                  </button>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {availableSeasons.length > 0 && (
          <AccordionItem value="seasons">
            <AccordionTrigger className="text-sm font-medium">
              Сезон ({availableSeasons.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-wrap gap-2">
                {availableSeasons.map((season) => (
                  <button
                    key={season}
                    onClick={() => toggleFilter("seasons", season)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs border transition-colors",
                      filters.seasons.includes(season)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted border-border hover:border-primary"
                    )}
                  >
                    {season}
                  </button>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {availableGenders.length > 0 && (
          <AccordionItem value="genders">
            <AccordionTrigger className="text-sm font-medium">
              Стать ({availableGenders.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-wrap gap-2">
                {availableGenders.map((gender) => (
                  <button
                    key={gender}
                    onClick={() => toggleFilter("genders", gender)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs border transition-colors",
                      filters.genders.includes(gender)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted border-border hover:border-primary"
                    )}
                  >
                    {gender}
                  </button>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {groupedSubCategories.length > 0 && (
          <AccordionItem value="subcategories">
            <AccordionTrigger className="text-sm font-medium">
              Підкатегорії ({groupedSubCategories.length})
            </AccordionTrigger>
            <AccordionContent>
              <ScrollArea className="h-48">
                <div className="space-y-2 pr-4">
                  {groupedSubCategories.map((group) => (
                    <label key={group.id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={isGroupSelected(group, filters.subCategories)}
                        onCheckedChange={() => toggleSubcategoryGroup(group)}
                      />
                      <span className="text-sm">{group.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        ({group.count})
                      </span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </AccordionContent>
          </AccordionItem>
        )}

        {availableAttributes.map((attr) => (
          <AccordionItem key={attr.name} value={`attr-${attr.name}`}>
            <AccordionTrigger className="text-sm font-medium">
              {attr.name} ({attr.values.length})
            </AccordionTrigger>
            <AccordionContent>
              <ScrollArea className="h-40">
                <div className="space-y-2 pr-4">
                  {attr.values.map((value) => (
                    <label key={value} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={(filters.attributes[attr.name] || []).includes(value)}
                        onCheckedChange={() => toggleAttribute(attr.name, value)}
                      />
                      <span className="text-sm">{value}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </AccordionContent>
          </AccordionItem>
        ))}

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
    <div className="min-h-screen bg-background w-full max-w-[100vw] overflow-x-hidden">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-card border-b border-border w-full max-w-[100vw] overflow-x-hidden">
        <form onSubmit={handleSearch} className="flex items-center gap-2 p-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="relative flex-1 min-w-0">
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

          <button
            type="button"
            onClick={() => {
              if (products.length === 0) {
                toast.error("Немає товарів для стрічки");
                return;
              }
              setIsFeedOpen(true);
            }}
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0",
              products.length > 0
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
            title="Стрічка товарів"
            aria-label="Стрічка товарів"
          >
            <Clapperboard className="h-5 w-5" />
          </button>

          {/* Mobile Filter Button */}
          <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className={cn(
                  "relative w-10 h-10 shrink-0 rounded-xl flex items-center justify-center transition-all",
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
            {[...filters.niches, ...filters.seasons, ...filters.genders].map((value) => (
              <button
                key={value}
                onClick={() => {
                  if (filters.niches.includes(value)) toggleFilter("niches", value);
                  else if (filters.seasons.includes(value)) toggleFilter("seasons", value);
                  else toggleFilter("genders", value);
                }}
                className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full text-xs"
              >
                {value}
                <X className="h-3 w-3" />
              </button>
            ))}
            {Object.entries(filters.attributes).flatMap(([key, values]) =>
              values.map((value) => (
                <button
                  key={`${key}:${value}`}
                  onClick={() => toggleAttribute(key, value)}
                  className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full text-xs"
                >
                  {key}: {value}
                  <X className="h-3 w-3" />
                </button>
              ))
            )}
            {selectedSubGroups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => toggleSubcategoryGroup(group)}
                  className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full text-xs"
                >
                  {group.name}
                  <X className="h-3 w-3" />
                </button>
              ))}
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
        {(urlCategory || urlNiches.length > 0 || urlSubCategories.length > 0) && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground mb-3">
            {urlCategory && <span className="px-2 py-1 rounded-full bg-muted">{urlCategory}</span>}
            {urlNiches.map((niche) => (
              <span key={niche} className="px-2 py-1 rounded-full bg-muted">{niche}</span>
            ))}
            {urlSubCategoryLabel && (
              <span className="px-2 py-1 rounded-full bg-primary/10 text-primary">{urlSubCategoryLabel}</span>
            )}
          </div>
        )}

        <div className="mb-4">
          <PimFilterPills
            seasons={availableSeasons}
            niches={availableNiches}
            selectedSeasons={filters.seasons}
            selectedNiches={filters.niches}
            onToggleSeason={(value) => toggleFilter("seasons", value)}
            onToggleNiche={(value) => toggleFilter("niches", value)}
            subcategories={availableSubCategories}
            selectedSubcategories={filters.subCategories}
            onToggleSubcategoryGroup={toggleSubcategoryGroup}
          />
        </div>

        <div className="flex items-center justify-between gap-3 mb-4">
          <p className="text-sm text-muted-foreground">
            {showAll ? (
              <>Всі товари: {products.length}</>
            ) : query ? (
              <>Результати для "{query}": {products.length} товарів</>
            ) : (
              <>Товарів: {products.length}</>
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              if (products.length === 0) {
                toast.error("Немає товарів для стрічки");
                return;
              }
              setIsFeedOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-primary text-primary-foreground disabled:opacity-50"
            disabled={products.length === 0}
          >
            <Clapperboard className="h-3.5 w-3.5" />
            Стрічка товарів
          </button>
        </div>

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
                supplierName={product.supplier_name}
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

      <ProductFeedView
        isOpen={isFeedOpen}
        products={products}
        isFavorite={isFavorite}
        onClose={() => setIsFeedOpen(false)}
        onProductClick={(id) => {
          setIsFeedOpen(false);
          navigate(`/product/${id}`);
        }}
        onAddToCart={handleAddToCart}
        onToggleFavorite={handleToggleFavorite}
      />
    </div>
  );
}