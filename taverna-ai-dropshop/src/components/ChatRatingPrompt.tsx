import { useState } from "react";
import { Star, X, Gift, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useRatingRewards } from "@/hooks/useRatingRewards";
import { toast } from "sonner";
import { hapticNotification } from "@/lib/haptics";

interface ChatRatingPromptProps {
  ticketId: string;
  orderId?: string | null;
  raterRole: "user" | "moderator" | "supplier";
  targetRole: string; // who is being rated
  targetLabel: string; // display name like "менеджера" / "клієнта"
  onClose: () => void;
}

export function ChatRatingPrompt({ ticketId, orderId, raterRole, targetRole, targetLabel, onClose }: ChatRatingPromptProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [isDone, setIsDone] = useState(false);
  const [bonus, setBonus] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { awardForRating } = useRatingRewards();

  const handleSubmit = async () => {
    if (rating === 0) { toast.error("Оберіть оцінку"); return; }
    setIsSubmitting(true);

    try {
      // Determine rating_type based on what we're rating
      let ratingType = "manager";
      if (targetRole === "customer" || targetRole === "user") ratingType = "customer";
      else if (targetRole === "support" || targetRole === "moderator") ratingType = "support";

      await supabase.from("app_ratings").insert({
        rating,
        rating_type: ratingType,
        ticket_id: ticketId,
        order_id: orderId || null,
        comment: comment.trim() || null,
      });

      // Award bonus if customer rates manager
      let awarded = 0;
      if (raterRole === "user" && orderId) {
        awarded = await awardForRating(orderId, "manager_rating");
      }

      setBonus(awarded);
      setIsDone(true);
      hapticNotification("success");
    } catch (err) {
      console.error("Error submitting chat rating:", err);
      toast.error("Помилка збереження оцінки");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isDone) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 text-center mx-4 my-4">
        <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
        <p className="font-semibold text-foreground mb-1">Дякуємо за оцінку!</p>
        {bonus > 0 && (
          <div className="flex items-center justify-center gap-2 text-primary font-bold">
            <Gift className="h-4 w-4" />
            +{bonus}₴ бонусів
          </div>
        )}
        <Button variant="outline" onClick={onClose} className="mt-4 w-full" size="sm">Закрити</Button>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-4 mx-4 my-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold text-foreground text-sm">Оцініть {targetLabel}</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex justify-center gap-2 mb-3">
        {[1, 2, 3, 4, 5].map(s => (
          <button key={s} onClick={() => setRating(s)} className="p-0.5">
            <Star className={cn("h-8 w-8", s <= rating ? "text-warning fill-warning" : "text-muted-foreground/30")} />
          </button>
        ))}
      </div>

      {rating > 0 && (
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Коментар..."
          className="w-full p-2.5 rounded-xl border border-border bg-background text-foreground resize-none h-16 text-sm mb-3"
        />
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose} className="flex-1" size="sm">Пропустити</Button>
        <Button onClick={handleSubmit} disabled={rating === 0 || isSubmitting} className="flex-1" size="sm">
          Оцінити
          {raterRole === "user" && <span className="ml-1 text-xs opacity-80">+5₴</span>}
        </Button>
      </div>
    </div>
  );
}
