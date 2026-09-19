import { Store, Users, Radio, HelpCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  isCenter?: boolean;
  isLive?: boolean;
}

interface BottomNavigationProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

const navItems: NavItem[] = [
  { id: "catalog", label: "Каталог", icon: <Store className="h-5 w-5" /> },
  { id: "suppliers", label: "Продавці", icon: <Users className="h-5 w-5" /> },
  { id: "live", label: "Live", icon: <Radio className="h-5 w-5" />, isCenter: true, isLive: true },
  { id: "support", label: "Підтримка", icon: <HelpCircle className="h-5 w-5" /> },
  { id: "account", label: "Профіль", icon: <User className="h-5 w-5" /> },
];

export const BottomNavigation = ({ activeTab, onTabChange }: BottomNavigationProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 w-full max-w-md mx-auto z-50 bg-card/80 backdrop-blur-sm border-t border-border">
      <div className="flex items-center justify-around h-16 pb-safe w-full min-w-0 px-1">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;

          if (item.isCenter) {
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className="relative flex flex-col items-center gap-0.5 min-w-0 flex-1 px-0.5"
              >
                <div
                  className={cn(
                    "w-10 h-10 -mt-5 rounded-full flex items-center justify-center transition-all duration-200",
                    isActive
                      ? "bg-live text-live-foreground shadow-md"
                      : "bg-live/85 text-live-foreground"
                  )}
                >
                  {item.icon}
                  {item.isLive && (
                    <span className="absolute top-0 right-0 w-2 h-2 bg-white rounded-full animate-pulse-live" />
                  )}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-brand italic mt-0.5 tracking-[0.08em] text-live-royal truncate max-w-full",
                    isActive ? "opacity-100" : "opacity-80"
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={cn(
                "flex flex-col items-center gap-0.5 py-1.5 px-0.5 min-w-0 flex-1 transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              {item.icon}
              <span className="text-[10px] font-medium truncate max-w-full">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
