import { Trophy, Star, TrendingUp, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBonuses } from "@/hooks/useBonuses";
import { cn } from "@/lib/utils";

const RANKS = [
  { name: "Новачок", min: 0, tone: "text-muted-foreground" },
  { name: "Постійний", min: 500, tone: "text-primary" },
  { name: "Срібний", min: 2000, tone: "text-foreground" },
  { name: "Золотий", min: 5000, tone: "text-rating" },
  { name: "Легенда", min: 12000, tone: "text-live" },
];

function rankOf(points: number) {
  let idx = 0;
  RANKS.forEach((r, i) => { if (points >= r.min) idx = i; });
  const current = RANKS[idx];
  const next = RANKS[idx + 1] || null;
  const from = current.min;
  const to = next?.min ?? current.min + 1;
  const progress = next ? Math.min(100, Math.round(((points - from) / (to - from)) * 100)) : 100;
  return { current, next, progress };
}

/** Рейтингові бали, ранг і множник бонусів — усередині єдиного рахунку. */
export function WalletRatingCard({
  fallbackPoints = 0,
  onGoToRatings,
}: { fallbackPoints?: number; onGoToRatings?: () => void }) {
  const { totalEarned, reputationMultiplier, reputationScore } = useBonuses();

  const points = totalEarned || fallbackPoints;
  const multiplier = reputationMultiplier ?? 1;
  const score = reputationScore;
  const { current, next, progress } = rankOf(points);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-warning/15 flex items-center justify-center">
          <Trophy className="h-5 w-5 text-warning" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-muted-foreground">Мій Рейтинг</p>
          <p className="text-sm font-semibold text-foreground">
            <span className={cn(current.tone)}>{current.name}</span> клієнт
          </p>
          <p className="text-[11px] text-muted-foreground">
            {points.toLocaleString("uk-UA")} балів
            {score != null && <> · оцінка {score.toFixed(1)}<Star className="inline h-3 w-3 ml-0.5 -mt-0.5 text-rating fill-rating" /></>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end">
            <TrendingUp className="h-3 w-3" /> Множник
          </p>
          <p className="text-sm font-bold text-primary">×{multiplier.toFixed(1)}</p>
        </div>
        {onGoToRatings && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Всі рівні рейтингу"
            onClick={onGoToRatings}
            className="shrink-0 -mr-1 text-muted-foreground"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        )}
      </div>

      {onGoToRatings && (
        <button
          onClick={onGoToRatings}
          className="mt-2 text-[11px] font-medium text-primary active:opacity-60"
        >
          Детальніше про рейтинг · всі рівні
        </button>
      )}


      <div className="mt-3">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-rating" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          {next
            ? `До рангу «${next.name}» — ${(next.min - points).toLocaleString("uk-UA")} балів`
            : "Максимальний ранг досягнуто"}
        </p>
      </div>
    </div>
  );
}
