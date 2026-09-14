import { DollarSign, Star, LogIn, Eye, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CloudArrow } from "@/components/header/HintChip";

export type WalletCloudVariant = "guest" | "bonus" | "cash" | "readonly";

export interface WalletCloudAction {
  id: string;
  label: string;
  icon: LucideIcon;
  tone?: "primary" | "success" | "outline" | "lime" | "chat" | "danger";
  onClick: () => void;
}

type ChipSize = "sm" | "md";

interface WalletBadgeCloudProps {
  variant?: WalletCloudVariant;
  bonusValue?: number;
  cashValue?: number;
  onClick?: () => void;
  className?: string;
  size?: ChipSize;
  arrow?: boolean;
}

const fmt = (v: number) =>
  v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v));

export const WalletCloudIcons = { LogIn };

const toneClass: Record<NonNullable<WalletCloudAction["tone"]>, string> = {
  primary: "bg-primary text-primary-foreground",
  success: "border border-success/40 bg-card text-success",
  outline: "border border-primary/40 bg-card text-primary",
  lime: "bg-[hsl(75_82%_46%)] text-white",
  chat: "bg-header-referral text-header-referral-foreground",
  danger: "bg-destructive text-destructive-foreground",
};

const arrowTone: Record<NonNullable<WalletCloudAction["tone"]>, string> = {
  primary: "bg-primary border-primary/40",
  success: "bg-card border-success/40",
  outline: "bg-card border-primary/40",
  lime: "bg-[hsl(75_82%_46%)] border-[hsl(75_82%_46%)]",
  chat: "bg-header-referral border-header-referral/40",
  danger: "bg-destructive border-destructive/40",
};

export function ActionChip({
  action,
  arrow = false,
  size = "md",
}: {
  action: WalletCloudAction;
  arrow?: boolean;
  size?: ChipSize;
}) {
  const sm = size === "sm";
  return (
    <button
      type="button"
      onClick={action.onClick}
      aria-label={action.label}
      title={action.label}
      className={cn(
        "relative flex items-center justify-center rounded-full shrink-0",
        "shadow-sm active:scale-95 transition-transform",
        sm ? "w-6 h-6" : "w-[34px] h-[34px]",
        toneClass[action.tone ?? "outline"],
      )}
    >
      {arrow && (
        <CloudArrow
          size={size}
          className={arrowTone[action.tone ?? "outline"]}
        />
      )}
      <action.icon className={cn("shrink-0", sm ? "h-3 w-3" : "h-4 w-4")} />
    </button>
  );
}

/** Баланс: кошти та бонуси. */
export function WalletBadgeCloud({
  variant = "bonus",
  bonusValue = 0,
  cashValue = 0,
  onClick,
  className,
  size = "md",
  arrow = false,
}: WalletBadgeCloudProps) {
  const showCash = variant === "cash" || variant === "readonly";
  const showBonus = variant !== "guest";
  const swap = variant === "cash";
  const sm = size === "sm";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={variant === "guest" ? "Увійти" : "Мій рахунок"}
      className={cn(
        "relative inline-flex items-center justify-center shrink-0",
        sm ? "h-6" : "h-8",
        className,
      )}
    >
      {arrow && (
        <CloudArrow
          size={size}
          align={sm ? "start" : "center"}
          className="bg-card border-primary/40"
        />
      )}
      <span
        className={cn(
          "relative flex items-center justify-center gap-0.5 rounded-full border border-primary/40 bg-card shadow-[0_4px_14px_-6px_hsl(var(--primary)/0.6)]",
          sm ? "px-1 h-6 min-w-6" : "px-1.5 h-8 min-w-8",
        )}
      >
        <span className="absolute inset-0 rounded-full animate-glow-pulse pointer-events-none" />
        {variant === "guest" && (
          <LogIn className={cn(sm ? "h-3 w-3" : "h-3.5 w-3.5", "text-primary")} />
        )}
        {showCash && (
          <span className={cn("flex items-center gap-0.5", swap && "animate-badge-swap")}>
            <span className={cn("rounded-full bg-success/15 flex items-center justify-center", sm ? "w-3 h-3" : "w-3.5 h-3.5")}>
              <DollarSign className={cn(sm ? "h-2 w-2" : "h-2.5 w-2.5", "text-success")} />
            </span>
            <span className={cn("font-bold text-success tabular-nums", sm ? "text-[9px]" : "text-[10px]")}>{fmt(cashValue)}</span>
          </span>
        )}
        {showBonus && (
          <span className={cn("flex items-center gap-0.5", swap && "animate-badge-swap-alt")}>
            <span className={cn("rounded-full bg-rating/15 flex items-center justify-center", sm ? "w-3 h-3" : "w-3.5 h-3.5")}>
              <Star className={cn(sm ? "h-2 w-2" : "h-2.5 w-2.5", "text-rating fill-rating")} />
            </span>
            <span className={cn("font-bold text-rating tabular-nums", sm ? "text-[9px]" : "text-[10px]")}>{fmt(bonusValue)}</span>
          </span>
        )}
        {variant === "readonly" && (
          <Eye className={cn(sm ? "h-2.5 w-2.5" : "h-3 w-3", "text-muted-foreground")} />
        )}
      </span>
    </button>
  );
}

export function WalletCloudActions({
  actions,
  arrow = false,
  size = "md",
  className,
}: {
  actions: WalletCloudAction[];
  arrow?: boolean;
  size?: ChipSize;
  className?: string;
}) {
  if (actions.length === 0) return null;
  return (
    <div className={cn("flex items-center justify-start gap-0.5 flex-nowrap", className)}>
      {actions.map((a) => (
        <ActionChip key={a.id} action={a} arrow={arrow} size={size} />
      ))}
    </div>
  );
}
