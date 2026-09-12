import { useState } from "react";
import { SlidersHorizontal, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";

export interface QuickFilterState {
  minPrice: number;
  maxPrice: number;
  colors: string[];
  sizes: string[];
  brands: string[];
  inStockOnly: boolean;
  sortBy: "newest" | "price_asc" | "price_desc" | "popular";
}

interface CategoryFiltersBarProps {
  filters: QuickFilterState;
  onFiltersChange: (filters: QuickFilterState) => void;
  availableColors?: string[];
  availableSizes?: string[];
  availableBrands?: string[];
  priceRange?: { min: number; max: number };
  onOpenAdvancedFilters?: () => void;
  totalResults?: number;
}

const sortOptions = [
  { value: "newest", label: "Новинки" },
  { value: "popular", label: "Популярні" },
  { value: "price_asc", label: "Від дешевих" },
  { value: "price_desc", label: "Від дорогих" },
];

export const CategoryFiltersBar = ({
  filters,
  onFiltersChange,
  availableColors = [],
  availableSizes = [],
  availableBrands = [],
  priceRange = { min: 0, max: 50000 },
  onOpenAdvancedFilters,
  totalResults,
}: CategoryFiltersBarProps) => {
  const [isPriceOpen, setIsPriceOpen] = useState(false);

  const activeFiltersCount =
    filters.colors.length +
    filters.sizes.length +
    filters.brands.length +
    (filters.minPrice > priceRange.min ? 1 : 0) +
    (filters.maxPrice < priceRange.max ? 1 : 0) +
    (filters.inStockOnly ? 1 : 0);

  const toggleArrayFilter = (key: "colors" | "sizes" | "brands", value: string) => {
    const arr = filters[key];
    if (arr.includes(value)) {
      onFiltersChange({ ...filters, [key]: arr.filter((v) => v !== value) });
    } else {
      onFiltersChange({ ...filters, [key]: [...arr, value] });
    }
  };

  const clearAllFilters = () => {
    onFiltersChange({
      minPrice: priceRange.min,
      maxPrice: priceRange.max,
      colors: [],
      sizes: [],
      brands: [],
      inStockOnly: false,
      sortBy: filters.sortBy,
    });
  };

  return (
    <div className="space-y-3">
      {/* Main filters row */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {/* Sort Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
              {sortOptions.find((o) => o.value === filters.sortBy)?.label || "Сортування"}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Сортування</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {sortOptions.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={filters.sortBy === option.value}
                onCheckedChange={() =>
                  onFiltersChange({ ...filters, sortBy: option.value as QuickFilterState["sortBy"] })
                }
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Price Filter */}
        <DropdownMenu open={isPriceOpen} onOpenChange={setIsPriceOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant={filters.minPrice > priceRange.min || filters.maxPrice < priceRange.max ? "default" : "outline"}
              size="sm"
              className="gap-1.5 shrink-0"
            >
              💰 Ціна
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 p-4">
            <div className="space-y-4">
              <Slider
                value={[filters.minPrice, filters.maxPrice]}
                min={priceRange.min}
                max={priceRange.max}
                step={100}
                onValueChange={([min, max]) =>
                  onFiltersChange({ ...filters, minPrice: min, maxPrice: max })
                }
              />
              <div className="flex items-center justify-between text-sm">
                <span>{filters.minPrice.toLocaleString()} ₴</span>
                <span>{filters.maxPrice.toLocaleString()} ₴</span>
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={() => setIsPriceOpen(false)}
              >
                Застосувати
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Size Filter */}
        {availableSizes.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={filters.sizes.length > 0 ? "default" : "outline"}
                size="sm"
                className="gap-1.5 shrink-0"
              >
                📐 Розмір
                {filters.sizes.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                    {filters.sizes.length}
                  </Badge>
                )}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
              <DropdownMenuLabel>Розмір</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableSizes.map((size) => (
                <DropdownMenuCheckboxItem
                  key={size}
                  checked={filters.sizes.includes(size)}
                  onCheckedChange={() => toggleArrayFilter("sizes", size)}
                >
                  {size}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Color Filter */}
        {availableColors.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={filters.colors.length > 0 ? "default" : "outline"}
                size="sm"
                className="gap-1.5 shrink-0"
              >
                🎨 Колір
                {filters.colors.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                    {filters.colors.length}
                  </Badge>
                )}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
              <DropdownMenuLabel>Колір</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableColors.map((color) => (
                <DropdownMenuCheckboxItem
                  key={color}
                  checked={filters.colors.includes(color)}
                  onCheckedChange={() => toggleArrayFilter("colors", color)}
                >
                  {color}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Brand Filter */}
        {availableBrands.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={filters.brands.length > 0 ? "default" : "outline"}
                size="sm"
                className="gap-1.5 shrink-0"
              >
                🏷️ Бренд
                {filters.brands.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                    {filters.brands.length}
                  </Badge>
                )}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
              <DropdownMenuLabel>Бренд</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableBrands.map((brand) => (
                <DropdownMenuCheckboxItem
                  key={brand}
                  checked={filters.brands.includes(brand)}
                  onCheckedChange={() => toggleArrayFilter("brands", brand)}
                >
                  {brand}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* In Stock Toggle */}
        <Button
          variant={filters.inStockOnly ? "default" : "outline"}
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => onFiltersChange({ ...filters, inStockOnly: !filters.inStockOnly })}
        >
          ✅ В наявності
        </Button>

        {/* Advanced Filters */}
        {onOpenAdvancedFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenAdvancedFilters}
            className="gap-1.5 shrink-0"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Більше
            {activeFiltersCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                {activeFiltersCount}
              </Badge>
            )}
          </Button>
        )}
      </div>

      {/* Active filters chips */}
      {activeFiltersCount > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Активні фільтри:</span>
          
          {filters.colors.map((color) => (
            <Badge
              key={`color-${color}`}
              variant="secondary"
              className="gap-1 cursor-pointer hover:bg-destructive/20"
              onClick={() => toggleArrayFilter("colors", color)}
            >
              {color}
              <X className="h-3 w-3" />
            </Badge>
          ))}
          
          {filters.sizes.map((size) => (
            <Badge
              key={`size-${size}`}
              variant="secondary"
              className="gap-1 cursor-pointer hover:bg-destructive/20"
              onClick={() => toggleArrayFilter("sizes", size)}
            >
              {size}
              <X className="h-3 w-3" />
            </Badge>
          ))}
          
          {filters.brands.map((brand) => (
            <Badge
              key={`brand-${brand}`}
              variant="secondary"
              className="gap-1 cursor-pointer hover:bg-destructive/20"
              onClick={() => toggleArrayFilter("brands", brand)}
            >
              {brand}
              <X className="h-3 w-3" />
            </Badge>
          ))}

          {(filters.minPrice > priceRange.min || filters.maxPrice < priceRange.max) && (
            <Badge variant="secondary" className="gap-1">
              {filters.minPrice.toLocaleString()} - {filters.maxPrice.toLocaleString()} ₴
            </Badge>
          )}

          {filters.inStockOnly && (
            <Badge
              variant="secondary"
              className="gap-1 cursor-pointer hover:bg-destructive/20"
              onClick={() => onFiltersChange({ ...filters, inStockOnly: false })}
            >
              В наявності
              <X className="h-3 w-3" />
            </Badge>
          )}

          <button
            onClick={clearAllFilters}
            className="text-xs text-destructive hover:underline"
          >
            Скинути все
          </button>
        </div>
      )}

      {/* Results count */}
      {totalResults !== undefined && (
        <div className="text-sm text-muted-foreground">
          Знайдено: <span className="font-medium text-foreground">{totalResults}</span> товарів
        </div>
      )}
    </div>
  );
};
