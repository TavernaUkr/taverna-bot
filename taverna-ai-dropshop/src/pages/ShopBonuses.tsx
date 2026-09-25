import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Gift, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { getPublicSupplier, type BackendPublicSupplier } from "@/lib/backendApi";
import { hapticSelection } from "@/lib/haptics";

/**
 * Бонусна програма магазину (заглушка).
 * Маршрут: /supplier/:id/bonuses — сюди веде іконка Gift на картці
 * магазину в «Моїх магазинах». Повна бонусна логіка (нарахування за
 * замовлення/відгуки конкретного магазину) підключається на етапі
 * монетизації; зараз показуємо вітрину програми + статус магазину.
 */
export default function ShopBonuses() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [supplier, setSupplier] = useState<BackendPublicSupplier | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = id ? await getPublicSupplier(id) : null;
        if (!cancelled) setSupplier(data);
      } catch (err) {
        console.error("Error loading supplier for bonuses:", err);
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
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Бонуси магазину</h1>
            <p className="text-sm text-muted-foreground">
              {supplier?.store_name || "Магазин"}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Статус програми */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Бонусна програма магазину незабаром
              </p>
              <p className="text-xs text-muted-foreground">
                Ми готуємо нарахування бонусів за замовлення та відгуки в цьому
                магазині. Ви отримаєте сповіщення, щойно програма запуститься.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Правила програми (статична заглушка) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Gift className="h-4 w-4 text-primary" />
              Як це працюватиме
            </CardTitle>
            <CardDescription>
              Бонуси — внутрішня валюта платформи, яку можна витрачати на
              знижку при наступних замовленнях.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              "1 бонус = 1 ₴ знижки на наступне замовлення",
              "Нарахування за завершене замовлення — після підтвердження доставки",
              "Додаткові бонуси за відгук із фото товару",
              "Бонусами можна оплатити до 50% суми замовлення",
            ].map((rule) => (
              <div
                key={rule}
                className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-muted/30"
              >
                <p className="text-sm text-foreground">{rule}</p>
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  Скоро
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => navigate(supplier ? `/supplier/${supplier.id}` : "/suppliers")}
        >
          До сторінки магазину
        </Button>
      </div>
    </div>
  );
}
