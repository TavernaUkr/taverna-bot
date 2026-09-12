import { Handshake, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PartnerBannerProps {
  onClick?: () => void;
  className?: string;
}

export const PartnerBanner = ({ onClick, className }: PartnerBannerProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3",
        "bg-gradient-to-r from-primary via-primary/90 to-accent",
        "text-primary-foreground rounded-xl",
        "shadow-md hover:shadow-lg",
        "hover:scale-[1.01] active:scale-[0.99]",
        "transition-all duration-200",
        className
      )}
    >
      <div className="w-10 h-10 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
        <Handshake className="h-5 w-5" />
      </div>
      
      <div className="flex-1 text-left">
        <p className="font-semibold text-sm">Стати партнером</p>
        <p className="text-xs opacity-80">Приєднуйтесь до Taverna Group</p>
      </div>
      
      <ChevronRight className="h-5 w-5 opacity-70" />
    </button>
  );
};
