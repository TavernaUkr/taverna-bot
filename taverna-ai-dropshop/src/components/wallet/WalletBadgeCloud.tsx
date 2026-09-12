import { useEffect, useState } from "react";
import { DollarSign, Star, Plus, ArrowUpRight, ShoppingBag, LogIn, Eye, Gift, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type WalletCloudVariant = "guest" | "bonus" | "cash" | "readonly";

export interface WalletCloudAction {
  id: string;
  label: string;
  icon: LucideIcon;
  tone?: "primary" | "success" | "outline";
  onClick: () => void;
}

interface WalletBadgeCloudProps {
  /** Рольовий режим хмаринки */
  variant?: WalletCloudVariant;
  bonusValue?: number;
  cashValue?: number;
  onClick?: () => void;
  className?: string;
  /** Швидкі дії (набір визначає роль) */
  actions?: WalletCloudAction[];
}

const fmt = (v: number) =>
  v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v));

const ICONS = { LogIn, Plus, ArrowUpRight, ShoppingBag, Eye, Gift };
export const WalletCloudIcons = ICONS;

const toneClass: Record<NonNullable<WalletCloudAction["tone"]>, string> = {
  primary: "bg-primary text-primary-foreground",
  success: "border border-success/40 bg-card text-success",
  outline: "border border-primary/40 bg-card text-primary",
};

/**
 * Анімована "хмаринка" зі стрілкою до кнопки гаманця.
 * Вміст і швидкі дії залежать від ролі користувача.
 */
export function WalletBadgeCloud({
  variant = "bonus",
  bonusValue = 0,
  cashValue = 0,
  onClick,
  className,
  actions = [],
}: WalletBadgeCloudProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 600);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  const showCash = variant === "cash" || variant === "readonly";
  const showBonus = variant !== "guest";
  const swap = variant === "cash";

  return (
    <div
      className={cn(
        "absolute top-full right-0 mt-1.5 z-30 flex flex-col items-end gap-1 animate-cloud-float",
        className,
      )}
    >
      <button type="button" onClick={onClick} aria-label="Мій рахунок" className="relative">
        {/* хвостик хмаринки */}
        <span className="absolute -top-1 right-4 w-3 h-3 rotate-45 rounded-[3px] bg-card border-l border-t border-primary/40" />

        <span className="relative flex items-center gap-1.5 rounded-full border border-primary/40 bg-card px-2.5 py-1 shadow-[0_4px_14px_-6px_hsl(var(--primary)/0.6)]">
          <span className="absolute inset-0 rounded-full animate-glow-pulse pointer-events-none" />

          {variant === "guest" && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-primary">
              <LogIn className="h-2.5 w-2.5" /> Увійти
            </span>
          )}

          {showCash && (
            <span className={cn("flex items-center gap-0.5", swap && "animate-badge-swap")}>
              <span className="w-4 h-4 rounded-full bg-success/15 flex items-center justify-center">
                <DollarSign className="h-2.5 w-2.5 text-success" />
              </span>
              <span className="text-[10px] font-bold text-success">{fmt(cashValue)}</span>
            </span>
          )}

          {showBonus && (
            <span className={cn("flex items-center gap-0.5", swap && "animate-badge-swap-alt")}>
              <span className="w-4 h-4 rounded-full bg-rating/15 flex items-center justify-center">
                <Star className="h-2.5 w-2.5 text-rating fill-rating" />
              </span>
              <span className="text-[10px] font-bold text-rating">{fmt(bonusValue)}</span>
            </span>
          )}

          {variant === "readonly" && (
            <span className="flex items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Eye className="h-2.5 w-2.5" /> перегляд
            </span>
          )}
        </span>
      </button>

      {actions.length > 0 && (
        <div className="flex items-center gap-1">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={a.onClick}
              aria-label={a.label}
              className={cn(
                "flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-semibold shadow-sm active:scale-95 transition-transform",
                toneClass[a.tone ?? "outline"],
              )}
            >
              <a.icon className="h-2.5 w-2.5" /> {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
