import { useState } from "react";
import { SlidersHorizontal, X, Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export interface FilterState {
  categories: string[];
  minPrice: number;
  maxPrice: number;
  colors: string[];
  sizes: string[];
  brands: string[];
  inStockOnly: boolean;
}

interface Category {
  id: string;
  name: string;
  count?: number;
}

interface AdvancedFiltersSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  categories?: Category[];
  availableColors?: string[];
  availableSizes?: string[];
  availableBrands?: string[];
  priceRange?: { min: number; max: number };
  onApply?: () => void;
}

const colorMap: Record<string, string> = {
  "Чорний": "bg-gray-900",
  "Білий": "bg-white border-2 border-border",
  "Олива": "bg-[#556B2F]",
  "Мультикам": "bg-gradient-to-r from-[#5a4a3a] via-[#7a6a5a] to-[#4a3a2a]",
  "Койот": "bg-[#8B7355]",
  "Сірий": "bg-gray-500",
  "Хакі": "bg-[#5a5a3a]",
  "Піксель": "bg-gradient-to-r from-[#5a6a5a] via-[#7a8a7a] to-[#4a5a4a]",
};

const sizeOrder = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"];

export const AdvancedFiltersSheet = ({
  isOpen,
  onOpenChange,
  filters,
  onFiltersChange,
  categories = [],
  availableColors = [],
  availableSizes = [],
  availableBrands = [],
  priceRange = { min: 0, max: 50000 },
  onApply,
}: AdvancedFiltersSheetProps) => {
  const [isListening, setIsListening] = useState(false);

  const toggleFilter = (key: keyof FilterState, value: string) => {
    const arr = filters[key] as string[];
    if (arr.includes(value)) {
      onFiltersChange({ ...filters, [key]: arr.filter((v) => v !== value) });
    } else {
      onFiltersChange({ ...filters, [key]: [...arr, value] });
    }
  };

  const clearFilters = () => {
    onFiltersChange({
      categories: [],
      minPrice: priceRange.min,
      maxPrice: priceRange.max,
      colors: [],
      sizes: [],
      brands: [],
      inStockOnly: false,
    });
  };

  const activeFiltersCount =
    filters.categories.length +
    filters.colors.length +
    filters.sizes.length +
    filters.brands.length +
    (filters.minPrice > priceRange.min ? 1 : 0) +
    (filters.maxPrice < priceRange.max ? 1 : 0) +
    (filters.inStockOnly ? 1 : 0);

  const sortedSizes = availableSizes.sort((a, b) => {
    const aIndex = sizeOrder.indexOf(a);
    const bIndex = sizeOrder.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  const handleVoiceInput = () => {
    if (!("webkitSpeechRecognition" in window)) {
      return;
    }
    setIsListening(!isListening);
    // Voice recognition would be implemented here
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] rounded-t-3xl bg-card/95 backdrop-blur-xl border-t border-border/50 shadow-2xl">
        <SheetHeader className="text-left pb-4 border-b border-border">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2 text-lg">
              <SlidersHorizontal className="h-5 w-5" />
              Фільтри
              {activeFiltersCount > 0 && (
                <span className="ml-2 px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-full">
                  {activeFiltersCount}
                </span>
              )}
            </SheetTitle>
            {activeFiltersCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Скинути все
              </Button>
            )}
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100%-140px)] mt-4">
          <div className="space-y-6 pr-4">
            {/* Price Range */}
            <div className="space-y-4">
              <h4 className="font-semibold text-foreground flex items-center gap-2">
                💰 Ціна
              </h4>
              <Slider
                value={[filters.minPrice, filters.maxPrice]}
                min={priceRange.min}
                max={priceRange.max}
                step={100}
                onValueChange={([min, max]) =>
                  onFiltersChange({ ...filters, minPrice: min, maxPrice: max })
                }
                className="w-full"
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={filters.minPrice}
                    onChange={(e) =>
                      onFiltersChange({ ...filters, minPrice: Number(e.target.value) })
                    }
                    className="w-24 px-3 py-2 text-sm bg-muted border border-border rounded-lg text-center"
                  />
                  <span className="text-muted-foreground">—</span>
                  <input
                    type="number"
                    value={filters.maxPrice}
                    onChange={(e) =>
                      onFiltersChange({ ...filters, maxPrice: Number(e.target.value) })
                    }
                    className="w-24 px-3 py-2 text-sm bg-muted border border-border rounded-lg text-center"
                  />
                  <span className="text-muted-foreground text-sm">₴</span>
                </div>
              </div>
            </div>

            {/* In Stock Only */}
            <label className="flex items-center gap-3 cursor-pointer p-3 bg-muted/50 rounded-xl">
              <Checkbox
                checked={filters.inStockOnly}
                onCheckedChange={(checked) =>
                  onFiltersChange({ ...filters, inStockOnly: !!checked })
                }
              />
              <span className="text-sm font-medium">Тільки в наявності</span>
              <span className="ml-auto text-xs text-success">● В наявності</span>
            </label>

            <Accordion type="multiple" defaultValue={["categories", "sizes"]} className="w-full">
              {/* Categories */}
              {categories.length > 0 && (
                <AccordionItem value="categories" className="border-b-0">
                  <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
                    📦 Категорії ({categories.length})
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {categories.map((cat) => (
                        <button
                          key={cat.id}
                          onClick={() => toggleFilter("categories", cat.id)}
                          className={cn(
                            "px-4 py-2 rounded-xl text-sm font-medium transition-all",
                            filters.categories.includes(cat.id)
                              ? "bg-primary text-primary-foreground shadow-md"
                              : "bg-muted hover:bg-muted/80 text-foreground"
                          )}
                        >
                          {cat.name}
                          {cat.count !== undefined && (
                            <span className="ml-1 opacity-60">({cat.count})</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Sizes */}
              {sortedSizes.length > 0 && (
                <AccordionItem value="sizes" className="border-b-0">
                  <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
                    📐 Розмір ({sortedSizes.length})
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {sortedSizes.map((size) => (
                        <button
                          key={size}
                          onClick={() => toggleFilter("sizes", size)}
                          className={cn(
                            "min-w-[48px] h-10 px-3 rounded-lg text-sm font-medium transition-all border-2",
                            filters.sizes.includes(size)
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-card border-border hover:border-primary"
                          )}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Colors */}
              {availableColors.length > 0 && (
                <AccordionItem value="colors" className="border-b-0">
                  <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
                    🎨 Колір ({availableColors.length})
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-wrap gap-3 pt-2">
                      {availableColors.map((color) => (
                        <button
                          key={color}
                          onClick={() => toggleFilter("colors", color)}
                          className={cn(
                            "flex flex-col items-center gap-1 p-2 rounded-xl transition-all",
                            filters.colors.includes(color)
                              ? "bg-primary/10 ring-2 ring-primary"
                              : "hover:bg-muted"
                          )}
                        >
                          <div
                            className={cn(
                              "w-8 h-8 rounded-full",
                              colorMap[color] || "bg-muted"
                            )}
                          />
                          <span className="text-xs">{color}</span>
                        </button>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Brands */}
              {availableBrands.length > 0 && (
                <AccordionItem value="brands" className="border-b-0">
                  <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
                    🏷️ Бренд ({availableBrands.length})
                  </AccordionTrigger>
                  <AccordionContent>
                    <ScrollArea className="h-40">
                      <div className="space-y-2 pr-4">
                        {availableBrands.map((brand) => (
                          <label
                            key={brand}
                            className="flex items-center gap-3 cursor-pointer py-2"
                          >
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
            </Accordion>
          </div>
        </ScrollArea>

        <SheetFooter className="absolute bottom-0 left-0 right-0 p-4 bg-card/95 backdrop-blur-xl border-t border-border safe-area-pb">
          <div className="flex gap-3 w-full">
            {activeFiltersCount > 0 && (
              <Button
                variant="outline"
                onClick={clearFilters}
                className="flex-shrink-0"
              >
                Скинути
              </Button>
            )}
            <Button
              onClick={() => {
                onApply?.();
                onOpenChange(false);
              }}
              className="flex-1 h-12 text-base font-semibold"
            >
              Показати результати
              {activeFiltersCount > 0 && ` (${activeFiltersCount})`}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
