import { useEffect, useState } from "react";
import { 
  Package, UserPlus, Sparkles, TrendingUp, Truck, 
  RefreshCw, ShoppingCart, MessageSquare, Store, Star, Zap
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ActivityItem {
  id: string;
  type: "order" | "supplier" | "product" | "ai" | "delivery" | "review" | "registration" | "supplier_sale" | "supplier_new" | "supplier_rating";
  message: string;
  timestamp: Date;
  isSupplierEvent?: boolean;
  meta?: {
    name?: string;
    amount?: number;
    count?: number;
  };
}

const activityIcons: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  order: { icon: ShoppingCart, color: "text-success", bg: "bg-success/10" },
  supplier: { icon: Package, color: "text-primary", bg: "bg-primary/10" },
  product: { icon: TrendingUp, color: "text-accent", bg: "bg-accent/10" },
  ai: { icon: Sparkles, color: "text-warning", bg: "bg-warning/10" },
  delivery: { icon: Truck, color: "text-blue-500", bg: "bg-blue-500/10" },
  review: { icon: MessageSquare, color: "text-purple-500", bg: "bg-purple-500/10" },
  registration: { icon: UserPlus, color: "text-pink-500", bg: "bg-pink-500/10" },
  supplier_sale: { icon: Zap, color: "text-rating", bg: "bg-rating/10" },
  supplier_new: { icon: Store, color: "text-primary", bg: "bg-primary/10" },
  supplier_rating: { icon: Star, color: "text-warning", bg: "bg-warning/10" },
};

const clientMessages: Record<string, string[]> = {
  order: [
    "Користувач {name} оплатив замовлення на {amount}₴",
    "Нове замовлення #{count} через Telegram Wallet",
    "Замовлення відправлено клієнту {name}",
  ],
  registration: [
    "Новий користувач {name} зареєструвався",
    "Реферальне запрошення від {name}",
    "{count} нових користувачів за годину",
  ],
  delivery: [
    "Посилка {name} доставлена у відділення",
    "Оновлено статус {count} відправлень",
    "Нова Пошта: посилку отримано",
  ],
  review: [
    "Користувач {name} залишив відгук ⭐⭐⭐⭐⭐",
    "Новий відгук з фото на товар",
    "Відповідь на відгук від постачальника",
  ],
};

const supplierMessages: Record<string, string[]> = {
  supplier_sale: [
    "🏪 Магазин '{name}' — продано {count} товарів за годину",
    "💰 Новий продаж у '{name}': +{amount}₴",
    "📦 '{name}' відправив {count} замовлень сьогодні",
  ],
  supplier_new: [
    "🆕 Новий магазин '{name}' приєднався до Taverna",
    "✅ Магазин '{name}' верифіковано та активовано",
    "📋 '{name}' додав {count} нових товарів",
  ],
  supplier_rating: [
    "⭐ Магазин '{name}' отримав 5 зірок",
    "🏆 '{name}' — рейтинг підвищено до {amount}",
    "💬 {count} нових відгуків для магазину '{name}'",
  ],
  ai: [
    "🤖 Gemini проаналізував асортимент {count} магазинів",
    "✨ AI згенерував описи для {count} товарів",
    "🔍 Автокатегоризація: {count} товарів розподілено",
  ],
  product: [
    "🔥 Товар '{name}' — бестселер тижня",
    "📈 Зростання попиту на {count} товарів",
    "💎 Новинка тижня в категорії Military",
  ],
};

// Mock data generator
const generateMockActivity = (forceType?: string): ActivityItem => {
  const clientTypes = ["order", "registration", "delivery", "review"];
  const supplierTypes = ["supplier_sale", "supplier_new", "supplier_rating", "ai", "product"];

  const isSupplierEvent = forceType 
    ? supplierTypes.includes(forceType)
    : Math.random() > 0.5;

  const types = isSupplierEvent ? supplierTypes : clientTypes;
  const type = (forceType || types[Math.floor(Math.random() * types.length)]) as ActivityItem["type"];

  const allMessages = { ...clientMessages, ...supplierMessages };
  const messages = allMessages[type] || supplierMessages.supplier_sale;
  
  const shopNames = ["Tactical Pro", "Military Store", "Urban Gear", "Alpha Gear", "Ranger Shop", "Spec Ops"];
  const names = ["Олександр", "Марія", "Дмитро", "Анна", "Іван"];
  const namePool = isSupplierEvent ? shopNames : names;

  const message = messages[Math.floor(Math.random() * messages.length)]
    .replace("{name}", namePool[Math.floor(Math.random() * namePool.length)])
    .replace("{amount}", (Math.random() * 5 + 4).toFixed(1))
    .replace("{amount}", String(Math.floor(Math.random() * 5000) + 500))
    .replace("{count}", String(Math.floor(Math.random() * 50) + 1));

  return {
    id: Date.now().toString() + Math.random(),
    type,
    message,
    timestamp: new Date(),
    isSupplierEvent,
  };
};

interface LiveActivityFeedProps {
  className?: string;
  maxItems?: number;
  autoRefresh?: boolean;
  filter?: "all" | "clients" | "suppliers";
}

export const LiveActivityFeed = ({ 
  className, 
  maxItems = 15,
  autoRefresh = true,
  filter = "all",
}: LiveActivityFeedProps) => {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"all" | "clients" | "suppliers">(filter);

  // Initial load with mixed events
  useEffect(() => {
    const initial: ActivityItem[] = [];
    for (let i = 0; i < 8; i++) {
      initial.push(generateMockActivity(i % 2 === 0 ? undefined : 
        ["supplier_sale", "supplier_new", "supplier_rating"][i % 3]));
    }
    setActivities(initial);
  }, []);

  // Auto-refresh simulation
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      const newActivity = generateMockActivity();
      setActivities((prev) => [newActivity, ...prev].slice(0, maxItems));
    }, 6000);

    return () => clearInterval(interval);
  }, [autoRefresh, maxItems]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      const newActivity = generateMockActivity();
      setActivities((prev) => [newActivity, ...prev].slice(0, maxItems));
      setIsRefreshing(false);
    }, 500);
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return "щойно";
    if (diff < 3600) return `${Math.floor(diff / 60)} хв тому`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} год тому`;
    return date.toLocaleDateString("uk-UA");
  };

  const filteredActivities = activities.filter(a => {
    if (activeFilter === "all") return true;
    if (activeFilter === "suppliers") return a.isSupplierEvent;
    return !a.isSupplierEvent;
  });

  return (
    <div className={cn("bg-card rounded-xl border border-border overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-foreground">Live Активність</h3>
          <span className="w-2 h-2 rounded-full bg-live animate-pulse" />
        </div>
        <button
          onClick={handleRefresh}
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center",
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            "transition-all",
            isRefreshing && "animate-spin"
          )}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-2 bg-muted/40 border-b border-border">
        {(["all", "clients", "suppliers"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={cn(
              "flex-1 text-[10px] font-medium py-1.5 px-2 rounded-lg transition-all",
              activeFilter === f
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {f === "all" ? "Всі" : f === "clients" ? "🛍 Клієнти" : "🏪 Магазини"}
          </button>
        ))}
      </div>

      {/* Activity List */}
      <ScrollArea className="h-[320px]">
        <div className="p-2 space-y-1">
          {filteredActivities.map((activity, index) => {
            const iconConfig = activityIcons[activity.type] || activityIcons.order;
            const { icon: Icon, color, bg } = iconConfig;
            return (
              <div
                key={activity.id}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors",
                  index === 0 && "animate-slide-up",
                  activity.isSupplierEvent && "border-l-2 border-rating/40"
                )}
              >
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", bg)}>
                  <Icon className={cn("h-4 w-4", color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{activity.message}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatTime(activity.timestamp)}
                  </p>
                </div>
              </div>
            );
          })}
          {filteredActivities.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Немає подій за цим фільтром
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
