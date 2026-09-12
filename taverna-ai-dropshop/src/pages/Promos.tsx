import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Gift, Percent, Zap, Clock, ChevronRight, Tag, ChevronLeft, Info, Loader2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { hapticImpact, hapticNotification } from "@/lib/haptics";
import { supabase } from "@/integrations/supabase/client";

interface Promo {
  id: string;
  title: string;
  description: string;
  type: "discount" | "flash";
  code: string;
  discountPercent?: number;
  discountAmount?: number;
  validUntil?: Date;
  isActive: boolean;
  minOrderAmount?: number;
}

const PROMO_STORAGE_KEY = "taverna_active_promo";

const promoConfig = {
  discount: {
    icon: Gift,
    gradient: "from-live to-warning",
    bgLight: "bg-live/10",
    textColor: "text-live",
  },
  flash: {
    icon: Zap,
    gradient: "from-warning to-amber-400",
    bgLight: "bg-warning/10",
    textColor: "text-warning",
  },
};

export const Promos = () => {
  const navigate = useNavigate();
  const [promos, setPromos] = useState<Promo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Load promo codes from database
  useEffect(() => {
    const loadPromos = async () => {
      try {
        const { data, error } = await supabase
          .from("promo_codes")
          .select("*")
          .eq("is_active", true)
          .order("created_at", { ascending: false });

        if (error) throw error;

        const mapped: Promo[] = (data || []).map((p) => {
          const isFlash = p.valid_until && new Date(p.valid_until).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000;
          return {
            id: p.id,
            title: p.discount_percent
              ? `Знижка ${p.discount_percent}%`
              : `Знижка ${p.discount_amount}₴`,
            description: p.min_order_amount
              ? `Мін. замовлення від ${p.min_order_amount}₴`
              : "На будь-яке замовлення",
            type: isFlash ? "flash" : "discount",
            code: p.code,
            discountPercent: p.discount_percent ?? undefined,
            discountAmount: p.discount_amount ?? undefined,
            validUntil: p.valid_until ? new Date(p.valid_until) : undefined,
            isActive: true,
            minOrderAmount: p.min_order_amount ?? undefined,
          };
        });

        setPromos(mapped);
      } catch (err) {
        console.error("Error loading promos:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadPromos();
  }, []);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    hapticImpact("light");
    toast.success("Промокод скопійовано!");
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleApplyPromo = (promo: Promo) => {
    const promoData = {
      code: promo.code,
      discountPercent: promo.discountPercent,
      title: promo.title,
    };
    localStorage.setItem(PROMO_STORAGE_KEY, JSON.stringify(promoData));

    hapticNotification("success");
    toast.success(`Промокод ${promo.code} буде застосовано при оформленні!`, {
      description: "Перейдіть до товарів та зробіть замовлення",
    });

    navigate("/search?all=true");
  };

  const handleBack = () => {
    navigate(-1);
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("uk-UA", {
      day: "numeric",
      month: "short",
    });
  };

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-gradient-to-br from-primary via-primary/90 to-accent">
        <div className="flex items-center px-4 pt-3 pb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="text-primary-foreground hover:bg-primary-foreground/10 -ml-2"
          >
            <ChevronLeft className="h-5 w-5 mr-1" />
            Назад
          </Button>
        </div>

        <div className="px-4 pb-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-primary-foreground/20 backdrop-blur-sm flex items-center justify-center">
              <Gift className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-primary-foreground">Акції та Знижки</h1>
              <p className="text-sm text-primary-foreground/80">Спеціальні пропозиції для вас</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-primary-foreground/15 backdrop-blur-sm rounded-xl p-3 text-center">
              <span className="text-2xl font-bold text-primary-foreground">{promos.length}</span>
              <p className="text-xs text-primary-foreground/70">Активних</p>
            </div>
            <div className="bg-primary-foreground/15 backdrop-blur-sm rounded-xl p-3 text-center">
              <span className="text-2xl font-bold text-primary-foreground">
                {promos.length > 0
                  ? Math.max(...promos.map((p) => p.discountPercent || 0)) + "%"
                  : "—"}
              </span>
              <p className="text-xs text-primary-foreground/70">Макс.</p>
            </div>
            <div className="bg-primary-foreground/15 backdrop-blur-sm rounded-xl p-3 text-center">
              <span className="text-2xl font-bold text-primary-foreground">1</span>
              <p className="text-xs text-primary-foreground/70">На замовлення</p>
            </div>
          </div>

          {/* Bonus Account CTA */}
          <button
            onClick={() => navigate("/wallet")}
            className="w-full mt-3 flex items-center gap-3 bg-primary-foreground/15 backdrop-blur-sm rounded-xl p-3 hover:bg-primary-foreground/25 active:scale-[0.98] transition-all"
          >
            <Wallet className="h-5 w-5 text-primary-foreground" />
            <div className="text-left flex-1">
              <p className="text-sm font-semibold text-primary-foreground">Бонусний рахунок</p>
              <p className="text-[10px] text-primary-foreground/70">Реферали, бонуси, рейтингові нагороди</p>
            </div>
            <ChevronRight className="h-4 w-4 text-primary-foreground/60" />
          </button>
        </div>
      </div>

      {/* Promos List */}
      <div className="px-4 pt-4 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : promos.length === 0 ? (
          <div className="text-center py-12">
            <Gift className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">Наразі немає активних акцій</p>
          </div>
        ) : (
          promos.map((promo) => {
            const config = promoConfig[promo.type];
            const Icon = config.icon;

            return (
              <div
                key={promo.id}
                className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm"
              >
                <div className={cn("p-4", `bg-gradient-to-br ${config.gradient}`)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary-foreground/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                      <Icon className="h-5 w-5 text-primary-foreground" />
                    </div>

                    {promo.validUntil && (
                      <div className="flex items-center gap-1 text-xs bg-primary-foreground/20 backdrop-blur-sm px-2 py-1 rounded-full text-primary-foreground">
                        <Clock className="h-3 w-3" />
                        <span>до {formatDate(promo.validUntil)}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3">
                    <h3 className="font-bold text-lg text-primary-foreground leading-tight">
                      {promo.title}
                    </h3>
                    <p className="text-sm text-primary-foreground/80 mt-1">{promo.description}</p>
                  </div>

                  {promo.discountPercent && (
                    <div className="mt-3 inline-flex items-center gap-1 bg-primary-foreground/20 backdrop-blur-sm px-3 py-1.5 rounded-lg">
                      <Percent className="h-4 w-4 text-primary-foreground" />
                      <span className="font-bold text-primary-foreground">-{promo.discountPercent}%</span>
                    </div>
                  )}
                </div>

                {/* Promo Code */}
                <div className="p-4 border-t border-border">
                  <div className="flex items-center justify-between bg-muted rounded-xl p-3">
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-primary" />
                      <span className="font-mono font-bold text-foreground text-sm">{promo.code}</span>
                    </div>
                    <button
                      onClick={() => handleCopyCode(promo.code)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                        copiedCode === promo.code
                          ? "bg-success text-success-foreground"
                          : "bg-primary text-primary-foreground hover:bg-primary/90"
                      )}
                    >
                      {copiedCode === promo.code ? "Скопійовано!" : "Копіювати"}
                    </button>
                  </div>
                </div>

                {/* Flash timer */}
                {promo.type === "flash" && promo.validUntil && (
                  <div className="px-4 pb-3">
                    <div className="flex items-center gap-2 text-warning">
                      <Clock className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        Залишилось: {Math.ceil((promo.validUntil.getTime() - Date.now()) / (1000 * 60 * 60))} год
                      </span>
                    </div>
                  </div>
                )}

                {/* CTA */}
                <div className="px-4 pb-4">
                  <button
                    onClick={() => handleApplyPromo(promo)}
                    className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground py-3 rounded-xl font-medium hover:bg-primary/90 transition-colors shadow-md"
                  >
                    Застосувати та перейти до товарів
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <p className="text-xs text-muted-foreground text-center mt-2 flex items-center justify-center gap-1">
                    <Info className="w-3 h-3" />
                    Промокод буде застосовано автоматично при оформленні
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default Promos;
