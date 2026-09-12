import { TrendingUp, AlertTriangle, Trophy, BadgeCheck, Shield, Gift } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { getRankBadge, RankCheckmark, RankCup, type RatingPeriod } from "./RatingBadges";

const CHECKMARKS: { period: RatingPeriod; rank: number; rule: string }[] = [
  { period: "alltime", rank: 1, rule: "№1 за весь час — «Легенда платформи»" },
  { period: "year", rank: 1, rule: "Топ 1-3 за рік" },
  { period: "month", rank: 1, rule: "Топ 1-3 за місяць" },
  { period: "week", rank: 1, rule: "Топ 1-3 за тиждень" },
  { period: "day", rank: 1, rule: "Топ 1-3 за день" },
  { period: "month", rank: 5, rule: "Місця 4-10 у будь-якому періоді" },
];

const UP = [
  "Кожне замовлення / продаж",
  "Сума покупок або виручки",
  "Позитивні відгуки (⭐ 4-5)",
  "Унікальні клієнти (для продавців)",
  "Швидка доставка та відповіді",
];

const DOWN = [
  "Підтверджені скарги",
  "Повернення з вини учасника",
  "Негативні відгуки (⭐ 1-2)",
  "Скасовані замовлення",
  "Санкції модератора",
];

const PENALTIES = [
  { title: "Магазини", items: ["3+ скарги/міс — втрата галочки", "5+ скарг — сильне зниження балів", "10+ скарг — призупинення магазину"] },
  { title: "Клієнти", items: ["3+ необґрунтованих повернення — мінус галочка", "Фейкові скарги — попередження, потім бан", "Зловживання бонусами — ліміт мінус 50%"] },
];

interface RatingRulesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Повні правила рейтингу: галочки, кубки, зростання, штрафи. */
export function RatingRulesSheet({ open, onOpenChange }: RatingRulesSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Правила рейтингу</SheetTitle>
          <SheetDescription>Галочки, кубки та штрафи — як усе працює</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4 pb-6">
          {/* Галочки */}
          <section>
            <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <BadgeCheck className="h-3.5 w-3.5 text-primary" /> Галочки
            </p>
            <div className="space-y-1.5">
              {CHECKMARKS.map((c) => {
                const badge = getRankBadge(c.rank, c.period);
                return (
                  <div key={badge.label + c.rule} className={cn("flex items-center gap-2.5 rounded-xl p-2.5", badge.bg)}>
                    <RankCheckmark rank={c.rank} period={c.period} size="sm" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground">{badge.emoji} {badge.label}</p>
                      <p className="text-[11px] text-muted-foreground">{c.rule}</p>
                    </div>
                  </div>
                );
              })}
              <p className="text-[11px] text-muted-foreground pt-1">Поза Топ-10 — без галочки та без кубка.</p>
            </div>
          </section>

          {/* Кубки */}
          <section>
            <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-yellow-500" /> Кубки
            </p>
            <div className="space-y-1.5">
              {[1, 2, 3].map((r) => (
                <div key={r} className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5">
                  <RankCup rank={r} size="sm" />
                  <p className="text-xs text-foreground font-medium">{r} місце</p>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {r === 1 ? "Пульсує — лідер періоду" : "Поруч із галочкою"}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Зростання / зниження */}
          <section className="grid grid-cols-1 gap-2">
            <div className="rounded-xl border border-success/20 bg-success/5 p-3">
              <p className="text-xs font-semibold text-success flex items-center gap-1.5 mb-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> Підвищує рейтинг
              </p>
              <ul className="text-[11px] text-muted-foreground space-y-0.5">
                {UP.map((i) => <li key={i}>• {i}</li>)}
              </ul>
            </div>
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3">
              <p className="text-xs font-semibold text-destructive flex items-center gap-1.5 mb-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Знижує рейтинг
              </p>
              <ul className="text-[11px] text-muted-foreground space-y-0.5">
                {DOWN.map((i) => <li key={i}>• {i}</li>)}
              </ul>
            </div>
          </section>

          {/* Штрафи */}
          <section>
            <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-primary" /> Штрафи
            </p>
            <div className="space-y-2">
              {PENALTIES.map((p) => (
                <div key={p.title} className="rounded-xl border border-warning/20 bg-warning/5 p-3">
                  <p className="text-xs font-semibold text-foreground mb-1">{p.title}</p>
                  <ul className="text-[11px] text-muted-foreground space-y-0.5">
                    {p.items.map((i) => <li key={i}>• {i}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Бонуси */}
          <section className="rounded-xl border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-1">
              <Gift className="h-3.5 w-3.5 text-primary" /> Нагороди
            </p>
            <p className="text-[11px] text-muted-foreground">
              Топ-3 кожного періоду отримують бонуси, знижки та привілеї. Бонусами можна оплатити до 7% суми кошика.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
