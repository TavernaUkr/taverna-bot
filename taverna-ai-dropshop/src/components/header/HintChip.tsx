import { useEffect, useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

const chipTone: Record<string, string> = {
  primary: "bg-primary text-primary-foreground border-primary/40",
  like: "bg-live/90 text-live-foreground border-live/40",
  rating: "bg-rating text-rating-foreground border-rating/40",
  promo: "bg-header-promo text-header-promo-foreground border-header-promo/40",
  referral: "bg-header-referral text-header-referral-foreground border-header-referral/40",
  ads: "bg-header-promotion text-header-promotion-foreground border-header-promotion/40",
  lime: "bg-[hsl(75_82%_46%)] text-white border-[hsl(75_82%_46%)]",
  bonus: "bg-[hsl(48_96%_72%)] text-[hsl(32_55%_22%)] border-[hsl(42_80%_58%)]",
  chat: "bg-header-referral text-header-referral-foreground border-header-referral/40",
  danger: "bg-destructive text-destructive-foreground border-destructive/40",
  lang: "bg-blue-500 text-white border-blue-500/40",
  region: "bg-rose-500 text-white border-rose-500/40",
  muted: "bg-card text-foreground border-primary/40",
};

const tailTone: Record<string, string> = {
  primary: "bg-primary border-primary/40",
  like: "bg-live border-live/40",
  rating: "bg-rating border-rating/40",
  promo: "bg-header-promo border-header-promo/40",
  referral: "bg-header-referral border-header-referral/40",
  ads: "bg-header-promotion border-header-promotion/40",
  lime: "bg-[hsl(75_82%_46%)] border-[hsl(75_82%_46%)]",
  bonus: "bg-[hsl(48_96%_72%)] border-[hsl(42_80%_58%)]",
  chat: "bg-header-referral border-header-referral/40",
  danger: "bg-destructive border-destructive/40",
  lang: "bg-blue-500 border-blue-500/40",
  region: "bg-rose-500 border-rose-500/40",
  muted: "bg-card border-primary/40",
};

/** Хвостик хмаринки вгору (до гаманця). */
export function CloudArrow({
  className,
  align = "center",
  size = "md",
}: {
  className?: string;
  align?: "center" | "start" | "end";
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute rotate-45 rounded-[1px] border-l border-t pointer-events-none",
        size === "sm" ? "-top-[4px] w-2 h-2" : "-top-[5px] w-2.5 h-2.5",
        align === "end" ? "right-[11px]" : align === "start" ? "left-[8px]" : "left-1/2 -translate-x-1/2",
        className,
      )}
    />
  );
}

export function HintChip({
  icon: Icon,
  label,
  onClick,
  tone = "muted",
  iconOnly = false,
  arrowAlign = "center",
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  tone?: keyof typeof chipTone;
  iconOnly?: boolean;
  arrowAlign?: "center" | "start" | "end";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn("relative inline-flex items-start justify-center min-h-8 min-w-8 shrink-0", className)}
    >
      <CloudArrow align={arrowAlign} className={tailTone[tone]} />
      <span
        className={cn(
          "relative flex items-center justify-center gap-0.5 rounded-full border",
          "min-h-8 shadow-[0_4px_14px_-6px_hsl(var(--primary)/0.55)] active:scale-95 transition-transform",
          "text-[9px] font-bold whitespace-nowrap",
          iconOnly ? "w-8 h-8 px-0" : "px-2 h-8",
          chipTone[tone],
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {!iconOnly && label}
      </span>
    </button>
  );
}

export interface RotatingHintItem {
  id: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  tone?: keyof typeof chipTone;
  onClick: () => void;
}

/** Одна кнопочка, що змінюється, як бонуси/кошти в гаманці. */
export function RotatingHintCloud({
  items,
  arrowAlign = "end",
}: {
  items: RotatingHintItem[];
  arrowAlign?: "center" | "start" | "end";
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % items.length);
    }, 3500);
    return () => clearInterval(timer);
  }, [items.length]);

  const item = items[index] ?? items[0];
  if (!item) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={item.id}
        className="shrink-0 w-8 h-8"
        initial={{ opacity: 0, y: -12, scale: 0.86 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.9 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        <HintChip
          icon={item.icon}
          label={item.label}
          onClick={item.onClick}
          tone={item.tone}
          iconOnly
          arrowAlign={arrowAlign}
        />
      </motion.div>
    </AnimatePresence>
  );
}
