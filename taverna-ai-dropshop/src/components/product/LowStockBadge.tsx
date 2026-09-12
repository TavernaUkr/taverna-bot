import { Flame, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface LowStockBadgeProps {
  quantity: number;
  threshold?: number;
  className?: string;
  animated?: boolean;
}

export const LowStockBadge = ({ 
  quantity, 
  threshold = 5, 
  className,
  animated = true 
}: LowStockBadgeProps) => {
  if (quantity > threshold || quantity <= 0) return null;

  // Critical stock (< 3) gets extra urgency styling
  const isCritical = quantity < 3;

  return (
    <div 
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold shadow-md",
        isCritical 
          ? "bg-destructive text-destructive-foreground animate-[pulse_0.8s_ease-in-out_infinite]"
          : "bg-live/90 text-live-foreground",
        animated && !isCritical && "animate-pulse",
        className
      )}
    >
      {isCritical ? (
        <AlertTriangle className="h-3 w-3" />
      ) : (
        <Flame className="h-3 w-3" />
      )}
      <span>
        {quantity === 1 
          ? "Останній!" 
          : isCritical
            ? `Лише ${quantity} шт!`
            : `Залишилось ${quantity} шт!`
        }
      </span>
    </div>
  );
};
