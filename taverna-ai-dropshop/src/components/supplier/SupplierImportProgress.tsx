import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import {
  BackendApiError,
  fetchSupplierImportProgress,
  type BackendSupplierImportProgress,
} from "@/lib/backendApi";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const POLL_MS = 10000;

export function SupplierImportProgress() {
  const { effectiveRole } = useTelegramAuthContext();
  const [progress, setProgress] = useState<BackendSupplierImportProgress | null>(null);

  useEffect(() => {
    if (effectiveRole !== "supplier") {
      setProgress(null);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const data = await fetchSupplierImportProgress();
        if (cancelled) return;
        setProgress(data);
        // Поки йде імпорт — оновлюємо кожні 10 с. Якщо товарів ще немає,
        // теж питаємо далі, щоб плашка з'явилась, щойно sync почнеться.
        if (data.is_importing || data.total === 0 || (data.queue_ahead ?? 0) > 0) {
          timer = window.setTimeout(load, POLL_MS);
        }
      } catch (error) {
        if (cancelled) return;
        const status = error instanceof BackendApiError ? error.status : undefined;
        if (status === 401 || status === 403 || status === 404) {
          setProgress(null);
          return;
        }
        timer = window.setTimeout(load, POLL_MS);
      }
    };

    load();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [effectiveRole]);

  if (effectiveRole !== "supplier" || !progress?.is_importing) {
    return null;
  }

  const { total, completed, estimated_minutes, queue_ahead = 0 } = progress;
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const remainingOwn = Math.max(0, total - completed);
  const displayMinutes =
    Math.ceil((remainingOwn + queue_ahead) * 15 / 60) || estimated_minutes || 0;

  return (
    <div
      className={cn(
        "fixed bottom-24 left-4 z-50 w-64 max-w-[calc(100vw-2rem)]",
        "rounded-xl border border-white/10 bg-zinc-950/85 p-3 text-white",
        "shadow-lg backdrop-blur-md"
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
        <div className="min-w-0">
          <p className="text-xs font-medium leading-snug">
            AI-обробка товарів... Завантажено {completed} з {total}
          </p>
          <p className="mt-0.5 text-[10px] text-white/60">
            Орієнтовний час: ~{displayMinutes} хв
          </p>
        </div>
      </div>
      {queue_ahead > 0 && (
        <p className="mt-2 text-[11px] font-medium leading-snug text-amber-300">
          ⏳ Ви в живій черзі. Перед вами обробляється товарів: {queue_ahead}
        </p>
      )}
      <Progress
        value={percent}
        className="mt-2 h-1.5 bg-white/15"
      />
    </div>
  );
}
