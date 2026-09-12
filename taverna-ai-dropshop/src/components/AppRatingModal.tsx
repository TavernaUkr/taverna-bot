import { useState } from "react";
import { Star, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { toast } from "sonner";
import { hapticNotification } from "@/lib/haptics";
import { cn } from "@/lib/utils";

interface AppRatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  type?: "app" | "store";
  targetId?: string;
  targetName?: string;
}

export function AppRatingModal({ isOpen, onClose, type = "app", targetId, targetName }: AppRatingModalProps) {
  const { profile } = useTelegramAuthContext();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const title = type === "app" ? "Оцінка додатку" : `Оцінка магазину${targetName ? ` "${targetName}"` : ""}`;
  const description = type === "app" 
    ? "Ваша думка важлива для нас! Допоможіть нам стати кращими." 
    : "Оцініть якість обслуговування цього магазину";

  const handleSubmit = async () => {
    if (rating === 0) {
      toast.error("Оберіть оцінку");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("app_ratings" as any).insert({
        profile_id: profile?.id || null,
        rating,
        comment: comment.trim() || null,
        rating_type: type,
        target_id: targetId || null,
      });

      if (error) throw error;

      hapticNotification("success");
      setSubmitted(true);
      toast.success("Дякуємо за вашу оцінку! 🎉");
      
      setTimeout(() => {
        onClose();
        setRating(0);
        setComment("");
        setSubmitted(false);
      }, 1500);
    } catch (err) {
      console.error("Rating error:", err);
      toast.error("Помилка збереження оцінки");
    } finally {
      setIsSubmitting(false);
    }
  };

  const ratingLabels = ["", "Жахливо", "Погано", "Нормально", "Добре", "Чудово!"];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-warning fill-warning" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-3">🎉</div>
            <p className="font-semibold text-foreground">Дякуємо!</p>
            <p className="text-sm text-muted-foreground">Ваш відгук збережено</p>
          </div>
        ) : (
          <div className="space-y-5 mt-2">
            {/* Star Rating */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="p-1 transition-transform hover:scale-125 active:scale-95"
                  >
                    <Star
                      className={cn(
                        "h-9 w-9 transition-colors",
                        star <= (hoverRating || rating)
                          ? "text-warning fill-warning"
                          : "text-muted-foreground/30"
                      )}
                    />
                  </button>
                ))}
              </div>
              {(hoverRating || rating) > 0 && (
                <p className="text-sm font-medium text-foreground mt-2">
                  {ratingLabels[hoverRating || rating]}
                </p>
              )}
            </div>

            {/* Comment */}
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Що можна покращити? (необов'язково)"
              className="resize-none"
              rows={3}
            />

            {/* Submit */}
            <Button
              onClick={handleSubmit}
              disabled={rating === 0 || isSubmitting}
              className="w-full"
              size="lg"
            >
              {isSubmitting ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <Send className="h-5 w-5 mr-2" />
              )}
              Надіслати оцінку
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
