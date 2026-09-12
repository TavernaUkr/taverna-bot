import { Clock, Users, Zap, Gift } from "lucide-react";
import { cn } from "@/lib/utils";

interface PromoCardProps {
  title: string;
  description: string;
  type: "discount" | "referral" | "flash" | "bonus";
  validUntil?: Date;
  onClick?: () => void;
}

const promoConfig = {
  discount: {
    icon: Gift,
    gradient: "from-live to-orange-500",
  },
  referral: {
    icon: Users,
    gradient: "from-primary to-accent",
  },
  flash: {
    icon: Zap,
    gradient: "from-warning to-yellow-400",
  },
  bonus: {
    icon: Gift,
    gradient: "from-success to-emerald-400",
  },
};

export const PromoCard = ({
  title,
  description,
  type,
  validUntil,
  onClick,
}: PromoCardProps) => {
  const config = promoConfig[type];
  const Icon = config.icon;

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("uk-UA", {
      day: "numeric",
      month: "short",
    });
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full relative overflow-hidden rounded-xl p-4 text-left",
        "bg-gradient-to-br",
        config.gradient,
        "text-white",
        "active:scale-[0.98]",
        "transition-transform duration-150"
      )}
    >
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute -right-8 -bottom-8 w-32 h-32 rounded-full bg-white" />
        <div className="absolute -left-4 -top-4 w-16 h-16 rounded-full bg-white" />
      </div>

      {/* Content */}
      <div className="relative z-10">
        <div className="flex items-start justify-between mb-3">
          <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Icon className="h-6 w-6" />
          </div>
          
          {validUntil && (
            <div className="flex items-center gap-1 text-xs bg-black/20 px-2 py-1 rounded-full">
              <Clock className="h-3 w-3" />
              <span>до {formatDate(validUntil)}</span>
            </div>
          )}
        </div>

        <h3 className="font-bold text-lg mb-1">{title}</h3>
        <p className="text-sm opacity-90">{description}</p>
      </div>
    </button>
  );
};
