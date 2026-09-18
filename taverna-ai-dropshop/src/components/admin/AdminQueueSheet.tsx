import { useEffect, useState } from "react";
import { Cpu, Loader2, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  BackendApiError,
  fetchAdminAiQueue,
  type BackendAdminAiQueue,
} from "@/lib/backendApi";
import { formatLocalTime } from "@/utils/dateFormatter";

const POLL_MS = 10000;

function useAdminAiQueue(enabled: boolean) {
  const [queue, setQueue] = useState<BackendAdminAiQueue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchAdminAiQueue();
        if (cancelled) return;
        setQueue(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const status = err instanceof BackendApiError ? err.status : undefined;
        if (status === 401 || status === 403) {
          setQueue(null);
          setError("Немає доступу до глобальної черги");
        } else {
          setError("Не вдалося завантажити чергу");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) {
        timer = window.setTimeout(load, POLL_MS);
      }
    };

    load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled]);

  return { queue, loading, error };
}

function AdminQueueList({
  queue,
  loading,
  error,
}: {
  queue: BackendAdminAiQueue | null;
  loading: boolean;
  error: string | null;
}) {
  const current = queue?.current_processing;
  const waiting = queue?.waiting_list || [];
  const isEmpty = !current && waiting.length === 0;
  const currentPercent =
    current && current.total > 0
      ? Math.min(100, Math.round((current.processed / current.total) * 100))
      : 0;

  if (loading && !queue) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (isEmpty) {
    return (
      <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
        Всі товари успішно оброблені
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {current && (
        <div className="flex h-auto min-h-min flex-col rounded-2xl border border-emerald-500/20 bg-slate-200/80 p-3 text-slate-900 shadow-md backdrop-blur-md dark:border-white/10 dark:bg-zinc-950/80 dark:text-white">
          <div className="flex items-start gap-2">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-500" />
            <div className="flex-1">
              <p className="whitespace-normal break-words text-sm font-medium leading-tight">
                {current.is_fetching_xml
                  ? `Завантаження XML: ${current.shop_name} (ID ${current.supplier_id})`
                  : `Зараз: ${current.shop_name} (ID ${current.supplier_id})`}
              </p>
              <p className="whitespace-normal break-words text-sm leading-tight">
                {current.is_fetching_xml
                  ? "Товарів у базі ще немає · парсинг каталогу"
                  : `Завантажено ${current.processed} з ${current.total}${
                      typeof current.pending_count === "number" ? ` · у роботі ${current.pending_count}` : ""
                    }`}
              </p>
              <p className="mt-0.5 whitespace-normal break-words text-[11px] leading-tight text-slate-600 dark:text-slate-300">
                Орієнтовний час: ~{current.remaining_minutes} хв · зареєстровано {formatLocalTime(current.created_at)}
              </p>
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-400/80 dark:bg-slate-700">
            <div
              className={
                current.total === 0
                  ? "h-full w-full bg-emerald-500 animate-pulse"
                  : "h-full bg-emerald-500 transition-all"
              }
              style={current.total === 0 ? undefined : { width: `${currentPercent}%` }}
            />
          </div>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Далі в черзі
          </p>
          {waiting.map((item) => (
            <div
              key={item.supplier_id}
              className="h-auto min-h-min rounded-2xl border border-slate-300/60 bg-slate-200/80 p-3 text-slate-900 shadow-md backdrop-blur-md dark:border-white/10 dark:bg-zinc-950/80 dark:text-white"
            >
              {item.is_fetching_xml ? (
                <>
                  <p className="whitespace-normal break-words text-sm font-medium leading-tight text-amber-700 dark:text-amber-300">
                    ⏳ {item.shop_name} (ID {item.supplier_id})
                  </p>
                  <p className="mt-0.5 whitespace-normal break-words text-[11px] leading-tight text-slate-600 dark:text-slate-300">
                    В черзі {item.queue_position}
                    {typeof item.wait_minutes === "number" ? ` · чекати ~${item.wait_minutes} хв` : ""}
                  </p>
                </>
              ) : (
                <>
                  <p className="whitespace-normal break-words text-sm font-medium leading-tight text-amber-700 dark:text-amber-300">
                    ⏳ {item.shop_name} (ID {item.supplier_id})
                  </p>
                  <p className="mt-0.5 whitespace-normal break-words text-[11px] leading-tight text-slate-600 dark:text-slate-300">
                    В черзі {item.queue_position} · {item.pending_count} товарів
                    {typeof item.wait_minutes === "number" ? ` · чекати ~${item.wait_minutes} хв` : ""}
                    {typeof item.remaining_minutes === "number" ? ` · до кінця ~${item.remaining_minutes} хв` : ""}
                  </p>
                </>
              )}
              <p className="mt-0.5 whitespace-normal break-words text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                Зареєстровано {formatLocalTime(item.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Видимий блок глобальної черги — одразу на екрані Огляд. */
export function AdminAiQueuePanel() {
  const { queue, loading, error } = useAdminAiQueue(true);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3 pb-24">
      <div className="flex items-center gap-2">
        <Cpu className="h-5 w-5 text-primary" />
        <div>
          <p className="text-sm font-semibold text-foreground">Перегляд AI-обробок</p>
          <p className="text-[11px] text-muted-foreground">
            Усі магазини системи в черзі, включно з доданими вручну
          </p>
        </div>
      </div>
      <AdminQueueList queue={queue} loading={loading} error={error} />
    </div>
  );
}

export function AdminQueueSheet({ onOpenTab }: { onOpenTab?: () => void }) {
  const [open, setOpen] = useState(false);
  const { queue, loading, error } = useAdminAiQueue(open);

  return (
    <>
      <Button
        variant="outline"
        className="h-auto flex-col gap-1.5 py-3 text-foreground"
        onClick={() => {
          if (onOpenTab) {
            onOpenTab();
            return;
          }
          setOpen(true);
        }}
      >
        <ListOrdered className="h-5 w-5 text-primary" />
        <span className="text-[11px] leading-tight">Перегляд AI-обробок</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[80vh] overflow-y-auto rounded-t-2xl bg-background text-foreground"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-slate-900 dark:text-white">
              <Cpu className="h-5 w-5 text-primary" />
              Перегляд AI-обробок
            </SheetTitle>
            <SheetDescription className="text-slate-500 dark:text-slate-400">
              Усі магазини системи в черзі: хто зараз, хто далі, ID і час реєстрації.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 pb-6">
            <AdminQueueList queue={queue} loading={loading} error={error} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
