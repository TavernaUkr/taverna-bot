import { useState, useEffect } from "react";
import { Star, Store, Package, MessageSquare, HeadphonesIcon, ChevronRight, X, Gift, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useRatingRewards } from "@/hooks/useRatingRewards";
import { toast } from "sonner";
import { hapticNotification } from "@/lib/haptics";

interface OrderRatingPromptProps {
  orderId: string;
  orderNumber: string;
  items: Array<{
    product_id: string | null;
    product_name: string;
    product_image?: string;
  }>;
  onClose: () => void;
}

type RatingStep = "shop" | "products" | "manager" | "support" | "done";

interface StepRating {
  rating: number;
  comment: string;
}

export function OrderRatingPrompt({ orderId, orderNumber, items, onClose }: OrderRatingPromptProps) {
  const [step, setStep] = useState<RatingStep>("shop");
  const [shopRating, setShopRating] = useState<StepRating>({ rating: 0, comment: "" });
  const [productRatings, setProductRatings] = useState<Record<number, StepRating>>({});
  const [currentProductIdx, setCurrentProductIdx] = useState(0);
  const [managerRating, setManagerRating] = useState<StepRating>({ rating: 0, comment: "" });
  const [supportRating, setSupportRating] = useState<StepRating>({ rating: 0, comment: "" });
  const [hadManager, setHadManager] = useState(false);
  const [hadSupport, setHadSupport] = useState(false);
  const [totalBonus, setTotalBonus] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { awardForOrderReview, awardForRating } = useRatingRewards();

  // Detect participants
  useEffect(() => {
    const checkParticipants = async () => {
      try {
        const { data: tickets } = await supabase
          .from("support_tickets")
          .select("id")
          .eq("related_order_id", orderId);

        if (tickets?.length) {
          const ticketIds = tickets.map(t => t.id);
          const { data: messages } = await supabase
            .from("ticket_messages")
            .select("sender_role")
            .in("ticket_id", ticketIds);

          const roles = new Set(messages?.map(m => m.sender_role) || []);
          setHadManager(roles.has("supplier"));
          setHadSupport(roles.has("moderator") || roles.has("admin"));
        }
      } catch (err) {
        console.error("Error checking participants:", err);
      }
    };
    checkParticipants();
  }, [orderId]);

  const handleNext = async () => {
    if (step === "shop") {
      if (shopRating.rating === 0) { toast.error("Оберіть оцінку магазину"); return; }
      // Save shop rating
      await supabase.from("app_ratings").insert({
        rating: shopRating.rating,
        rating_type: "shop",
        order_id: orderId,
        comment: shopRating.comment || null,
      });
      
      if (items.length > 0) {
        setStep("products");
      } else if (hadManager) {
        setStep("manager");
      } else if (hadSupport) {
        setStep("support");
      } else {
        await finalize();
      }
    } else if (step === "products") {
      const r = productRatings[currentProductIdx];
      if (!r || r.rating === 0) { toast.error("Оберіть оцінку товару"); return; }
      
      const item = items[currentProductIdx];
      if (item.product_id) {
        await supabase.from("app_ratings").insert({
          rating: r.rating,
          rating_type: "product",
          target_id: item.product_id,
          order_id: orderId,
          comment: r.comment || null,
        });
        // Also add a verified review
        try {
          await supabase.from("reviews").insert({
            product_id: item.product_id,
            rating: r.rating,
            author_name: "Покупець",
            content: r.comment || null,
            is_verified_purchase: true,
          });
        } catch (_) {}
      }

      if (currentProductIdx < items.length - 1) {
        setCurrentProductIdx(prev => prev + 1);
      } else if (hadManager) {
        setStep("manager");
      } else if (hadSupport) {
        setStep("support");
      } else {
        await finalize();
      }
    } else if (step === "manager") {
      if (managerRating.rating === 0) { toast.error("Оберіть оцінку менеджера"); return; }
      await supabase.from("app_ratings").insert({
        rating: managerRating.rating,
        rating_type: "manager",
        order_id: orderId,
        comment: managerRating.comment || null,
      });
      if (hadSupport) {
        setStep("support");
      } else {
        await finalize();
      }
    } else if (step === "support") {
      if (supportRating.rating === 0) { toast.error("Оберіть оцінку підтримки"); return; }
      await supabase.from("app_ratings").insert({
        rating: supportRating.rating,
        rating_type: "support",
        order_id: orderId,
        comment: supportRating.comment || null,
      });
      await finalize();
    }
  };

  const finalize = async () => {
    setIsSubmitting(true);
    try {
      let bonus = 0;
      const orderBonus = await awardForOrderReview(orderId, false);
      bonus += orderBonus;

      if (hadManager && managerRating.rating > 0) {
        const mgr = await awardForRating(orderId, "manager_rating");
        bonus += mgr;
      }

      setTotalBonus(bonus);
      setStep("done");
      hapticNotification("success");
    } catch (err) {
      console.error("Error finalizing:", err);
      setStep("done");
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStars = (value: number, onChange: (v: number) => void) => (
    <div className="flex justify-center gap-2 my-4">
      {[1, 2, 3, 4, 5].map(s => (
        <button key={s} onClick={() => onChange(s)} className="p-1 transition-transform hover:scale-110">
          <Star className={cn("h-10 w-10", s <= value ? "text-warning fill-warning" : "text-muted-foreground/30")} />
        </button>
      ))}
    </div>
  );

  const stepLabels: Record<string, { icon: React.ElementType; title: string; subtitle: string }> = {
    shop: { icon: Store, title: "Оцініть магазин", subtitle: "Загальне враження від покупки" },
    products: { icon: Package, title: `Оцініть товар ${currentProductIdx + 1}/${items.length}`, subtitle: items[currentProductIdx]?.product_name || "" },
    manager: { icon: MessageSquare, title: "Оцініть менеджера", subtitle: "Якість обслуговування менеджером магазину" },
    support: { icon: HeadphonesIcon, title: "Оцініть тех. підтримку", subtitle: "Якість роботи підтримки платформи" },
  };

  if (step === "done") {
    return (
      <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center animate-fade-in" onClick={onClose}>
        <div className="bg-background rounded-3xl p-8 mx-4 max-w-sm w-full text-center animate-scale-in" onClick={e => e.stopPropagation()}>
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Дякуємо! 🎉</h2>
          <p className="text-muted-foreground mb-4">Ваші оцінки збережено.</p>
          {totalBonus > 0 && (
            <div className="bg-primary/10 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-center gap-2">
                <Gift className="h-5 w-5 text-primary" />
                <span className="text-lg font-bold text-primary">+{totalBonus}₴ бонусів</span>
              </div>
            </div>
          )}
          <Button onClick={onClose} className="w-full">Готово</Button>
        </div>
      </div>
    );
  }

  const currentStep = stepLabels[step];
  const StepIcon = currentStep?.icon || Store;

  const getCurrentRating = () => {
    if (step === "shop") return shopRating;
    if (step === "products") return productRatings[currentProductIdx] || { rating: 0, comment: "" };
    if (step === "manager") return managerRating;
    if (step === "support") return supportRating;
    return { rating: 0, comment: "" };
  };

  const setCurrentRating = (r: number) => {
    if (step === "shop") setShopRating(prev => ({ ...prev, rating: r }));
    else if (step === "products") setProductRatings(prev => ({ ...prev, [currentProductIdx]: { ...(prev[currentProductIdx] || { rating: 0, comment: "" }), rating: r } }));
    else if (step === "manager") setManagerRating(prev => ({ ...prev, rating: r }));
    else if (step === "support") setSupportRating(prev => ({ ...prev, rating: r }));
  };

  const setCurrentComment = (c: string) => {
    if (step === "shop") setShopRating(prev => ({ ...prev, comment: c }));
    else if (step === "products") setProductRatings(prev => ({ ...prev, [currentProductIdx]: { ...(prev[currentProductIdx] || { rating: 0, comment: "" }), comment: c } }));
    else if (step === "manager") setManagerRating(prev => ({ ...prev, comment: c }));
    else if (step === "support") setSupportRating(prev => ({ ...prev, comment: c }));
  };

  const rating = getCurrentRating();

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 animate-fade-in" onClick={onClose}>
      <div className="absolute inset-x-4 bottom-8 max-w-md mx-auto bg-background rounded-3xl overflow-hidden animate-slide-up" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <StepIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-foreground">{currentStep?.title}</h2>
              <p className="text-xs text-muted-foreground">{orderNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-sm text-muted-foreground text-center mb-2">{currentStep?.subtitle}</p>

          {step === "products" && items[currentProductIdx]?.product_image && (
            <div className="flex justify-center mb-3">
              <img src={items[currentProductIdx].product_image} alt="" className="w-16 h-16 rounded-xl object-cover" />
            </div>
          )}

          {renderStars(rating.rating, setCurrentRating)}

          {rating.rating > 0 && (
            <p className="text-sm text-center text-muted-foreground mb-3">
              {["", "Жахливо", "Погано", "Нормально", "Добре", "Чудово"][rating.rating]}
            </p>
          )}

          <textarea
            value={rating.comment}
            onChange={e => setCurrentComment(e.target.value)}
            placeholder="Коментар (необов'язково)..."
            className="w-full p-3 rounded-xl border border-border bg-card text-foreground resize-none h-20 text-sm"
          />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">Пізніше</Button>
          <Button onClick={handleNext} disabled={isSubmitting} className="flex-1 gap-2">
            {step === "support" || (!hadManager && !hadSupport && step === "products" && currentProductIdx === items.length - 1) || (!hadManager && !hadSupport && step === "shop" && items.length === 0)
              ? "Завершити"
              : <>Далі <ChevronRight className="h-4 w-4" /></>
            }
          </Button>
        </div>
      </div>
    </div>
  );
}
