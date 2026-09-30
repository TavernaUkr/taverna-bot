import { useEffect, useMemo, useState } from "react";
import { Loader2, Package, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useQueryClient } from "@tanstack/react-query";
import {
  BackendApiError,
  startShopImport,
  type BackendMyShop,
} from "@/lib/backendApi";
import { hapticSelection } from "@/lib/haptics";

/**
 * Модалка вибору ліміту імпорту (статус магазина waiting_limit):
 * «Скільки останніх товарів завантажити з каналу?»
 *
 * max  = store.total_posts_last_year (скан за 365 днів) або 1000.
 * defaultValue = половина від знайденого.
 */
export default function StoreLimitModal({
  store,
  onClose,
  onStarted,
}: {
  store: BackendMyShop;
  onClose: () => void;
  /** Опційний колбек після успішного старту (рефетч і т.д.). */
  onStarted?: () => void;
}) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Максимальний ліміт: постів знайдено сканом (або 1000, якщо не визначено)
  const maxLimit = useMemo(() => {
    const scanned = Number(store.total_posts_last_year || 0);
    return scanned > 0 ? scanned : 1000;
  }, [store.total_posts_last_year]);

  // Дефолт — половина від знайденого
  const [limit, setLimit] = useState<number>(() =>
    Math.max(1, Math.floor(maxLimit / 2))
  );

  // Якщо store помінявся (інший магазин) — перераховуємо дефолт
  useEffect(() => {
    setLimit(Math.max(1, Math.floor(maxLimit / 2)));
  }, [maxLimit]);

  const submit = async () => {
    if (isSubmitting) return;
    if (!Number.isFinite(limit) || limit < 1) {
      toast.error("Ліміт має бути числом від 1 і більше");
      return;
    }
    const safeLimit = Math.min(Math.floor(limit), maxLimit);
    setIsSubmitting(true);
    try {
      await startShopImport(Number(store.id), safeLimit);
      hapticSelection();
      toast.success(
        `Завантаження запущено! Імпортуємо ${safeLimit} останніх товарів з каналу`
      );
      // Інвалідуємо кеш «Моїх магазинів» (react-query) і локальний стан сторінки
      await queryClient.invalidateQueries({ queryKey: ["myShops"] });
      onStarted?.();
      onClose();
    } catch (error) {
      const message =
        error instanceof BackendApiError
          ? error.message
          : "Не вдалося запустити імпорт товарів";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[420px] mx-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-white">
            <Sparkles className="h-5 w-5 text-primary shrink-0" />
            Вітаємо, ваш магазин схвалено!
          </DialogTitle>
          <DialogDescription className="text-left text-slate-600 dark:text-slate-300 leading-relaxed">
            Магазин <span className="font-semibold">{store.store_name}</span> схвалено.
            За останній рік у вашому каналі знайдено{" "}
            <span className="font-semibold text-primary">
              {store.total_posts_last_year || maxLimit}
            </span>{" "}
            постів. Оберіть, яку кількість останніх товарів ви бажаєте завантажити
            на платформу.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Slider: швидкий вибір */}
          <div className="space-y-3">
            <Slider
              value={[limit]}
              min={1}
              max={maxLimit}
              step={1}
              onValueChange={(values) => setLimit(values[0] ?? limit)}
              disabled={isSubmitting}
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>1</span>
              <span>{maxLimit}</span>
            </div>
          </div>

          {/* Точний ввід числа */}
          <div className="space-y-1.5">
            <Label htmlFor="import-limit" className="text-slate-800 dark:text-slate-200">
              Кількість останніх товарів
            </Label>
            <Input
              id="import-limit"
              type="number"
              inputMode="numeric"
              min={1}
              max={maxLimit}
              value={limit}
              onChange={(event) => {
                const raw = event.target.value;
                const parsed = Number.parseInt(raw, 10);
                setLimit(Number.isFinite(parsed) && parsed >= 1 ? parsed : 1);
              }}
              disabled={isSubmitting}
              className="h-11"
            />
            <p className="text-[11px] text-muted-foreground">
              Завантажимо {limit || 0} останніх постів каналу — найсвіжіші товари
              з'являться в магазині першими.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => !isSubmitting && onClose()}
            disabled={isSubmitting}
          >
            Пізніше
          </Button>
          <Button onClick={submit} disabled={isSubmitting} className="gap-2">
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Package className="h-4 w-4" />
            )}
            Завантажити товари
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
