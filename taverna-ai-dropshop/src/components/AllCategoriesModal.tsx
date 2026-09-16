import { useState, useEffect } from "react";
import { ChevronRight, ArrowLeft, Loader2 } from "lucide-react";
import { Shield, Shirt, Watch, Footprints, Backpack, Target, Car, Gamepad, Gift, Home, Smartphone, Baby } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchBackendCategories, fetchBackendFilters, BackendApiError, type BackendCategorySub } from "@/lib/backendApi";
import { getCategoryGradient } from "@/lib/categoryColors";
import { encodeSubCategoryParam, groupSubcategories } from "@/utils/categoryParser";
import { SmartSubcategoryList } from "@/components/catalog/SmartSubcategoryList";
import { useModalHistory } from "@/hooks/useModalHistory";
import {
  PimFilterPills,
  FALLBACK_SEASONS,
  FALLBACK_NICHES,
  mergeUniqueLabels,
} from "@/components/catalog/PimFilterPills";

interface CategoryNiche {
  id: string;
  name: string;
  count: number;
  subcategories?: { id: string; name: string; count: number }[];
}

interface Category {
  id: string;
  slug: string;
  name: string;
  icon: React.ReactNode;
  count: number;
  gradient: string;
  subcategories?: { id: string; name: string; count: number }[];
  niches?: CategoryNiche[];
}

interface AllCategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCategory: (categoryId: string, subcategoryId?: string, niche?: string, season?: string) => void;
}

// Icon mapping by slug
const iconMap: Record<string, React.ReactNode> = {
  'military': <Shield className="h-5 w-5" />,
  'clothing': <Shirt className="h-5 w-5" />,
  'accessories': <Watch className="h-5 w-5" />,
  'footwear': <Footprints className="h-5 w-5" />,
  'bags': <Backpack className="h-5 w-5" />,
  'tactical': <Target className="h-5 w-5" />,
  'auto': <Car className="h-5 w-5" />,
  'gaming': <Gamepad className="h-5 w-5" />,
  'gifts': <Gift className="h-5 w-5" />,
  'home': <Home className="h-5 w-5" />,
  'electronics': <Smartphone className="h-5 w-5" />,
  'kids': <Baby className="h-5 w-5" />,
  'одяг': <Shirt className="h-5 w-5" />,
  'взуття': <Footprints className="h-5 w-5" />,
  'спорядження': <Target className="h-5 w-5" />,
  'аксесуари': <Watch className="h-5 w-5" />,
  'головні убори': <Shield className="h-5 w-5" />,
  'рюкзаки та сумки': <Backpack className="h-5 w-5" />,
};

// Fallback static categories (using getCategoryGradient for consistency)
const allCategories: Category[] = [
  { 
    id: "military", 
    slug: "military",
    name: "Мілітарі", 
    icon: iconMap['military'], 
    count: 156, 
    gradient: getCategoryGradient('military'),
    subcategories: [
      { id: "military-clothes", name: "Одяг", count: 45 },
      { id: "military-boots", name: "Взуття", count: 32 },
      { id: "military-accessories", name: "Аксесуари", count: 28 },
      { id: "military-headwear", name: "Головні убори", count: 18 },
      { id: "military-tactical", name: "Тактичне спорядження", count: 33 },
    ]
  },
  { 
    id: "clothing", 
    slug: "clothing",
    name: "Одяг", 
    icon: iconMap['clothing'], 
    count: 234, 
    gradient: getCategoryGradient('clothing'),
    subcategories: [
      { id: "clothing-men", name: "Чоловічий", count: 120 },
      { id: "clothing-women", name: "Жіночий", count: 80 },
      { id: "clothing-kids", name: "Дитячий", count: 34 },
    ]
  },
  { 
    id: "accessories", 
    slug: "accessories",
    name: "Аксесуари", 
    icon: iconMap['accessories'], 
    count: 89, 
    gradient: getCategoryGradient('accessories'),
    subcategories: [
      { id: "accessories-watches", name: "Годинники", count: 25 },
      { id: "accessories-glasses", name: "Окуляри", count: 18 },
      { id: "accessories-belts", name: "Ремені", count: 22 },
      { id: "accessories-other", name: "Інше", count: 24 },
    ]
  },
  { 
    id: "footwear", 
    slug: "footwear",
    name: "Взуття", 
    icon: iconMap['footwear'], 
    count: 67, 
    gradient: getCategoryGradient('footwear'),
    subcategories: [
      { id: "footwear-boots", name: "Берці", count: 25 },
      { id: "footwear-sneakers", name: "Кросівки", count: 22 },
      { id: "footwear-sandals", name: "Сандалі", count: 20 },
    ]
  },
  { 
    id: "bags", 
    slug: "bags",
    name: "Сумки та рюкзаки", 
    icon: iconMap['bags'], 
    count: 45, 
    gradient: getCategoryGradient('bags'),
    subcategories: [
      { id: "bags-backpacks", name: "Рюкзаки", count: 25 },
      { id: "bags-tactical", name: "Тактичні сумки", count: 12 },
      { id: "bags-everyday", name: "Повсякденні", count: 8 },
    ]
  },
  { id: "tactical", slug: "tactical", name: "Тактика", icon: iconMap['tactical'], count: 112, gradient: getCategoryGradient('tactical') },
  { id: "auto", slug: "auto", name: "Авто", icon: iconMap['auto'], count: 78, gradient: getCategoryGradient('auto') },
  { id: "gaming", slug: "gaming", name: "Ігри та розваги", icon: iconMap['gaming'], count: 56, gradient: getCategoryGradient('gaming') },
  { id: "gifts", slug: "gifts", name: "Подарунки", icon: iconMap['gifts'], count: 43, gradient: getCategoryGradient('gifts') },
  { id: "home", slug: "home", name: "Дім та сад", icon: iconMap['home'], count: 98, gradient: getCategoryGradient('home') },
  { id: "electronics", slug: "electronics", name: "Електроніка", icon: iconMap['electronics'], count: 134, gradient: getCategoryGradient('electronics') },
  { id: "kids", slug: "kids", name: "Дитячі товари", icon: iconMap['kids'], count: 67, gradient: getCategoryGradient('kids') },
];

export const AllCategoriesModal = ({ isOpen, onClose, onSelectCategory }: AllCategoriesModalProps) => {
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [dbCategories, setDbCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pillSeasons, setPillSeasons] = useState<string[]>([]);
  const [pillNiches, setPillNiches] = useState<string[]>([]);
  const [availableSeasons, setAvailableSeasons] = useState<string[]>(FALLBACK_SEASONS);
  const [availableNiches, setAvailableNiches] = useState<string[]>(FALLBACK_NICHES);
  const [liveSubs, setLiveSubs] = useState<BackendCategorySub[] | null>(null);
  const [isFiltersLoading, setIsFiltersLoading] = useState(false);

  const closeLayer = () => {
    if (selectedCategory) {
      setSelectedCategory(null);
      setPillSeasons([]);
      setPillNiches([]);
      setLiveSubs(null);
      return;
    }
    onClose();
  };

  useModalHistory(isOpen, closeLayer);

  // Меню будуємо з GET /api/v1/products/categories — лише AI-тексти
  // (Одяг, Взуття...) з підкатегоріями, без сирих MyDrop ID.
  useEffect(() => {
    if (!isOpen) {
      setSelectedCategory(null);
      setPillSeasons([]);
      setPillNiches([]);
      setLiveSubs(null);
      return;
    }

    const fetchCategories = async () => {
      setIsLoading(true);
      try {
        const backendCategories = await fetchBackendCategories();
        const categoriesFromBackend: Category[] = backendCategories.map((cat) => ({
          id: cat.name,
          slug: cat.name,
          name: cat.name,
          icon: iconMap[cat.name.toLowerCase()] || <Target className="h-5 w-5" />,
          count: cat.count,
          gradient: getCategoryGradient(cat.name),
          subcategories: (cat.subcategories || []).map((sub) => ({
            id: sub.name,
            name: sub.name,
            count: sub.count,
          })),
          niches: (cat.niches || []).map((niche) => ({
            id: niche.name,
            name: niche.name,
            count: niche.count,
            subcategories: (niche.subcategories || []).map((sub) => ({
              id: sub.name,
              name: sub.name,
              count: sub.count,
            })),
          })),
        }));

        // Fallback до статичних категорій, якщо бекенд ще не має товарів/категорій
        setDbCategories(categoriesFromBackend.length > 0 ? categoriesFromBackend : allCategories);
      } catch (err) {
        const message = err instanceof BackendApiError ? err.message : String(err);
        console.error('Error fetching categories from backend:', message);
        setDbCategories(allCategories);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCategories();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !selectedCategory) {
      setLiveSubs(null);
      return;
    }

    let cancelled = false;
    const loadLiveSubs = async () => {
      setIsFiltersLoading(true);
      try {
        const pimFilters = await fetchBackendFilters({
          main_category: selectedCategory.name,
          niche: pillNiches,
          season: pillSeasons,
        });
        if (cancelled) return;
        setAvailableSeasons(mergeUniqueLabels(pimFilters.season || [], FALLBACK_SEASONS));
        setAvailableNiches(mergeUniqueLabels(pimFilters.target_niche || [], FALLBACK_NICHES));
        setLiveSubs(pimFilters.sub_categories || []);
      } catch {
        if (!cancelled) setLiveSubs(null);
      } finally {
        if (!cancelled) setIsFiltersLoading(false);
      }
    };
    loadLiveSubs();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedCategory, pillSeasons, pillNiches]);

  if (!isOpen) return null;

  const categoriesToShow = dbCategories.length > 0 ? dbCategories : allCategories;

  const handleCategoryClick = (category: Category) => {
    setSelectedCategory(category);
    setPillSeasons([]);
    setPillNiches([]);
    setLiveSubs(null);
  };

  const applyCategorySelection = (originals?: string[]) => {
    if (!selectedCategory) return;
    onSelectCategory(
      selectedCategory.id,
      originals?.length ? encodeSubCategoryParam(originals) : undefined,
      pillNiches.join(",") || undefined,
      pillSeasons.join(",") || undefined
    );
    onClose();
  };

  const handleBack = () => {
    setSelectedCategory(null);
    setPillSeasons([]);
    setPillNiches([]);
    setLiveSubs(null);
  };

  const visibleSubs = liveSubs
    ? liveSubs.map((sub) => ({ name: sub.name, count: sub.count }))
    : (selectedCategory?.subcategories || []).map((sub) => ({ name: sub.name, count: sub.count }));
  const groupedSubs = groupSubcategories(visibleSubs);
  const totalCount = liveSubs
    ? liveSubs.reduce((sum, sub) => sum + sub.count, 0)
    : selectedCategory?.count || 0;

  return (
    <div className="fixed inset-0 z-[60] bg-background animate-fade-in flex flex-col w-full max-w-[100vw] overflow-x-hidden">
      {/* Header */}
      <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center gap-3 shrink-0 w-full min-w-0">
        <button
          onClick={selectedCategory ? handleBack : onClose}
          className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="font-bold text-lg text-foreground truncate min-w-0">
          {selectedCategory ? selectedCategory.name : "Всі категорії"}
        </h2>
      </div>

      {/* Content with ScrollArea */}
      <ScrollArea className="flex-1 min-w-0">
        <div className="p-4 pb-24 w-full max-w-[100vw] min-w-0 overflow-x-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : selectedCategory ? (
            <div className="space-y-3">
              <PimFilterPills
                seasons={availableSeasons}
                niches={availableNiches}
                selectedSeasons={pillSeasons}
                selectedNiches={pillNiches}
                onToggleSeason={(value) =>
                  setPillSeasons((prev) =>
                    prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
                  )
                }
                onToggleNiche={(value) =>
                  setPillNiches((prev) =>
                    prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
                  )
                }
              />

              <SmartSubcategoryList
                groups={groupedSubs}
                totalCount={totalCount}
                isLoading={isFiltersLoading}
                parentCategory={selectedCategory.name}
                allIcon={selectedCategory.icon}
                onSelectAll={() => applyCategorySelection()}
                onSelectGroup={(group) => applyCategorySelection(group.originals)}
                onCloseModal={onClose}
              />
            </div>
          ) : (
            // All Categories View
            <div className="grid grid-cols-2 gap-3">
              {categoriesToShow.map((category, index) => (
                <motion.button
                  key={category.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03, duration: 0.3 }}
                  whileHover={{ scale: 1.03, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleCategoryClick(category)}
                  className={cn(
                    "relative overflow-hidden rounded-2xl p-4 text-left min-w-0",
                    "bg-gradient-to-br",
                    category.gradient,
                    "text-primary-foreground",
                    "shadow-lg hover:shadow-xl",
                    "min-h-[110px]",
                    "transform-gpu"
                  )}
                >
                  {/* Premium Background Pattern */}
                  <div className="absolute inset-0 opacity-[0.12]">
                    <div className="absolute -right-6 -bottom-6 w-28 h-28 rounded-full bg-white blur-sm" />
                    <div className="absolute -right-10 -top-10 w-24 h-24 rounded-full bg-white/80 blur-md" />
                  </div>

                  {/* Content */}
                  <div className="relative z-10">
                    <div className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center mb-3 shadow-inner border border-white/10">
                      {category.icon}
                    </div>
                    <h3 className="font-bold text-sm tracking-tight truncate">{category.name}</h3>
                    <p className="text-xs opacity-75 mt-1 font-medium">{category.count} товарів</p>
                    {category.subcategories && (
                      <ChevronRight className="absolute top-4 right-3 h-4 w-4 opacity-70" />
                    )}
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
