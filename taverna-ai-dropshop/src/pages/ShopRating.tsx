import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Loader2, Star, MessageCircle, Trophy, ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useEffect, useState } from "react";
// ВАЖЛИВО: відгуки — legacy Supabase (мігруємо на FastAPI окремим етапом),
// тому статистику рейтингу рахуємо так само, як на /supplier/{id}?tab=reviews.
import { supabase } from "@/integrations/supabase/client";
import { getPublicSupplier, type BackendPublicSupplier } from "@/lib/backendApi";
import { hapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * Рейтинг конкретного магазину.
 * Маршрут: /supplier/:id/rating — сюди ведуть іконки Trophy / ThumbsUp
 * на картці магазину в «Моїх магазинах».
 * Показує середню оцінку, розподіл по зірках і останні відгуки.
 */
interface ShopReview {
  id: string;
  author_name: string;
  rating: number;
  content?: string;
  created_at: string;
  is_verified_purchase: boolean;
  helpful_count: number;
}

function ratingLabel(avg: number): string {
  if (avg >= 4.5) return "Відмінно";
  if (avg >= 3.8) return "Добре";
  if (avg >= 3) return "Нормально";
  if (avg > 0) return "Потребує покращення";
  return "Ще немає оцінок";
}

export default function ShopRating() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [supplier, setSupplier] = useState<BackendPublicSupplier | null>(null);
  const [reviews, setReviews] = useState<ShopReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1) Публічні дані магазину (назва, лого) — FastAPI, без авторизації.
        const data = id ? await getPublicSupplier(id) : null;
        if (cancelled) return;
        setSupplier(data);

        // 2) Відгуки товарів магазину — Supabase (product_ids → reviews).
        if (!id) return;
        const { data: productIds } = await supabase
          .from("products")
          .select("id")
          .eq("supplier_id", id);

        if (productIds && productIds.length > 0 && !cancelled) {
          const ids = productIds.map((p) => p.id);
          const { data: reviewsData, error } = await supabase
            .from("reviews")
            .select("*")
            .in("product_id", ids)
            .order("created_at", { ascending: false })
            .limit(50);
          if (!error && reviewsData && !cancelled) {
            setReviews(reviewsData as ShopReview[]);
          }
        }
      } catch (err) {
        console.error("Error loading shop rating:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const reviewCount = reviews.length;
  const averageRating = reviewCount
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
    : 0;

  // Розподіл оцінок: скільки відгуків з 1..5 зірок
  const distribution = [5, 4, 3, 2, 1].map((stars) => {
    const count = reviews.filter((r) => r.rating === stars).length;
    return {
      stars,
      count,
      percentage: reviewCount ? (count / reviewCount) * 100 : 0,
    };
  });

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-card border-b border-border">
        <div className="flex items-center gap-3 p-4">
          <button
            onClick={() => {
              hapticSelection();
              navigate(-1);
            }}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-2.5">
            <Avatar className="h-9 w-9 rounded-lg border border-border shrink-0">
              <AvatarImage src={supplier?.logo_url || undefined} alt={supplier?.store_name || ""} />
              <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-sm font-bold">
                {(supplier?.store_name || "М").charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-foreground truncate">Рейтинг магазину</h1>
              <p className="text-sm text-muted-foreground truncate">
                {supplier?.store_name || "Магазин"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* === Підсумок: середня оцінка + розподіл по зірках === */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-rating" />
              Оцінка магазину
            </CardTitle>
            <CardDescription>
              На основі відгуків покупців про товари цього магазину
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Середня оцінка */}
            <div className="flex items-center gap-4">
              <div className="text-center shrink-0">
                <p className="text-4xl font-bold text-foreground">
                  {reviewCount ? averageRating.toFixed(1) : "—"}
                </p>
                <div className="flex items-center justify-center gap-0.5 mt-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      className={cn(
                        "h-3.5 w-3.5",
                        reviewCount && averageRating >= s - 0.5
                          ? "text-warning fill-warning"
                          : "text-muted-foreground/30"
                      )}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {reviewCount} {reviewCount === 1 ? "відгук" : "відгуків"}
                </p>
              </div>

              {/* Розподіл по зірках */}
              <div className="flex-1 space-y-1.5 min-w-0">
                {distribution.map((row) => (
                  <div key={row.stars} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-3 shrink-0">
                      {row.stars}
                    </span>
                    <Star className="h-3 w-3 text-warning fill-warning shrink-0" />
                    <Progress value={row.percentage} className="h-1.5 flex-1" />
                    <span className="text-xs text-muted-foreground w-6 text-right shrink-0">
                      {row.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Badge variant="secondary" className="text-[10px]">
                {ratingLabel(averageRating)}
              </Badge>
              {reviewCount > 0 && (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <ThumbsUp className="h-3 w-3" />
                  {reviews.filter((r) => r.is_verified_purchase).length} перевірених покупок
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* === Останні відгуки (максимум 3) === */}
        {reviewCount > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-primary" />
                Останні відгуки
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {reviews.slice(0, 3).map((review) => (
                <div
                  key={review.id}
                  className="p-3 rounded-xl border border-border bg-muted/30 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground truncate">
                      {review.author_name || "Покупець"}
                    </p>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={cn(
                            "h-3 w-3",
                            review.rating >= s
                              ? "text-warning fill-warning"
                              : "text-muted-foreground/30"
                          )}
                        />
                      ))}
                    </div>
                  </div>
                  {review.content && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {review.content}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* === Навігація: відгуки магазину + загальні рейтинги === */}
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={() => {
            hapticSelection();
            navigate(`/supplier/${id}?tab=reviews`);
          }}
        >
          <MessageCircle className="h-4 w-4" />
          Усі відгуки магазину
        </Button>
        <Button
          variant="ghost"
          className="w-full gap-2"
          onClick={() => {
            hapticSelection();
            navigate("/ratings");
          }}
        >
          <Trophy className="h-4 w-4" />
          Загальні рейтинги платформи
        </Button>
      </div>
    </div>
  );
}
