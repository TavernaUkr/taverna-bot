import { cn } from "@/lib/utils";
import { ElementType } from "react";

interface CategoryCardProps {
  name: string;
  icon: ElementType;
  count?: number;
  gradient?: string;
  onClick?: () => void;
}

export const CategoryCard = ({
  name,
  icon: Icon,
  count,
  gradient = "from-primary to-primary/80",
  onClick,
}: CategoryCardProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative overflow-hidden rounded-xl p-3.5 text-left",
        "bg-gradient-to-br",
        gradient,
        "text-primary-foreground",
        "min-h-[90px] w-full",
        "active:scale-[0.97] transition-transform duration-150"
      )}
    >
      {/* Subtle circle decoration */}
      <div className="absolute -right-4 -bottom-4 w-20 h-20 rounded-full bg-white/10" />

      {/* Content */}
      <div className="relative z-10">
        <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center mb-2">
          <Icon className="h-4.5 w-4.5" />
        </div>
        <h3 className="font-semibold text-sm">{name}</h3>
        {count !== undefined && (
          <p className="text-[11px] opacity-75 mt-0.5">{count} товарів</p>
        )}
      </div>
    </button>
  );
};
