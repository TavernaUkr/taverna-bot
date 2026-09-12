import { BadgeCheck, Trophy, Diamond } from "lucide-react";
import { cn } from "@/lib/utils";

export type RatingPeriod = "day" | "week" | "month" | "year" | "alltime";

export interface RankBadgeInfo {
  /** none = поза топ-10 */
  kind: "diamond" | "gold" | "silver" | "bronze" | "blue" | "verified" | "none";
  label: string;
  emoji: string;
  text: string;
  bg: string;
  ring: string;
}

const BADGES: Record<Exclude<RankBadgeInfo["kind"], "none">, Omit<RankBadgeInfo, "kind">> = {
  diamond: { label: "Легенда платформи", emoji: "💎", text: "text-violet-400", bg: "bg-violet-400/15", ring: "ring-violet-400/40" },
  gold: { label: "Золота галочка", emoji: "🥇", text: "text-yellow-500", bg: "bg-yellow-500/15", ring: "ring-yellow-500/40" },
  silver: { label: "Срібна галочка", emoji: "🥈", text: "text-slate-400", bg: "bg-slate-400/15", ring: "ring-slate-400/40" },
  bronze: { label: "Бронзова галочка", emoji: "🥉", text: "text-amber-600", bg: "bg-amber-600/15", ring: "ring-amber-600/40" },
  blue: { label: "Синя галочка", emoji: "🔷", text: "text-blue-500", bg: "bg-blue-500/15", ring: "ring-blue-500/40" },
  verified: { label: "Перевірений", emoji: "✅", text: "text-emerald-500", bg: "bg-emerald-500/15", ring: "ring-emerald-500/40" },
};

const NONE: RankBadgeInfo = {
  kind: "none",
  label: "Без галочки",
  emoji: "",
  text: "text-muted-foreground",
  bg: "bg-muted",
  ring: "ring-border",
};

/** Галочка визначається періодом (для топ-3) або зелена «Перевірений» для 4-10 місця. */
export const getRankBadge = (rank: number, period: RatingPeriod): RankBadgeInfo => {
  if (rank >= 4 && rank <= 10) return { kind: "verified", ...BADGES.verified };
  if (rank > 10 || rank < 1) return NONE;
  if (period === "alltime") {
    return rank === 1 ? { kind: "diamond", ...BADGES.diamond } : { kind: "verified", ...BADGES.verified };
  }
  const map: Record<Exclude<RatingPeriod, "alltime">, Exclude<RankBadgeInfo["kind"], "none">> = {
    year: "gold",
    month: "silver",
    week: "bronze",
    day: "blue",
  };
  const kind = map[period];
  return { kind, ...BADGES[kind] };
};

const cupTones = ["text-yellow-500 bg-yellow-500/15", "text-slate-400 bg-slate-400/15", "text-amber-600 bg-amber-600/15"];

/** Галочка учасника. */
export const RankCheckmark = ({
  rank,
  period,
  size = "md",
  className,
}: {
  rank: number;
  period: RatingPeriod;
  size?: "sm" | "md";
  className?: string;
}) => {
  const badge = getRankBadge(rank, period);
  const box = size === "sm" ? "w-6 h-6" : "w-9 h-9";
  const icon = size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5";

  if (badge.kind === "none") {
    return (
      <div className={cn(box, "rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-bold", className)}>
        {rank}
      </div>
    );
  }

  const Icon = badge.kind === "diamond" ? Diamond : BadgeCheck;
  return (
    <div
      title={badge.label}
      className={cn(box, "rounded-full flex items-center justify-center ring-1", badge.bg, badge.ring, className)}
    >
      <Icon className={cn(icon, badge.text)} />
    </div>
  );
};

/** Кубок — лише для топ-3; кубок №1 пульсує. */
export const RankCup = ({ rank, size = "md", className }: { rank: number; size?: "sm" | "md"; className?: string }) => {
  if (rank > 3 || rank < 1) return null;
  const box = size === "sm" ? "w-6 h-6" : "w-8 h-8";
  const icon = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <div
      title={`${rank} місце`}
      className={cn(
        box,
        "rounded-full flex items-center justify-center gap-0.5",
        cupTones[rank - 1],
        rank === 1 && "animate-cup-beat",
        className,
      )}
    >
      <Trophy className={icon} />
    </div>
  );
};

/** Галочка + кубок разом. */
export const RankInsignia = ({
  rank,
  period,
  size = "md",
  className,
}: {
  rank: number;
  period: RatingPeriod;
  size?: "sm" | "md";
  className?: string;
}) => (
  <div className={cn("flex items-center gap-1", className)}>
    <RankCheckmark rank={rank} period={period} size={size} />
    <RankCup rank={rank} size={size} />
  </div>
);
