import { TrendingUp, Wallet, ArrowUpRight, Landmark, BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const WEEK = [
  { day: "Пн", value: 42 },
  { day: "Вт", value: 58 },
  { day: "Ср", value: 51 },
  { day: "Чт", value: 74 },
  { day: "Пт", value: 88 },
  { day: "Сб", value: 96 },
  { day: "Нд", value: 112 },
];

const METRICS = [
  {
    label: "Оборот платформи (GMV)",
    value: "1 284 500 ₴",
    delta: "+18% за тиждень",
    icon: Landmark,
    tone: "primary" as const,
  },
  {
    label: "Чистий дохід (Націнка)",
    value: "312 940 ₴",
    delta: "+11% за тиждень",
    icon: TrendingUp,
    tone: "success" as const,
  },
  {
    label: "Заборгованість перед магазинами",
    value: "184 210 ₴",
    delta: "7 магазинів очікують виплат",
    icon: Wallet,
    tone: "warning" as const,
  },
];

function buildCurve(values: number[], w: number, h: number) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  return values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
}

export function PlatformTreasury() {
  const points = buildCurve(WEEK.map((d) => d.value), 300, 90);
  const line = `M ${points.join(" L ")}`;
  const area = `${line} L 300,90 L 0,90 Z`;
  const peak = Math.max(...WEEK.map((d) => d.value));

  return (
    <Card className="overflow-hidden border-border/60 bg-card/70 backdrop-blur-xl shadow-lg">
      <div className="bg-gradient-to-br from-primary/10 via-transparent to-accent/10 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Казна платформи</p>
          <span className="ml-auto text-[10px] text-muted-foreground">демо-дані</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {METRICS.map((m) => (
            <div
              key={m.label}
              className={cn(
                "rounded-xl border p-3 backdrop-blur-md",
                m.tone === "primary" && "border-primary/25 bg-primary/5",
                m.tone === "success" && "border-success/25 bg-success/5",
                m.tone === "warning" && "border-warning/30 bg-warning/5",
              )}
            >
              <m.icon
                className={cn(
                  "h-4 w-4 mb-1.5",
                  m.tone === "primary" && "text-primary",
                  m.tone === "success" && "text-success",
                  m.tone === "warning" && "text-warning",
                )}
              />
              <p className="text-lg font-bold text-foreground leading-tight">{m.value}</p>
              <p className="text-[11px] text-muted-foreground leading-snug">{m.label}</p>
              <p className="mt-1 text-[10px] font-medium text-muted-foreground flex items-center gap-0.5">
                <ArrowUpRight className="h-3 w-3" />
                {m.delta}
              </p>
            </div>
          ))}
        </div>

        <CardContent className="p-0">
          <div className="rounded-xl border border-border/60 bg-card/80 p-3">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-xs font-medium text-foreground">Дохід за 7 днів</p>
              <p className="text-xs font-semibold text-success">+18%</p>
            </div>

            <svg viewBox="0 0 300 90" className="w-full h-24" preserveAspectRatio="none">
              <defs>
                <linearGradient id="treasury-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={area} fill="url(#treasury-fill)" />
              <path
                d={line}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            <div className="mt-2 flex items-end gap-1.5 h-10">
              {WEEK.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-sm bg-accent/70"
                    style={{ height: `${(d.value / peak) * 100}%` }}
                  />
                  <span className="text-[9px] text-muted-foreground">{d.day}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}
