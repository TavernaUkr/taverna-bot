import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Gift, Sparkles, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { hapticSelection } from "@/lib/haptics";

/** Преміальний банер акцій на головній. */
export const PromoHeroBanner = () => {
  const navigate = useNavigate();
  const [promoCount, setPromoCount] = useState(0);

  useEffect(() => {
    supabase
      .from("promo_codes")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .then(({ count }) => setPromoCount(count || 0));
  }, []);

  const go = (to: string) => {
    hapticSelection();
    navigate(to);
  };

  return (
    <section className="space-y-2.5 animate-fade-in">
      <button
        onClick={() => go("/promos")}
        aria-label="Акції та знижки"
        className="group relative w-full overflow-hidden rounded-2xl p-4 text-center text-primary-foreground bg-gradient-to-br from-primary via-primary/85 to-live shadow-lg active:scale-[0.985] transition-transform duration-150"
      >
        {/* м'яке світіння */}
        <span className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-56 h-56 rounded-full bg-primary-foreground/15 blur-2xl animate-pulse" />
        {/* біжучий блиск */}
        <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-primary-foreground/25 to-transparent skew-x-12 animate-[slide-in-right_2.4s_ease-in-out_infinite]" />

        <div className="relative z-10 flex flex-col items-center gap-1.5">
          <div className="relative w-12 h-12 rounded-2xl bg-primary-foreground/20 backdrop-blur-sm flex items-center justify-center">
            <Gift className="h-6 w-6" />
            <Sparkles className="absolute -top-1 -right-1 h-4 w-4 text-warning animate-pulse" />
            <Sparkles className="absolute -bottom-1 -left-1 h-3 w-3 text-warning/80 animate-ping" />
          </div>
          <p className="text-[17px] font-extrabold leading-tight">Акції та знижки</p>
          <p className="text-[11px] opacity-90">
            {promoCount > 0 ? `${promoCount} активних пропозицій зараз` : "Свіжі пропозиції щодня"}
          </p>
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1 rounded-full bg-primary-foreground/20 backdrop-blur-sm">
            Переглянути <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </button>
    </section>
  );
};
