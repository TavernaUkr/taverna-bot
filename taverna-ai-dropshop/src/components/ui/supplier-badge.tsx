import { Trophy, BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type BadgeTier = "diamond" | "gold" | "silver" | "bronze" | "daily" | "verified" | null;
export type BadgeOwnerType = "supplier" | "customer";

export interface SupplierBadgeInfo {
  tier: BadgeTier;
  place?: number; // 1, 2, or 3
  period?: "day" | "week" | "month" | "year" | "alltime";
  ownerType?: BadgeOwnerType;
}

const tierConfig = {
  diamond: {
    label: "Діамантова галочка",
    supplierDesc: "№1 у загальному рейтингу за весь час",
    customerDesc: "№1 покупець за весь час",
    checkColor: "text-violet-400",
    checkBg: "bg-violet-400/15",
    trophyColor: "text-violet-400",
  },
  gold: {
    label: "Золота галочка",
    supplierDesc: "Топ 1-3 за рік",
    customerDesc: "Топ 1-3 покупців за рік",
    checkColor: "text-yellow-500",
    checkBg: "bg-yellow-500/15",
    trophyColor: "text-yellow-500",
  },
  silver: {
    label: "Срібна галочка",
    supplierDesc: "Топ 1-3 за місяць",
    customerDesc: "Топ 1-3 покупців за місяць",
    checkColor: "text-slate-400",
    checkBg: "bg-slate-400/15",
    trophyColor: "text-slate-400",
  },
  bronze: {
    label: "Бронзова галочка",
    supplierDesc: "Топ 1-3 за тиждень",
    customerDesc: "Топ 1-3 покупців за тиждень",
    checkColor: "text-amber-600",
    checkBg: "bg-amber-600/15",
    trophyColor: "text-amber-600",
  },
  daily: {
    label: "Синя галочка",
    supplierDesc: "Топ 1-3 за день",
    customerDesc: "Топ 1-3 покупців за день",
    checkColor: "text-blue-500",
    checkBg: "bg-blue-500/15",
    trophyColor: "text-blue-500",
  },
  verified: {
    label: "Верифікований",
    supplierDesc: "Топ 4-10 у рейтингу",
    customerDesc: "Топ 4-10 покупців",
    checkColor: "text-emerald-500",
    checkBg: "bg-emerald-500/15",
    trophyColor: "",
  },
};

const placeColors: Record<number, string> = {
  1: "text-yellow-500",
  2: "text-slate-400",
  3: "text-amber-600",
};

const periodLabels: Record<string, string> = {
  day: "день",
  week: "тиждень",
  month: "місяць",
  year: "рік",
  alltime: "весь час",
};

export function getSupplierBadge(
  yearlyRank?: number | null,
  monthlyRank?: number | null,
  weeklyRank?: number | null,
  dailyRank?: number | null,
  allTimeRank?: number | null,
): SupplierBadgeInfo {
  // Diamond is highest priority — #1 all-time only
  if (allTimeRank && allTimeRank === 1) {
    return { tier: "diamond", place: 1, period: "alltime" };
  }
  // All-time 2-3 get gold-equivalent
  if (allTimeRank && allTimeRank >= 2 && allTimeRank <= 3) {
    return { tier: "gold", place: allTimeRank, period: "alltime" };
  }
  if (yearlyRank && yearlyRank >= 1 && yearlyRank <= 3) {
    return { tier: "gold", place: yearlyRank, period: "year" };
  }
  if (monthlyRank && monthlyRank >= 1 && monthlyRank <= 3) {
    return { tier: "silver", place: monthlyRank, period: "month" };
  }
  if (weeklyRank && weeklyRank >= 1 && weeklyRank <= 3) {
    return { tier: "bronze", place: weeklyRank, period: "week" };
  }
  if (dailyRank && dailyRank >= 1 && dailyRank <= 3) {
    return { tier: "daily", place: dailyRank, period: "day" };
  }
  if (
    (allTimeRank && allTimeRank >= 4 && allTimeRank <= 10) ||
    (yearlyRank && yearlyRank >= 4 && yearlyRank <= 10) ||
    (monthlyRank && monthlyRank >= 4 && monthlyRank <= 10) ||
    (weeklyRank && weeklyRank >= 4 && weeklyRank <= 10) ||
    (dailyRank && dailyRank >= 4 && dailyRank <= 10)
  ) {
    return { tier: "verified" };
  }
  return { tier: null };
}

// Alias for customer badges — same logic
export const getCustomerBadge = getSupplierBadge;

interface SupplierBadgeProps {
  badge: SupplierBadgeInfo;
  size?: "sm" | "md";
  showTooltip?: boolean;
  className?: string;
}

const glowClasses: Record<string, string> = {
  diamond: "animate-badge-glow-diamond",
  gold: "animate-badge-glow-gold",
  silver: "animate-badge-glow-silver",
  bronze: "animate-badge-glow-bronze",
  daily: "animate-badge-glow-blue",
};

export function SupplierBadge({
  badge,
  size = "sm",
  showTooltip = true,
  className,
}: SupplierBadgeProps) {
  if (!badge.tier) return null;

  const config = tierConfig[badge.tier];
  const iconSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const trophySize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";
  const textSize = size === "sm" ? "text-[9px]" : "text-[10px]";
  const isCustomer = badge.ownerType === "customer";
  const description = isCustomer ? config.customerDesc : config.supplierDesc;
  const isFirstPlace = badge.place === 1;
  const isDiamond = badge.tier === "diamond";

  // Trophy colors are ALWAYS based on place: gold(1), silver(2), bronze(3) — regardless of badge tier
  const trophyColor = badge.place ? placeColors[badge.place] : "text-yellow-500";

  const glowClass = isFirstPlace && badge.tier !== "verified" ? glowClasses[badge.tier] || "" : "";

  const content = (
    <div className={cn("inline-flex items-center gap-0.5", className)}>
      {/* Check badge */}
      <div className={cn("rounded-full p-0.5", config.checkBg, glowClass)}>
        <BadgeCheck className={cn(iconSize, config.checkColor)} />
      </div>
      {/* Trophy + place for top-3 tiers */}
      {badge.place && badge.tier !== "verified" && (
        <div className={cn("inline-flex items-center gap-px rounded-full px-1 py-0.5", config.checkBg)}>
          <Trophy className={cn(trophySize, trophyColor, isFirstPlace && "animate-heartbeat")} />
          <span className={cn(textSize, "font-bold", trophyColor)}>
            {badge.place}
          </span>
        </div>
      )}
    </div>
  );

  if (!showTooltip) return content;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <BadgeCheck className={cn("h-4 w-4", config.checkColor)} />
            {config.label}
            {isDiamond && <span className="text-[10px]">⬩ Легенда платформи</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {badge.place
              ? `${badge.place}-е місце у рейтингу за ${periodLabels[badge.period || ""]}`
              : description}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// Re-export as RatingBadge for universal usage
export const RatingBadge = SupplierBadge;
