import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CloudArrow } from "@/components/header/HintChip";

interface CartBadgeCloudProps {
  cartCount?: number;
  onAdd?: () => void;
  onCheckout?: () => void;
  className?: string;
}

/** Хмаринка кошика — «+» якщо порожній, галочка якщо товар уже в кошику. */
export function CartBadgeCloud({
  cartCount = 0,
  onAdd,
  onCheckout,
  className,
}: CartBadgeCloudProps) {
  const isEmpty = cartCount === 0;
  const label = isEmpty ? "Додати" : "У кошику";
  const tone = isEmpty ? "primary" : "success";
  const toneClass = {
    primary: "bg-primary text-primary-foreground border-primary/40",
    success: "border-success/40 bg-card text-success",
  }[tone];
  const tailClass = {
    primary: "bg-primary border-primary/40",
    success: "bg-card border-success/40",
  }[tone];

  return (
    <button
      type="button"
      onClick={isEmpty ? onAdd : onCheckout}
      aria-label={label}
      className={cn("relative inline-flex items-start justify-center min-h-8 w-8 shrink-0", className)}
    >
      <CloudArrow className={tailClass} />
      <span
        className={cn(
          "relative flex items-center justify-center rounded-full border w-8 h-8",
          "shadow-[0_4px_14px_-6px_hsl(var(--primary)/0.6)] active:scale-95 transition-transform",
          toneClass,
        )}
      >
        {isEmpty ? <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
      </span>
    </button>
  );
}
