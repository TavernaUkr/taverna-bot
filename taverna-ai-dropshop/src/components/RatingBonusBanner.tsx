import { useState, useEffect } from "react";
import { Star, ChevronRight, Gift } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "./TelegramAuthProvider";

interface RatingBonusBannerProps {
  variant?: "checkout" | "profile";
}

export function RatingBonusBanner({ variant = "checkout" }: RatingBonusBannerProps) {
  const { profile, isAuthenticated } = useTelegramAuthContext();
  const navigate = useNavigate();
  const [unratedCount, setUnratedCount] = useState(0);
  const [potentialBonus, setPotentialBonus] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !profile?.id) return;

    const checkUnratedOrders = async () => {
      try {
        // Get completed orders
        const { data: orders } = await supabase
          .from("orders")
          .select("id")
          .eq("profile_id", profile.id)
          .in("status", ["delivered", "received"]);

        if (!orders?.length) return;

        // Get already rewarded orders
        const { data: rewards } = await supabase
          .from("rating_rewards" as any)
          .select("order_id")
          .eq("profile_id", profile.id)
          .eq("reward_type", "review_text");

        const rewardedOrderIds = new Set((rewards || []).map((r: any) => r.order_id));
        const unrated = orders.filter(o => !rewardedOrderIds.has(o.id));

        setUnratedCount(unrated.length);
        // 10₴ per text review + potential 15₴ for photo
        setPotentialBonus(unrated.length * 25);
      } catch (err) {
        console.error("Error checking unrated orders:", err);
      }
    };

    checkUnratedOrders();
  }, [isAuthenticated, profile?.id]);

  if (unratedCount === 0) return null;

  return (
    <button
      onClick={() => navigate("/orders-history")}
      className="w-full flex items-center gap-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors text-left"
    >
      <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
        <Gift className="h-5 w-5 text-amber-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          Оцініть {unratedCount} {unratedCount === 1 ? "замовлення" : "замовлень"}
        </p>
        <p className="text-xs text-muted-foreground">
          Отримайте до {potentialBonus}₴ бонусів за відгуки
        </p>
      </div>
      <div className="flex items-center gap-1 text-amber-500 flex-shrink-0">
        <Star className="h-4 w-4 fill-amber-500" />
        <ChevronRight className="h-4 w-4" />
      </div>
    </button>
  );
}
