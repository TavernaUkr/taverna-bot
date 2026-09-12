import { BadgeCheck, Shield, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface VerifiedBadgeProps {
  type?: "verified" | "trusted" | "premium";
  size?: "sm" | "md" | "lg";
  showTooltip?: boolean;
  className?: string;
}

const badgeConfig = {
  verified: {
    icon: BadgeCheck,
    label: "Верифікований партнер",
    description: "Перевірений магазин з рейтингом > 4.5",
    colors: "text-blue-500",
    bgColors: "bg-blue-500/10",
  },
  trusted: {
    icon: Shield,
    label: "Надійний продавець",
    description: "Більше 100 успішних продажів",
    colors: "text-green-500",
    bgColors: "bg-green-500/10",
  },
  premium: {
    icon: Star,
    label: "Преміум партнер",
    description: "Топ-продавець платформи",
    colors: "text-amber-500",
    bgColors: "bg-amber-500/10",
  },
};

const sizeConfig = {
  sm: { icon: "h-3.5 w-3.5", container: "gap-0.5" },
  md: { icon: "h-4 w-4", container: "gap-1" },
  lg: { icon: "h-5 w-5", container: "gap-1.5" },
};

export function VerifiedBadge({
  type = "verified",
  size = "md",
  showTooltip = true,
  className,
}: VerifiedBadgeProps) {
  const config = badgeConfig[type];
  const sizes = sizeConfig[size];
  const Icon = config.icon;

  const badge = (
    <div
      className={cn(
        "inline-flex items-center",
        sizes.container,
        className
      )}
    >
      <div className={cn("rounded-full p-0.5", config.bgColors)}>
        <Icon className={cn(sizes.icon, config.colors)} />
      </div>
      {size === "lg" && (
        <span className={cn("text-xs font-medium", config.colors)}>
          {config.label}
        </span>
      )}
    </div>
  );

  if (!showTooltip) {
    return badge;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1">
          <p className="font-semibold flex items-center gap-1">
            <Icon className={cn("h-4 w-4", config.colors)} />
            {config.label}
          </p>
          <p className="text-xs text-muted-foreground">{config.description}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
