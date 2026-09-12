import { Plus, ArrowUpRight, ShoppingBag, LogIn, Gift, Eye } from "lucide-react";
import { hapticSelection } from "@/lib/haptics";

interface WalletActionBarProps {
  /** Рольовий режим: гість / клієнт (бонуси) / партнер (кошти) / менеджер (перегляд) */
  variant?: "guest" | "bonus" | "cash" | "readonly";
  onLogin?: () => void;
  onTopUp?: () => void;
  onPayout?: () => void;
  onPay?: () => void;
  onBonuses?: () => void;
  onShops?: () => void;
}

const base =
  "flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold active:scale-95 transition-transform";

/** Липка нижня панель дій рахунку — набір кнопок залежить від ролі. */
export function WalletActionBar({
  variant = "bonus",
  onLogin,
  onTopUp,
  onPayout,
  onPay,
  onBonuses,
  onShops,
}: WalletActionBarProps) {
  const tap = (fn?: () => void) => () => { hapticSelection(); fn?.(); };

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur px-3 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-2 max-w-lg mx-auto">
        {variant === "guest" ? (
          <button onClick={tap(onLogin)} className={`${base} bg-primary text-primary-foreground`}>
            <LogIn className="h-4 w-4" /> Увійти
          </button>
        ) : (
          <>
            {variant === "cash" && (
              <>
                <button onClick={tap(onTopUp)} className={`${base} bg-primary text-primary-foreground`}>
                  <Plus className="h-4 w-4" /> Поповнити
                </button>
                <button onClick={tap(onPayout)} className={`${base} border border-success/40 bg-card text-success`}>
                  <ArrowUpRight className="h-4 w-4" /> Вивести
                </button>
              </>
            )}
            {variant === "readonly" && (
              <button onClick={tap(onShops)} className={`${base} border border-border bg-card text-muted-foreground`}>
                <Eye className="h-4 w-4" /> Надходження
              </button>
            )}
            {variant === "bonus" && (
              <button onClick={tap(onBonuses)} className={`${base} bg-primary text-primary-foreground`}>
                <Gift className="h-4 w-4" /> Бонуси
              </button>
            )}
            <button onClick={tap(onPay)} className={`${base} border border-primary/40 bg-card text-primary`}>
              <ShoppingBag className="h-4 w-4" /> Оплатити
            </button>
          </>
        )}
      </div>
    </div>
  );
}
