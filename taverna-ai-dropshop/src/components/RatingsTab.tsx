import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Star, Trophy, TrendingUp, Users, ShoppingBag, Package, BarChart3, Gift, Crown, Zap, Award, Wallet, MessageSquare, BadgeCheck, Info, ChevronDown, ChevronUp, Shield, AlertTriangle, Calculator, Filter, SlidersHorizontal, Diamond } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

import { SupplierBadge, getSupplierBadge, getCustomerBadge, type SupplierBadgeInfo } from "@/components/ui/supplier-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RankCheckmark, RankCup, getRankBadge } from "@/components/ratings/RatingBadges";
import { RatingRulesSheet } from "@/components/ratings/RatingRulesSheet";

type Period = "day" | "week" | "month" | "year" | "alltime";
type RankFilter = "all" | "top3" | "top10" | "4-10";

interface CustomerRatingItem {
  rank: number;
  name: string;
  ordersCount: number;
  totalSpent: number;
  productsCount: number;
  avgRating: number;
  ratingsCount: number;
  badge?: SupplierBadgeInfo;
}

interface SupplierRatingItem {
  rank: number;
  shopName: string;
  soldCount: number;
  revenue: number;
  customersCount: number;
  avgRating: number;
  reviewsCount: number;
  badge?: SupplierBadgeInfo;
}

interface ShopReview {
  shopName: string;
  avgRating: number;
  reviewsCount: number;
  logo?: string;
}

interface ProductReview {
  productName: string;
  avgRating: number;
  reviewsCount: number;
  image?: string;
}

const generateCustomerRatings = (period: Period): CustomerRatingItem[] => {
  const multiplier = period === "day" ? 1 : period === "week" ? 7 : period === "month" ? 30 : period === "year" ? 365 : 1825;
  const baseRatings = [4.9, 4.8, 4.7, 4.6, 4.5, 4.4, 4.3, 4.2];
  return [
    { rank: 1, name: "Олекс***", ordersCount: 12 * multiplier / 30, totalSpent: 24500 * multiplier / 30, productsCount: 35 * multiplier / 30, avgRating: baseRatings[0], ratingsCount: Math.round(8 * multiplier / 30) },
    { rank: 2, name: "Мар***", ordersCount: 9 * multiplier / 30, totalSpent: 18200 * multiplier / 30, productsCount: 27 * multiplier / 30, avgRating: baseRatings[1], ratingsCount: Math.round(6 * multiplier / 30) },
    { rank: 3, name: "Дмит***", ordersCount: 7 * multiplier / 30, totalSpent: 14800 * multiplier / 30, productsCount: 21 * multiplier / 30, avgRating: baseRatings[2], ratingsCount: Math.round(5 * multiplier / 30) },
    { rank: 4, name: "Ірин***", ordersCount: 6 * multiplier / 30, totalSpent: 12100 * multiplier / 30, productsCount: 18 * multiplier / 30, avgRating: baseRatings[3], ratingsCount: Math.round(4 * multiplier / 30) },
    { rank: 5, name: "Серг***", ordersCount: 5 * multiplier / 30, totalSpent: 9800 * multiplier / 30, productsCount: 15 * multiplier / 30, avgRating: baseRatings[4], ratingsCount: Math.round(3 * multiplier / 30) },
    { rank: 6, name: "Анн***", ordersCount: 4 * multiplier / 30, totalSpent: 8200 * multiplier / 30, productsCount: 12 * multiplier / 30, avgRating: baseRatings[5], ratingsCount: Math.round(3 * multiplier / 30) },
    { rank: 7, name: "Вол***", ordersCount: 4 * multiplier / 30, totalSpent: 7500 * multiplier / 30, productsCount: 11 * multiplier / 30, avgRating: baseRatings[6], ratingsCount: Math.round(2 * multiplier / 30) },
    { rank: 8, name: "Нат***", ordersCount: 3 * multiplier / 30, totalSpent: 6100 * multiplier / 30, productsCount: 9 * multiplier / 30, avgRating: baseRatings[7], ratingsCount: Math.round(2 * multiplier / 30) },
  ].map((item, idx) => ({
    ...item,
    ordersCount: Math.max(1, Math.round(item.ordersCount)),
    totalSpent: Math.round(item.totalSpent),
    productsCount: Math.max(1, Math.round(item.productsCount)),
    ratingsCount: Math.max(0, item.ratingsCount),
    badge: getCustomerBadge(
      period === "year" ? idx + 1 : null,
      period === "month" ? idx + 1 : null,
      period === "week" ? idx + 1 : null,
      period === "day" ? idx + 1 : null,
      period === "alltime" ? idx + 1 : null,
    ),
  }));
};

const generateSupplierRatings = (period: Period): SupplierRatingItem[] => {
  const multiplier = period === "day" ? 1 : period === "week" ? 7 : period === "month" ? 30 : period === "year" ? 365 : 1825;
  return [
    { rank: 1, shopName: "Tactical Pro", soldCount: 145 * multiplier / 30, revenue: 289000 * multiplier / 30, customersCount: 89 * multiplier / 30, avgRating: 4.8, reviewsCount: Math.round(34 * multiplier / 30) },
    { rank: 2, shopName: "Military Store", soldCount: 112 * multiplier / 30, revenue: 224000 * multiplier / 30, customersCount: 71 * multiplier / 30, avgRating: 4.7, reviewsCount: Math.round(28 * multiplier / 30) },
    { rank: 3, shopName: "Urban Gear", soldCount: 98 * multiplier / 30, revenue: 196000 * multiplier / 30, customersCount: 64 * multiplier / 30, avgRating: 4.6, reviewsCount: Math.round(22 * multiplier / 30) },
    { rank: 4, shopName: "Alpha Gear", soldCount: 76 * multiplier / 30, revenue: 152000 * multiplier / 30, customersCount: 49 * multiplier / 30, avgRating: 4.5, reviewsCount: Math.round(16 * multiplier / 30) },
    { rank: 5, shopName: "Ranger Shop", soldCount: 61 * multiplier / 30, revenue: 122000 * multiplier / 30, customersCount: 41 * multiplier / 30, avgRating: 4.4, reviewsCount: Math.round(11 * multiplier / 30) },
  ].map((item, idx) => ({
    ...item,
    soldCount: Math.max(1, Math.round(item.soldCount)),
    revenue: Math.round(item.revenue),
    customersCount: Math.max(1, Math.round(item.customersCount)),
    reviewsCount: Math.max(0, item.reviewsCount),
    badge: getSupplierBadge(
      period === "year" ? idx + 1 : null,
      period === "month" ? idx + 1 : null,
      period === "week" ? idx + 1 : null,
      period === "day" ? idx + 1 : null,
      period === "alltime" ? idx + 1 : null,
    ),
  }));
};

const shopReviewsMock: ShopReview[] = [
  { shopName: "Tactical Pro", avgRating: 4.8, reviewsCount: 234 },
  { shopName: "Military Store", avgRating: 4.7, reviewsCount: 189 },
  { shopName: "Urban Gear", avgRating: 4.6, reviewsCount: 156 },
  { shopName: "Alpha Gear", avgRating: 4.5, reviewsCount: 112 },
  { shopName: "Ranger Shop", avgRating: 4.4, reviewsCount: 89 },
];

const periodLabels: Record<Period, string> = { day: "День", week: "Тиждень", month: "Місяць", year: "Рік", alltime: "Весь час" };
const rankColors = ["text-yellow-500", "text-slate-400", "text-amber-600"];
const rankBgs = ["bg-yellow-500/10", "bg-slate-400/10", "bg-amber-600/10"];

// Badge colors based on period tier (not place)
const periodBadgeColors: Record<Period, { text: string; bg: string; glow: string; shimmer: string }> = {
  alltime: { text: "text-violet-400", bg: "bg-violet-400/15", glow: "animate-badge-glow-diamond", shimmer: "text-diamond-shimmer" },
  year: { text: "text-yellow-500", bg: "bg-yellow-500/15", glow: "animate-badge-glow-gold", shimmer: "text-gold-shimmer" },
  month: { text: "text-slate-400", bg: "bg-slate-400/15", glow: "animate-badge-glow-silver", shimmer: "text-silver-shimmer" },
  week: { text: "text-amber-600", bg: "bg-amber-600/15", glow: "animate-badge-glow-bronze", shimmer: "text-bronze-shimmer" },
  day: { text: "text-blue-500", bg: "bg-blue-500/15", glow: "animate-badge-glow-blue", shimmer: "text-blue-shimmer" },
};

// Rebalanced customer bonus amounts per period — enhanced 1st place
const customerBonuses: Record<Period, { first: string; second: string; third: string }> = {
  day: { first: "+15₴ + безк. доставка (1 день)", second: "+5₴", third: "+3₴" },
  week: { first: "+50₴ + -5% знижка (тижд.)", second: "+15₴", third: "+8₴" },
  month: { first: "+200₴ + безк. доставка (міс.)", second: "+75₴", third: "+30₴" },
  year: { first: "+700₴ + VIP-статус", second: "+250₴", third: "+100₴" },
  alltime: { first: "🚚 Безк. доставка назавжди", second: "+500₴", third: "+200₴" },
};

// Rebalanced supplier perks per period — enhanced 1st place
const supplierPerks: Record<Period, { first: string; second: string; third: string }> = {
  day: { first: "Буст 24год + безк. пост", second: "Пріоритет", third: "+20 бонусів" },
  week: { first: "2 безк. пости + Буст 7дн", second: "Буст 3дн", third: "Пріоритет" },
  month: { first: "28% націнка + 2 безк. пости", second: "1 безк. пост", third: "Пріоритет" },
  year: { first: "25% на 3міс + VIP-бейдж", second: "30% на 2міс", third: "1 безк. реклама" },
  alltime: { first: "💎 23% назавжди", second: "28% на 3міс", third: "30% на 2міс" },
};

const StarRating = ({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" }) => (
  <div className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((s) => (
      <Star key={s} className={cn(size === "sm" ? "h-3 w-3" : "h-4 w-4", s <= Math.round(rating) ? "fill-warning text-warning" : "text-muted-foreground/30")} />
    ))}
    <span className={cn("ml-1 font-medium", size === "sm" ? "text-xs" : "text-sm")}>{rating.toFixed(1)}</span>
  </div>
);

const PeriodSelector = ({ period, onChange }: { period: Period; onChange: (p: Period) => void }) => (
  <div className="flex gap-0.5 bg-muted rounded-lg p-0.5">
    {(["day", "week", "month", "year", "alltime"] as Period[]).map((p) => (
      <button key={p} onClick={() => onChange(p)} className={cn("flex-1 text-xs font-medium py-1.5 px-1.5 rounded-md transition-all", period === p ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground", p === "alltime" && period === p && "bg-violet-500/10 text-violet-500")}>
        {periodLabels[p]}
      </button>
    ))}
  </div>
);

const mockCategories = [
  { id: "all", name: "Всі категорії" },
  { id: "tactical", name: "Тактичне спорядження" },
  { id: "clothing", name: "Одяг" },
  { id: "footwear", name: "Взуття" },
  { id: "accessories", name: "Аксесуари" },
  { id: "camping", name: "Кемпінг" },
];

const RankingFilters = ({
  rankFilter,
  setRankFilter,
  categoryFilter,
  setCategoryFilter,
}: {
  rankFilter: RankFilter;
  setRankFilter: (v: RankFilter) => void;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
}) => (
  <div className="flex gap-2">
    <Select value={rankFilter} onValueChange={(v) => setRankFilter(v as RankFilter)}>
      <SelectTrigger className="h-8 text-xs flex-1">
        <Filter className="h-3 w-3 mr-1 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Всі місця</SelectItem>
        <SelectItem value="top3">Топ 3</SelectItem>
        <SelectItem value="4-10">4-10 місце</SelectItem>
        <SelectItem value="top10">Топ 10</SelectItem>
      </SelectContent>
    </Select>
    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
      <SelectTrigger className="h-8 text-xs flex-1">
        <SlidersHorizontal className="h-3 w-3 mr-1 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {mockCategories.map((c) => (
          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

const filterByRank = <T extends { rank: number }>(items: T[], filter: RankFilter): T[] => {
  switch (filter) {
    case "top3": return items.filter((i) => i.rank <= 3);
    case "top10": return items.filter((i) => i.rank <= 10);
    case "4-10": return items.filter((i) => i.rank >= 4 && i.rank <= 10);
    default: return items;
  }
};

// Customer Rankings — unified single ranking
const CustomerRankings = () => {
  const [period, setPeriod] = useState<Period>("month");
  const [rankFilter, setRankFilter] = useState<RankFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const allCustomers = generateCustomerRatings(period);
  const customers = useMemo(() => filterByRank(allCustomers, rankFilter), [allCustomers, rankFilter]);
  const bonuses = customerBonuses[period];
  const isAlltime = period === "alltime";

  return (
    <div className="space-y-3">
      <PeriodSelector period={period} onChange={setPeriod} />
      <RankingFilters rankFilter={rankFilter} setRankFilter={setRankFilter} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} />

      {/* Prize pool banner */}
      <div className={cn("flex items-center gap-2 p-2.5 rounded-xl border", isAlltime ? "bg-violet-500/5 border-violet-500/20" : "bg-primary/5 border-primary/20")}>
        {isAlltime ? <Diamond className="h-4 w-4 text-violet-400 shrink-0" /> : <Gift className="h-4 w-4 text-primary shrink-0" />}
        <div className="flex-1 flex items-center gap-3 text-[10px]">
          <span className={cn("font-medium", isAlltime ? "text-violet-400" : "text-foreground")}>🥇 {bonuses.first}</span>
          <span className="text-muted-foreground">🥈 {bonuses.second}</span>
          <span className="text-muted-foreground">🥉 {bonuses.third}</span>
        </div>
      </div>

      {/* Alltime legend info */}
      {isAlltime && (
        <div className="p-2.5 rounded-xl bg-violet-500/5 border border-violet-500/10">
          <p className="text-[10px] text-muted-foreground">
            💎 <span className="font-medium text-violet-400">Легенда платформи</span> — №1 за весь час отримує безкоштовну доставку (до 150₴/замовлення) поки утримує 1 місце
          </p>
        </div>
      )}

      <div className="space-y-2">
        {customers.map((customer) => (
          <div key={customer.rank} className={cn(
            "p-3 rounded-xl border transition-all",
            customer.rank === 1 ? `${periodBadgeColors[period].bg} border-${period === "alltime" ? "violet-500/20" : "primary/20"}` :
            customer.rank <= 3 ? `${rankBgs[customer.rank - 1]} border-transparent` : "border-border bg-card"
          )}>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex items-center gap-1 flex-shrink-0">
                <RankCheckmark rank={customer.rank} period={period} />
                <RankCup rank={customer.rank} size="sm" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className={cn("font-semibold text-sm", customer.rank === 1 ? periodBadgeColors[period].shimmer : "text-foreground")}>{customer.name}</p>
                  {customer.badge && <SupplierBadge badge={{ ...customer.badge, ownerType: "customer" }} size="sm" />}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <StarRating rating={customer.avgRating} />
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <MessageSquare className="h-2.5 w-2.5" /> {customer.ratingsCount}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-primary">{customer.totalSpent.toLocaleString()}₴</p>
                {customer.rank <= 3 && (
                  <Badge variant="outline" className={cn("text-[8px] mt-0.5 px-1.5", isAlltime && customer.rank === 1 ? "border-violet-400/30 text-violet-400" : "border-primary/30 text-primary")}>
                    {customer.rank === 1 ? bonuses.first : customer.rank === 2 ? bonuses.second : bonuses.third}
                  </Badge>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-background/60 rounded-lg p-1.5 text-center">
                <p className="text-[9px] text-muted-foreground">Замовлень</p>
                <p className="text-xs font-bold text-foreground">{customer.ordersCount}</p>
              </div>
              <div className="bg-background/60 rounded-lg p-1.5 text-center">
                <p className="text-[9px] text-muted-foreground">Товарів</p>
                <p className="text-xs font-bold text-foreground">{customer.productsCount}</p>
              </div>
              <div className="bg-background/60 rounded-lg p-1.5 text-center">
                <p className="text-[9px] text-muted-foreground">Рейтинг</p>
                <p className="text-xs font-bold text-foreground">{customer.avgRating.toFixed(1)}</p>
              </div>
            </div>
          </div>
        ))}
        {customers.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-6">Немає результатів для обраного фільтру</p>
        )}
      </div>
    </div>
  );
};

// Supplier Rankings (public)
const SupplierRankings = () => {
  const [period, setPeriod] = useState<Period>("month");
  const [rankFilter, setRankFilter] = useState<RankFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const allSuppliers = generateSupplierRatings(period);
  const suppliers = useMemo(() => filterByRank(allSuppliers, rankFilter), [allSuppliers, rankFilter]);
  const perks = supplierPerks[period];
  const isAlltime = period === "alltime";

  return (
    <div className="space-y-3">
      <PeriodSelector period={period} onChange={setPeriod} />
      <RankingFilters rankFilter={rankFilter} setRankFilter={setRankFilter} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} />

      {/* Prize pool banner */}
      <div className={cn("flex items-center gap-2 p-2.5 rounded-xl border", isAlltime ? "bg-violet-500/5 border-violet-500/20" : "bg-accent/5 border-accent/20")}>
        {isAlltime ? <Diamond className="h-4 w-4 text-violet-400 shrink-0" /> : <Award className="h-4 w-4 text-accent-foreground shrink-0" />}
        <div className="flex-1 flex items-center gap-3 text-[10px]">
          <span className={cn("font-medium", isAlltime ? "text-violet-400" : "text-foreground")}>🥇 {perks.first}</span>
          <span className="text-muted-foreground">🥈 {perks.second}</span>
          <span className="text-muted-foreground">🥉 {perks.third}</span>
        </div>
      </div>

      {/* Alltime legend info */}
      {isAlltime && (
        <div className="p-2.5 rounded-xl bg-violet-500/5 border border-violet-500/10">
          <p className="text-[10px] text-muted-foreground">
            💎 <span className="font-medium text-violet-400">Легенда платформи</span> — №1 продавець за весь час отримує 25% націнку (замість 33%) поки утримує 1 місце
          </p>
        </div>
      )}

      <div className="space-y-2">
        {suppliers.map((supplier) => (
          <div key={supplier.rank} className={cn(
            "p-3 rounded-xl border transition-all",
            supplier.rank === 1 ? `${periodBadgeColors[period].bg} border-${period === "alltime" ? "violet-500/20" : "primary/20"}` :
            supplier.rank <= 3 ? `${rankBgs[supplier.rank - 1]} border-transparent` : "border-border bg-card"
          )}>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex items-center gap-1 flex-shrink-0">
                <RankCheckmark rank={supplier.rank} period={period} />
                <RankCup rank={supplier.rank} size="sm" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className={cn("font-semibold text-sm", supplier.rank === 1 ? periodBadgeColors[period].shimmer : "text-foreground")}>{supplier.shopName}</p>
                  {supplier.badge && <SupplierBadge badge={supplier.badge} size="sm" />}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <StarRating rating={supplier.avgRating} />
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <MessageSquare className="h-2.5 w-2.5" /> {supplier.reviewsCount}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-primary">{supplier.revenue.toLocaleString()}₴</p>
                {supplier.rank <= 3 && (
                  <Badge variant="outline" className={cn("text-[8px] mt-0.5 px-1.5", isAlltime && supplier.rank === 1 ? "border-violet-400/30 text-violet-400" : "border-primary/30 text-primary")}>
                    {supplier.rank === 1 ? perks.first : supplier.rank === 2 ? perks.second : perks.third}
                  </Badge>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-background/60 rounded-lg p-1.5 text-center">
                <p className="text-[9px] text-muted-foreground">Продано</p>
                <p className="text-xs font-bold text-foreground">{supplier.soldCount}</p>
              </div>
              <div className="bg-background/60 rounded-lg p-1.5 text-center">
                <p className="text-[9px] text-muted-foreground">Клієнтів</p>
                <p className="text-xs font-bold text-foreground">{supplier.customersCount}</p>
              </div>
              <div className="bg-background/60 rounded-lg p-1.5 text-center">
                <p className="text-[9px] text-muted-foreground">Рейтинг</p>
                <p className="text-xs font-bold text-foreground">{supplier.avgRating}</p>
              </div>
            </div>
          </div>
        ))}
        {suppliers.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-6">Немає результатів для обраного фільтру</p>
        )}
      </div>
    </div>
  );
};

interface MutualReview {
  id: string;
  direction: "client_to_shop" | "shop_to_client";
  author: string;
  target: string;
  rating: number;
  text: string;
  date: string;
  orderId: string;
  pending?: boolean;
}

const mutualReviewsMock: MutualReview[] = [
  { id: "r1", direction: "client_to_shop", author: "Олекс***", target: "Tactical Pro", rating: 5, text: "Швидка відправка, товар відповідає опису. Рекомендую!", date: "07.09.2026", orderId: "#1042-A" },
  { id: "r2", direction: "shop_to_client", author: "Tactical Pro", target: "Олекс***", rating: 5, text: "Уважний клієнт, оплата вчасно, без зайвих питань.", date: "07.09.2026", orderId: "#1042-A" },
  { id: "r3", direction: "client_to_shop", author: "Мар***", target: "Urban Gear", rating: 4, text: "Все добре, але доставка зайняла на день довше.", date: "05.09.2026", orderId: "#1038-C" },
  { id: "r4", direction: "shop_to_client", author: "Urban Gear", target: "Дмит***", rating: 3, text: "Замовлення забрано на 5 день, прохання забирати швидше.", date: "03.09.2026", orderId: "#1030-B" },
  { id: "r5", direction: "shop_to_client", author: "Military Store", target: "Ірин***", rating: 0, text: "Очікує вашої оцінки клієнта — 14 днів після доставки.", date: "02.09.2026", orderId: "#1026-D", pending: true },
];

/** Стрічка взаємних відгуків: клієнт → магазин та магазин → клієнт. */
const MutualReviews = () => {
  const [rated, setRated] = useState<string[]>([]);

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-2.5">
        <p className="text-[10px] text-muted-foreground">
          Продавець може оцінити клієнта протягом 14 днів після доставки. Оцінки впливають на рейтинг обох сторін.
        </p>
      </div>

      {mutualReviewsMock.map((r) => {
        const isClient = r.direction === "client_to_shop";
        const done = rated.includes(r.id);
        return (
          <div key={r.id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={cn(
                "text-[9px] font-semibold px-2 py-0.5 rounded-full",
                isClient ? "bg-primary/15 text-primary" : "bg-warning/15 text-warning",
              )}>
                {isClient ? "Клієнт → Магазин" : "Магазин → Клієнт"}
              </span>
              <span className="text-[10px] text-muted-foreground">{r.orderId}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{r.date}</span>
            </div>

            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground truncate">{r.author}</p>
              <span className="text-[10px] text-muted-foreground">про</span>
              <p className="text-xs text-muted-foreground truncate">{r.target}</p>
            </div>

            {r.pending || done ? (
              <div className="mt-2 flex items-center gap-2">
                <p className="text-[11px] text-muted-foreground flex-1">
                  {done ? "Оцінку надіслано, дякуємо!" : r.text}
                </p>
                {!done && (
                  <button
                    onClick={() => setRated((p) => [...p, r.id])}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-primary text-primary-foreground active:scale-95 transition-all"
                  >
                    Оцінити клієнта
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="mt-1">
                  <StarRating rating={r.rating} />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{r.text}</p>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};

// All Reviews — Shop / Product / Mutual reviews
const AllReviews = () => {
  const [subTab, setSubTab] = useState<"mutual" | "shops" | "products">("mutual");

  const tabs: { id: typeof subTab; label: string }[] = [
    { id: "mutual", label: "💬 Взаємні" },
    { id: "shops", label: "🏪 Магазини" },
    { id: "products", label: "📦 Товари" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-0.5 bg-muted rounded-lg p-0.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={cn(
              "flex-1 text-[11px] font-medium py-1.5 px-2 rounded-md transition-all",
              subTab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {subTab === "mutual" ? <MutualReviews /> : subTab === "shops" ? <ShopReviews /> : <ProductReviews />}
    </div>
  );
};

// Shop Reviews
const ShopReviews = () => {
  const [shopRatings, setShopRatings] = useState<ShopReview[]>(shopReviewsMock);

  useEffect(() => {
    const fetchRatings = async () => {
      try {
        const { data } = await supabase.from('app_ratings').select('target_id, rating').eq('rating_type', 'shop');
        if (data && data.length > 0) {
          const grouped = data.reduce((acc: Record<string, { total: number; count: number }>, r) => {
            const key = r.target_id || 'unknown';
            if (!acc[key]) acc[key] = { total: 0, count: 0 };
            acc[key].total += r.rating;
            acc[key].count += 1;
            return acc;
          }, {});
          const supplierIds = Object.keys(grouped);
          if (supplierIds.length > 0) {
            const { data: suppliers } = await supabase.from('suppliers').select('id, shop_name, logo_url').in('id', supplierIds);
            if (suppliers && suppliers.length > 0) {
              const realRatings = suppliers.map(s => ({
                shopName: s.shop_name,
                avgRating: grouped[s.id] ? Math.round((grouped[s.id].total / grouped[s.id].count) * 10) / 10 : 5.0,
                reviewsCount: grouped[s.id]?.count || 0,
                logo: s.logo_url || undefined,
              })).sort((a, b) => b.avgRating - a.avgRating);
              setShopRatings(realRatings);
            }
          }
        }
      } catch { /* fallback to mock */ }
    };
    fetchRatings();
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Публічний рейтинг магазинів на основі відгуків клієнтів</p>
      <div className="space-y-2">
        {shopRatings.map((shop, index) => (
          <div key={shop.shopName} className={cn("flex items-center gap-3 p-3 rounded-xl border", index < 3 ? `${rankBgs[index]} border-transparent` : "border-border bg-card")}>
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm", index < 3 ? rankBgs[index] : "bg-muted", index < 3 ? rankColors[index] : "text-muted-foreground")}>
              {index < 3 ? <Trophy className="h-5 w-5" /> : index + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-foreground">{shop.shopName}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <StarRating rating={shop.avgRating} />
                <span className="text-xs text-muted-foreground">({shop.reviewsCount})</span>
              </div>
            </div>
            <div className="w-16">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-warning rounded-full transition-all" style={{ width: `${(shop.avgRating / 5) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Product Reviews
const ProductReviews = () => {
  const [products, setProducts] = useState<ProductReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchProductReviews = async () => {
      try {
        const { data: reviews } = await supabase.from('reviews').select('product_id, rating').limit(500);
        if (reviews && reviews.length > 0) {
          const grouped = reviews.reduce((acc: Record<string, { total: number; count: number }>, r) => {
            const key = r.product_id || 'unknown';
            if (!acc[key]) acc[key] = { total: 0, count: 0 };
            acc[key].total += r.rating;
            acc[key].count += 1;
            return acc;
          }, {});
          const productIds = Object.keys(grouped).filter(k => k !== 'unknown').slice(0, 20);
          if (productIds.length > 0) {
            const { data: prods } = await supabase.from('products').select('id, name, images').in('id', productIds);
            if (prods && prods.length > 0) {
              const mapped = prods.map(p => ({
                productName: p.name,
                avgRating: grouped[p.id] ? Math.round((grouped[p.id].total / grouped[p.id].count) * 10) / 10 : 5.0,
                reviewsCount: grouped[p.id]?.count || 0,
                image: p.images?.[0] || undefined,
              })).sort((a, b) => b.avgRating - a.avgRating || b.reviewsCount - a.reviewsCount);
              setProducts(mapped);
              setIsLoading(false);
              return;
            }
          }
        }
        setProducts([
          { productName: "Тактичний рюкзак 45L", avgRating: 4.9, reviewsCount: 67 },
          { productName: "Берці зимові", avgRating: 4.8, reviewsCount: 54 },
          { productName: "Тактичні рукавиці", avgRating: 4.7, reviewsCount: 41 },
          { productName: "Флісова кофта", avgRating: 4.6, reviewsCount: 38 },
          { productName: "Термобілизна комплект", avgRating: 4.5, reviewsCount: 29 },
        ]);
      } catch {
        setProducts([
          { productName: "Тактичний рюкзак 45L", avgRating: 4.9, reviewsCount: 67 },
          { productName: "Берці зимові", avgRating: 4.8, reviewsCount: 54 },
          { productName: "Тактичні рукавиці", avgRating: 4.7, reviewsCount: 41 },
        ]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchProductReviews();
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Рейтинг товарів на основі відгуків покупців</p>
      <div className="space-y-2">
        {products.map((product, index) => (
          <div key={product.productName + index} className={cn("flex items-center gap-3 p-3 rounded-xl border", index < 3 ? `${rankBgs[index]} border-transparent` : "border-border bg-card")}>
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm overflow-hidden", index < 3 ? rankBgs[index] : "bg-muted", index < 3 ? rankColors[index] : "text-muted-foreground")}>
              {product.image ? (
                <img src={product.image} alt="" className="w-full h-full object-cover rounded-xl" />
              ) : index < 3 ? (
                <Trophy className="h-5 w-5" />
              ) : (
                index + 1
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-foreground truncate">{product.productName}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <StarRating rating={product.avgRating} />
                <span className="text-xs text-muted-foreground">({product.reviewsCount})</span>
              </div>
            </div>
            <div className="w-16">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-warning rounded-full transition-all" style={{ width: `${(product.avgRating / 5) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};


// ============ Мій рейтинг ============

const myPerks = [
  { icon: Gift, label: "Клієнтам", value: "+200₴", tone: "text-primary", bg: "bg-primary/10", active: true },
  { icon: ShoppingBag, label: "Безкоштовна доставка", value: "від 999₴", tone: "text-success", bg: "bg-success/10", active: true },
  { icon: Zap, label: "Множник бонусів", value: "×1.5", tone: "text-live", bg: "bg-live/10", active: true },
  { icon: Crown, label: "VIP-підтримка", value: "Пріоритет", tone: "text-yellow-500", bg: "bg-yellow-500/10", active: true },
  { icon: Award, label: "Кредити на публікації", value: "2 / міс", tone: "text-violet-400", bg: "bg-violet-400/10", active: false },
  { icon: Diamond, label: "Ексклюзивні дропи", value: "Легенда", tone: "text-violet-400", bg: "bg-violet-400/10", active: false },
];

/** Демо-позиції користувача по періодах. */
const myRanks: Record<Period, number> = { day: 6, week: 4, month: 2, year: 12, alltime: 34 };

const MyRatingSection = ({ points = 4380, onOpenRules }: { points?: number; onOpenRules: () => void }) => {
  const navigate = useNavigate();

  // Найкраща галочка: пріоритет alltime → year → month → week → day
  const order: Period[] = ["alltime", "year", "month", "week", "day"];
  const bestPeriod = order.find((p) => myRanks[p] <= 10) ?? "day";
  const bestRank = myRanks[bestPeriod];
  const badge = getRankBadge(bestRank, bestPeriod);
  const nextTarget = bestRank > 3 ? 3 : bestRank > 1 ? 1 : 1;
  const progress = Math.min(100, Math.round((points / 7000) * 100));

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-4">
        <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-primary/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center ring-1", badge.bg, badge.ring)}>
            <RankCheckmark rank={bestRank} period={bestPeriod} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className={cn("text-base font-bold truncate", badge.text)}>{badge.emoji} {badge.label}</p>
              <RankCup rank={bestRank} size="sm" />
            </div>
            <p className="text-xs text-muted-foreground">
              Загальний рейтинг: <span className="font-bold text-foreground">{points.toLocaleString("uk-UA")}</span>
            </p>
          </div>
          <button
            onClick={() => navigate("/wallet")}
            className="shrink-0 w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center active:scale-95 transition-transform"
            aria-label="Рахунок"
          >
            <Wallet className="h-4 w-4" />
          </button>
        </div>

        <div className="relative mt-3 grid grid-cols-5 gap-1.5">
          {(["day", "week", "month", "year", "alltime"] as Period[]).map((p) => (
            <div key={p} className="rounded-lg bg-background/60 p-1.5 text-center">
              <p className="text-[9px] text-muted-foreground">{periodLabels[p]}</p>
              <p className={cn("text-xs font-bold", myRanks[p] <= 10 ? "text-foreground" : "text-muted-foreground")}>
                #{myRanks[p]}
              </p>
            </div>
          ))}
        </div>

        <div className="relative mt-3">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
            <span>Місце #{bestRank} · {periodLabels[bestPeriod]}</span>
            <span>До Топ-{nextTarget} потрібно більше балів</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-live transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <button
        onClick={onOpenRules}
        className="w-full flex items-center gap-2 p-3 rounded-xl bg-muted/50 border border-border hover:bg-muted active:scale-[0.99] transition-all"
      >
        <Info className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-medium text-foreground flex-1 text-left">Правила рейтингу, кубки та штрафи</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground -rotate-90" />
      </button>

      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 px-0.5">Мої бонуси та привілеї</p>
        <div className="grid grid-cols-2 gap-2">
          {myPerks.map((p) => (
            <div
              key={p.label}
              className={cn(
                "rounded-xl border p-3 transition-all",
                p.active ? "border-border bg-card" : "border-dashed border-border bg-muted/30 opacity-60"
              )}
            >
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-2", p.bg)}>
                <p.icon className={cn("h-4 w-4", p.tone)} />
              </div>
              <p className="text-[11px] text-muted-foreground leading-tight">{p.label}</p>
              <p className={cn("text-sm font-bold", p.active ? "text-foreground" : "text-muted-foreground")}>{p.value}</p>
              {!p.active && <p className="text-[10px] text-muted-foreground mt-0.5">Відкриється на вищому рівні</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============ ТОП продавців ============

interface TopSeller {
  shopName: string;
  initials: string;
  gradient: string;
  rating: number;
  sales: number;
  positive: number;
  negative: number;
  points: number;
}

const SELLER_BASE = [
  { shopName: "Tactical Pro", initials: "TP", gradient: "from-emerald-500/30 to-lime-400/20" },
  { shopName: "Military Store", initials: "MS", gradient: "from-sky-500/30 to-cyan-400/20" },
  { shopName: "Urban Gear", initials: "UG", gradient: "from-amber-500/30 to-orange-400/20" },
  { shopName: "Alpha Gear", initials: "AG", gradient: "from-violet-500/30 to-fuchsia-400/20" },
  { shopName: "Ranger Shop", initials: "RS", gradient: "from-rose-500/30 to-pink-400/20" },
  { shopName: "Nord Tactical", initials: "NT", gradient: "from-indigo-500/30 to-blue-400/20" },
  { shopName: "Steel Line", initials: "SL", gradient: "from-slate-500/30 to-zinc-400/20" },
  { shopName: "Falcon Kit", initials: "FK", gradient: "from-teal-500/30 to-emerald-400/20" },
  { shopName: "Vector Shop", initials: "VS", gradient: "from-orange-500/30 to-red-400/20" },
  { shopName: "Base Camp", initials: "BC", gradient: "from-lime-500/30 to-green-400/20" },
];

const PERIOD_SCALE: Record<Period, number> = { day: 1, week: 6, month: 24, year: 260, alltime: 980 };

const buildSellers = (period: Period): TopSeller[] => {
  const scale = PERIOD_SCALE[period];
  return SELLER_BASE.map((base, i) => {
    const sales = Math.max(1, Math.round((20 - i * 1.7) * scale));
    const rating = Math.round((4.95 - i * 0.07) * 10) / 10;
    const negative = Math.max(0, Math.round(sales * (0.02 + i * 0.006)));
    return {
      ...base,
      rating,
      sales,
      negative,
      positive: sales - negative,
      points: Math.round(sales * 18 + rating * 900 - negative * 25),
    };
  });
};

const PeriodPills = ({ period, onChange }: { period: Period; onChange: (p: Period) => void }) => (
  <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-0.5 px-0.5">
    {(["day", "week", "month", "year", "alltime"] as Period[]).map((p) => (
      <button
        key={p}
        onClick={() => onChange(p)}
        className={cn(
          "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all active:scale-95",
          period === p
            ? "bg-primary text-primary-foreground border-primary shadow-sm"
            : "bg-transparent text-muted-foreground border-border hover:text-foreground"
        )}
      >
        {periodLabels[p]}
      </button>
    ))}
  </div>
);

const SellerCard = ({ seller, rank, period }: { seller: TopSeller; rank: number; period: Period }) => {
  const total = seller.positive + seller.negative;
  const positiveShare = total ? (seller.positive / total) * 100 : 0;
  const badge = getRankBadge(rank, period);
  const isFirst = rank === 1;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card overflow-hidden transition-all",
        isFirst
          ? "border-yellow-500/50 shadow-[0_10px_30px_-16px_hsl(45_93%_47%/0.8)]"
          : rank <= 3
            ? "border-border ring-1 ring-border"
            : "border-border"
      )}
    >
      <div className={cn("relative h-14 bg-gradient-to-r", seller.gradient)}>
        <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-card/85 backdrop-blur-sm px-1.5 py-1">
          <span className="text-[11px] font-bold text-foreground">#{rank}</span>
          <RankCheckmark rank={rank} period={period} size="sm" />
          <RankCup rank={rank} size="sm" />
        </div>
        {badge.kind !== "none" && (
          <span className={cn("absolute top-2.5 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-card/85 backdrop-blur-sm", badge.text)}>
            {badge.emoji} {badge.label}
          </span>
        )}
      </div>

      <div className="px-3 pb-3 -mt-6">
        <div className="flex items-end gap-2.5">
          <div className={cn(
            "w-12 h-12 rounded-xl bg-card border-2 border-card shadow-sm flex items-center justify-center text-sm font-bold text-foreground ring-1",
            isFirst ? "ring-yellow-500/50" : "ring-border"
          )}>
            {seller.initials}
          </div>
          <div className="min-w-0 flex-1 pb-0.5">
            <p className="text-sm font-bold text-foreground truncate">{seller.shopName}</p>
            <StarRating rating={seller.rating} />
          </div>
          <div className="text-right pb-0.5">
            <p className={cn("text-base font-extrabold leading-none", isFirst ? "text-yellow-500" : "text-foreground")}>
              {seller.points.toLocaleString("uk-UA")}
            </p>
            <p className="text-[10px] text-muted-foreground">балів</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
            <p className="text-[10px] text-muted-foreground">Продажів</p>
            <p className="text-sm font-bold text-foreground">{seller.sales.toLocaleString("uk-UA")}</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
            <p className="text-[10px] text-muted-foreground">Позитивних</p>
            <p className="text-sm font-bold text-success">{positiveShare.toFixed(1)}%</p>
          </div>
        </div>

        <div className="mt-2 h-1.5 rounded-full overflow-hidden flex">
          <div className="bg-success h-full" style={{ width: `${positiveShare}%` }} />
          <div className="bg-destructive h-full" style={{ width: `${100 - positiveShare}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>👍 {seller.positive.toLocaleString("uk-UA")}</span>
          <span>👎 {seller.negative.toLocaleString("uk-UA")}</span>
        </div>
      </div>
    </div>
  );
};

type SellerView = "leaders" | "suppliers" | "customers" | "reviews";

const sellerViews: { id: SellerView; label: string }[] = [
  { id: "leaders", label: "Лідери" },
  { id: "suppliers", label: "Продавці" },
  { id: "customers", label: "Клієнти" },
  { id: "reviews", label: "Відгуки" },
];

const TopSellersSection = () => {
  const [period, setPeriod] = useState<Period>("month");
  const [view, setView] = useState<SellerView>("leaders");
  const sellers = useMemo(() => buildSellers(period), [period]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-muted rounded-lg p-0.5">
        {sellerViews.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={cn(
              "flex-1 text-[11px] font-medium py-1.5 rounded-md transition-all",
              view === v.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "leaders" && (
        <>
          <PeriodPills period={period} onChange={setPeriod} />
          <div className="space-y-2.5">
            {sellers.map((s, i) => (
              <SellerCard key={s.shopName} seller={s} rank={i + 1} period={period} />
            ))}
          </div>
        </>
      )}

      {view === "suppliers" && <SupplierRankings />}
      {view === "customers" && <CustomerRankings />}
      {view === "reviews" && <AllReviews />}
    </div>
  );
};

export const RatingsTab = () => {
  const navigate = useNavigate();
  const [rulesOpen, setRulesOpen] = useState(false);


  return (
    <div className="space-y-4 pb-28 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-rating" />
          <h2 className="text-lg font-bold text-foreground">Рейтинги</h2>
          <div className="flex items-center gap-1 ml-1">
            <BarChart3 className="h-3.5 w-3.5 text-rating animate-pulse" />
            <span className="text-xs font-medium text-rating">LIVE</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setRulesOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-foreground text-xs font-medium hover:bg-muted/70 active:scale-95 transition-all"
          >
            <Info className="h-3.5 w-3.5" />
            Правила
          </button>
          <button
            onClick={() => navigate("/wallet")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 active:scale-95 transition-all"
          >
            <Trophy className="h-3.5 w-3.5" />
            Бонуси
          </button>
        </div>
      </div>

      <Tabs defaultValue="my" className="w-full">
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="my" className="text-xs">
            <Crown className="h-3.5 w-3.5 mr-1" />
            Мій рейтинг
          </TabsTrigger>
          <TabsTrigger value="top" className="text-xs">
            <Trophy className="h-3.5 w-3.5 mr-1" />
            ТОП Рейтингів
          </TabsTrigger>
        </TabsList>

        <TabsContent value="my" className="mt-3 space-y-3">
          <MyRatingSection onOpenRules={() => setRulesOpen(true)} />
        </TabsContent>
        <TabsContent value="top" className="mt-3">
          <TopSellersSection />
        </TabsContent>
      </Tabs>

      <RatingRulesSheet open={rulesOpen} onOpenChange={setRulesOpen} />
    </div>
  );
};

