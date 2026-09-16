import { useEffect, useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import {
  BackendApiError,
  fetchAdminImportProgress,
  fetchSupplierImportProgress,
  type BackendSupplierImportProgress,
} from "@/lib/backendApi";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const POLL_MS = 10000;

interface SupplierImportProgressProps {
  isAdmin?: boolean;
  variant?: "floating" | "inline";
}

function WaitingQueueNotice({
  queuePosition,
  className,
}: {
  queuePosition: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-amber-400/50 bg-amber-500/15 p-3",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <p className="text-sm font-medium leading-snug text-amber-950 dark:text-amber-100">
        ⏳ Очікування черги. Перед вами постачальників: {queuePosition}. AI почне
        обробку ваших товарів автоматично.
      </p>
    </div>
  );
}

export function SupplierImportProgress({
  isAdmin = false,
  variant = "floating",
}: SupplierImportProgressProps) {
  const { effectiveRole } = useTelegramAuthContext();
  const [progress, setProgress] = useState<BackendSupplierImportProgress | null>(null);
  const enabled = isAdmin
    ? effectiveRole === "admin"
    : effectiveRole === "supplier" || (effectiveRole === "admin" && variant === "inline");

  useEffect(() => {
    if (!enabled) {
      setProgress(null);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const data = isAdmin
          ? await fetchAdminImportProgress()
          : await fetchSupplierImportProgress();
        if (cancelled) return;
        setProgress(data);
        if (
          data.is_importing ||
          data.total === 0 ||
          (data.queue_ahead ?? 0) > 0 ||
          (data.queue_position ?? 0) > 0 ||
          isAdmin
        ) {
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
  }, [enabled, isAdmin]);

  if (!enabled || !progress) {
    return null;
  }

  const {
    total,
    completed,
    estimated_minutes,
    queue_ahead = 0,
    queue_position = 0,
    is_importing,
  } = progress;
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const remainingOwn = Math.max(0, total - completed);
  const displayMinutes =
    Math.ceil((remainingOwn + (isAdmin ? 0 : queue_ahead)) * 15 / 60) || estimated_minutes || 0;
  const pendingCount = isAdmin ? queue_ahead : Math.max(0, remainingOwn);
  const hasPending = is_importing || pendingCount > 0;
  const isWaitingInQueue = !isAdmin && queue_position > 0;

  if (isWaitingInQueue) {
    if (variant === "inline") {
      return (
        <WaitingQueueNotice queuePosition={queue_position} className="mx-4 mb-1" />
      );
    }
    return (
      <WaitingQueueNotice
        queuePosition={queue_position}
        className="fixed bottom-24 left-4 z-50 w-64 max-w-[calc(100vw-2rem)] shadow-lg"
      />
    );
  }

  if (variant === "inline") {
    return (
      <Card className="mx-4 mb-1 border-primary/20 bg-primary/5">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-start gap-2">
            {is_importing ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary mt-0.5" />
            ) : (
              <Bot className="h-4 w-4 shrink-0 text-primary mt-0.5" />
            )}
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">
                {is_importing
                  ? `AI-черга: оброблено ${completed} з ${total}`
                  : total > 0
                    ? `AI-черга порожня · ${completed} з ${total} готово`
                    : "AI-черга порожня"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {is_importing
                  ? `У черзі ${pendingCount} товарів · орієнтовно ~${displayMinutes} хв`
                  : "Нові імпорти з'являться тут автоматично"}
              </p>
            </div>
          </div>
          <Progress value={is_importing ? percent : total > 0 ? 100 : 0} className="h-1.5" />
        </CardContent>
      </Card>
    );
  }

  if (!is_importing && !hasPending) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed bottom-24 left-4 z-50 w-64 max-w-[calc(100vw-2rem)]",
        "rounded-xl border border-border bg-card p-3 text-foreground",
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
          <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
            Орієнтовний час: ~{displayMinutes} хв
          </p>
        </div>
      </div>
      <Progress
        value={percent}
        className="mt-2 h-1.5 bg-white/15"
      />
    </div>
  );
}
