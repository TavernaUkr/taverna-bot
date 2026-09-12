import { useEffect, useState } from "react";
import { ShoppingCart, Plus, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CartBadgeCloudProps {
  cartCount?: number;
  onAdd?: () => void;
  onCheckout?: () => void;
  className?: string;
}

/**
 * Floating cart cloud under the header cart icon.
 * Mirrors WalletBadgeCloud glassmorphism and animation.
 */
export function CartBadgeCloud({
  cartCount = 0,
  onAdd,
  onCheckout,
  className,
}: CartBadgeCloudProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 600);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  const isEmpty = cartCount === 0;
  const label = isEmpty ? "Додати" : "Оформити";
  const Icon = isEmpty ? Plus : ArrowRight;
  const tone = isEmpty ? "primary" : "success";

  const toneClass = {
    primary: "bg-primary text-primary-foreground",
    success: "border border-success/40 bg-card text-success",
  }[tone];

  return (
    <div
      className={cn(
        "absolute top-full right-0 mt-1.5 z-30 flex flex-col items-end animate-cloud-float",
        className,
      )}
    >
      <button
        type="button"
        onClick={isEmpty ? onAdd : onCheckout}
        aria-label={label}
        className="relative"
      >
        {/* Tail pointing up to the cart icon */}
        <span className="absolute -top-1 right-3 w-3 h-3 rotate-45 rounded-[3px] bg-card/90 border-l border-t border-primary/40" />

        <span
          className={cn(
            "relative flex items-center gap-1 rounded-full border border-primary/40 bg-card/90 backdrop-blur px-2.5 py-1 shadow-[0_4px_14px_-6px_hsl(var(--primary)/0.6)] active:scale-95 transition-transform",
            toneClass,
          )}
        >
          <ShoppingCart className="h-2.5 w-2.5" />
          <span className="text-[10px] font-bold whitespace-nowrap">{label}</span>
          <Icon className="h-2.5 w-2.5" />
        </span>
      </button>
    </div>
  );
}
