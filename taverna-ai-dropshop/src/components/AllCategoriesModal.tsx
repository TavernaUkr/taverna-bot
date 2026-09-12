import { useState, useEffect } from "react";
import { ChevronRight, ArrowLeft, Loader2 } from "lucide-react";
import { Shield, Shirt, Watch, Footprints, Backpack, Target, Car, Gamepad, Gift, Home, Smartphone, Baby } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { getCategoryGradient } from "@/lib/categoryColors";
import { motion } from "framer-motion";

interface Category {
  id: string;
  slug: string;
  name: string;
  icon: React.ReactNode;
  count: number;
  gradient: string;
  subcategories?: { id: string; name: string; count: number }[];
}

interface AllCategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCategory: (categoryId: string, subcategoryId?: string) => void;
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

  // Fetch categories from database
  useEffect(() => {
    if (!isOpen) return;
    
    const fetchCategories = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('categories')
          .select('id, name, slug, parent_id, product_count, is_active')
          .eq('is_active', true)
          .order('name');
        
        if (error) throw error;
        
        if (data && data.length > 0) {
          // Build hierarchical structure
          const parentCategories = data.filter(c => !c.parent_id);
          const childCategories = data.filter(c => c.parent_id);
          
          const categoriesWithSubs: Category[] = parentCategories.map(parent => {
            const subs = childCategories
              .filter(c => c.parent_id === parent.id)
              .map(c => ({ id: c.id, name: c.name, count: c.product_count || 0 }));
            
            return {
              id: parent.id,
              slug: parent.slug,
              name: parent.name,
              icon: iconMap[parent.slug] || <Target className="h-5 w-5" />,
              count: parent.product_count || 0,
              gradient: getCategoryGradient(parent.slug),
              subcategories: subs.length > 0 ? subs : undefined,
            };
          });
          
          setDbCategories(categoriesWithSubs);
        } else {
          // Fallback to static categories if no DB data
          setDbCategories(allCategories);
        }
      } catch (err) {
        console.error('Error fetching categories:', err);
        setDbCategories(allCategories);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchCategories();
  }, [isOpen]);

  if (!isOpen) return null;

  const categoriesToShow = dbCategories.length > 0 ? dbCategories : allCategories;

  const handleCategoryClick = (category: Category) => {
    if (category.subcategories && category.subcategories.length > 0) {
      setSelectedCategory(category);
    } else {
      onSelectCategory(category.id);
      onClose();
    }
  };

  const handleSubcategoryClick = (categoryId: string, subcategoryId: string) => {
    onSelectCategory(categoryId, subcategoryId);
    onClose();
  };

  const handleBack = () => {
    setSelectedCategory(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-background animate-fade-in flex flex-col">
      {/* Header */}
      <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center gap-3 shrink-0">
        <button
          onClick={selectedCategory ? handleBack : onClose}
          className="w-11 h-11 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="font-bold text-lg text-foreground">
          {selectedCategory ? selectedCategory.name : "Всі категорії"}
        </h2>
      </div>

      {/* Content with ScrollArea */}
      <ScrollArea className="flex-1">
        <div className="p-4 pb-24">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : selectedCategory ? (
            // Subcategories View
            <div className="space-y-2">
              {/* All in category */}
              <button
                onClick={() => {
                  onSelectCategory(selectedCategory.id);
                  onClose();
                }}
                className="w-full p-4 rounded-xl bg-card border border-border hover:border-primary/50 flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center text-white",
                    selectedCategory.gradient
                  )}>
                    {selectedCategory.icon}
                  </div>
                  <div className="text-left">
                    <span className="font-medium text-foreground">Всі товари</span>
                    <p className="text-xs text-muted-foreground">{selectedCategory.count} товарів</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>

              {/* Subcategories */}
              {selectedCategory.subcategories?.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => handleSubcategoryClick(selectedCategory.id, sub.id)}
                  className="w-full p-4 rounded-xl bg-card border border-border hover:border-primary/50 flex items-center justify-between transition-all"
                >
                  <div className="text-left">
                    <span className="font-medium text-foreground">{sub.name}</span>
                    <p className="text-xs text-muted-foreground">{sub.count} товарів</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </button>
              ))}
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
                    "relative overflow-hidden rounded-2xl p-4 text-left",
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
                    <h3 className="font-bold text-sm tracking-tight">{category.name}</h3>
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
