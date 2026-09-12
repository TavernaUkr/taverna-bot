import { Package, Ruler, Palette, Cpu, Weight, Battery, Monitor, Shirt, Footprints, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductSpecsProps {
  attributes?: Record<string, unknown>;
  categoryName?: string;
  sizes?: string[];
  colors?: string[];
  brand?: string;
  model?: string;
}

// Map of attribute keys to display labels (Ukrainian)
const attributeLabels: Record<string, { label: string; icon?: React.ReactNode }> = {
  // Clothing
  material: { label: "Матеріал", icon: <Shirt className="h-4 w-4" /> },
  size: { label: "Розмір", icon: <Ruler className="h-4 w-4" /> },
  color: { label: "Колір", icon: <Palette className="h-4 w-4" /> },
  height: { label: "Зріст", icon: <Ruler className="h-4 w-4" /> },
  waist: { label: "Обхват талії", icon: <Ruler className="h-4 w-4" /> },
  chest: { label: "Обхват грудей", icon: <Ruler className="h-4 w-4" /> },
  weight: { label: "Вага", icon: <Weight className="h-4 w-4" /> },
  
  // Electronics
  screen: { label: "Екран", icon: <Monitor className="h-4 w-4" /> },
  memory: { label: "Пам'ять", icon: <Cpu className="h-4 w-4" /> },
  ram: { label: "RAM", icon: <Cpu className="h-4 w-4" /> },
  battery: { label: "Акумулятор", icon: <Battery className="h-4 w-4" /> },
  processor: { label: "Процесор", icon: <Cpu className="h-4 w-4" /> },
  storage: { label: "Накопичувач", icon: <Cpu className="h-4 w-4" /> },
  power: { label: "Потужність", icon: <Battery className="h-4 w-4" /> },
  
  // Dimensions (Toys, Furniture)
  width: { label: "Ширина", icon: <Ruler className="h-4 w-4" /> },
  length: { label: "Довжина", icon: <Ruler className="h-4 w-4" /> },
  depth: { label: "Глибина", icon: <Ruler className="h-4 w-4" /> },
  dimensions: { label: "Габарити", icon: <Ruler className="h-4 w-4" /> },
  
  // Footwear
  sole: { label: "Підошва", icon: <Footprints className="h-4 w-4" /> },
  upper: { label: "Верх", icon: <Footprints className="h-4 w-4" /> },
  footwear_type: { label: "Тип взуття", icon: <Footprints className="h-4 w-4" /> },
  
  // Military/Tactical
  protection_class: { label: "Клас захисту", icon: <Package className="h-4 w-4" /> },
  capacity: { label: "Об'єм", icon: <Package className="h-4 w-4" /> },
  load_capacity: { label: "Навантаження", icon: <Dumbbell className="h-4 w-4" /> },
  waterproof: { label: "Водостійкість", icon: <Package className="h-4 w-4" /> },
  
  // Generic
  country: { label: "Країна виробник", icon: <Package className="h-4 w-4" /> },
  warranty: { label: "Гарантія", icon: <Package className="h-4 w-4" /> },
  manufacturer: { label: "Виробник", icon: <Package className="h-4 w-4" /> },
};

// Category-specific attribute priorities
const categoryPriorities: Record<string, string[]> = {
  "Смартфони": ["screen", "memory", "ram", "battery", "processor", "storage"],
  "Телефони": ["screen", "memory", "battery"],
  "Електроніка": ["power", "battery", "dimensions", "weight"],
  "Одяг": ["material", "height", "waist", "chest", "color"],
  "Взуття": ["material", "sole", "upper", "footwear_type", "waterproof"],
  "Іграшки": ["width", "height", "depth", "material", "weight"],
  "Меблі": ["width", "height", "depth", "material", "weight", "load_capacity"],
  "Мілітарі": ["material", "protection_class", "capacity", "waterproof", "weight"],
  "Тактичне": ["material", "capacity", "load_capacity", "waterproof"],
  "Рюкзаки": ["capacity", "material", "dimensions", "waterproof"],
};

const getAttributeLabel = (key: string): { label: string; icon?: React.ReactNode } => {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  
  for (const [attrKey, value] of Object.entries(attributeLabels)) {
    if (attrKey.toLowerCase().replace(/[_-]/g, "") === normalized) {
      return value;
    }
  }
  
  // Fallback: capitalize the key
  return { 
    label: key.charAt(0).toUpperCase() + key.slice(1).replace(/[_-]/g, " "),
    icon: <Package className="h-4 w-4" />
  };
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Так" : "Ні";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
};

export const ProductSpecs = ({
  attributes,
  categoryName,
  sizes,
  colors,
  brand,
  model,
}: ProductSpecsProps) => {
  // Build specs array from attributes
  const specs: { key: string; label: string; value: string; icon?: React.ReactNode }[] = [];
  
  // Add brand and model first if available
  if (brand) {
    specs.push({ key: "brand", label: "Бренд", value: brand, icon: <Package className="h-4 w-4" /> });
  }
  if (model) {
    specs.push({ key: "model", label: "Модель", value: model, icon: <Package className="h-4 w-4" /> });
  }
  
  // Get priority keys for this category
  const priorityKeys = categoryName 
    ? categoryPriorities[categoryName] || [] 
    : [];
  
  // Process attributes with priority sorting
  if (attributes && typeof attributes === "object") {
    const attrEntries = Object.entries(attributes)
      .filter(([_, value]) => value !== null && value !== undefined && value !== "")
      .sort((a, b) => {
        const aIndex = priorityKeys.indexOf(a[0].toLowerCase());
        const bIndex = priorityKeys.indexOf(b[0].toLowerCase());
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
    
    for (const [key, value] of attrEntries) {
      const { label, icon } = getAttributeLabel(key);
      specs.push({ key, label, value: formatValue(value), icon });
    }
  }
  
  // Add sizes and colors if not in attributes
  if (sizes?.length && !specs.find(s => s.key === "sizes")) {
    specs.push({ 
      key: "sizes", 
      label: "Доступні розміри", 
      value: sizes.join(", "),
      icon: <Ruler className="h-4 w-4" />
    });
  }
  
  if (colors?.length && !specs.find(s => s.key === "colors")) {
    specs.push({ 
      key: "colors", 
      label: "Кольори", 
      value: colors.join(", "),
      icon: <Palette className="h-4 w-4" />
    });
  }
  
  if (specs.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Характеристики не вказані</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {specs.map((spec, index) => (
        <div
          key={spec.key}
          className={cn(
            "flex items-center justify-between py-3 px-2 rounded-lg",
            index % 2 === 0 ? "bg-muted/30" : "bg-transparent"
          )}
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            {spec.icon && (
              <span className="text-primary/70">{spec.icon}</span>
            )}
            <span className="text-sm">{spec.label}</span>
          </div>
          <span className="text-sm font-medium text-foreground text-right max-w-[60%] truncate">
            {spec.value}
          </span>
        </div>
      ))}
    </div>
  );
};
