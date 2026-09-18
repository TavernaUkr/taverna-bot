import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import {
  BackendApiError,
  fetchSupplierImportProgress,
  type BackendWidgetQueueShop,
} from "@/lib/backendApi";

const POLL_MS = 10000;

function ShopQueueRows({ queueData }: { queueData: BackendWidgetQueueShop[] }) {
  return (
    <>
      {queueData.map((shop, index) => {
        const isFetching =
          Boolean(shop.is_fetching_xml) ||
          shop.status === "parsing" ||
          shop.status === "fetching_xml";
        const isProcessing = shop.status === "processing";

        let topText = "";
        if (isFetching) {
          topText = `Завантаження XML: ${shop.shop_name}...`;
        } else if (isProcessing) {
          topText = `AI-обробка: ${shop.shop_name}... Завантажено ${shop.processed} з ${shop.total}`;
        } else {
          topText = `Очікування: ${shop.shop_name} (Ви в черзі ${shop.queue_position})`;
        }

        const percentage = shop.total > 0 ? (shop.processed / shop.total) * 100 : 0;
        const isIndeterminate = shop.total === 0 && (isFetching || isProcessing);
        const showBar = isFetching || isProcessing;

        return (
          <div
            key={shop.supplier_id || shop.shop_name}
            className={`flex flex-col h-auto min-h-min ${index > 0 ? "pt-3 border-t border-white/10" : ""}`}
          >
            <div className="flex items-start gap-2">
              <Loader2 className="w-4 h-4 text-emerald-500 animate-spin shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="text-xs font-medium text-slate-200 whitespace-normal break-words leading-tight block">
                  {topText}
                </span>
                <span className="text-[10px] text-slate-400 mt-1 whitespace-normal break-words leading-tight block">
                  Орієнтовний час: ~{shop.estimated_minutes} хв
                </span>
              </div>
            </div>
            {showBar && (
              <div className="mt-2 h-1.5 w-full bg-slate-700/50 rounded-full overflow-hidden">
                <div
                  className={
                    isIndeterminate
                      ? "h-full w-full bg-emerald-500 animate-pulse"
                      : "h-full bg-emerald-500 transition-all duration-500"
                  }
                  style={isIndeterminate ? undefined : { width: `${percentage}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Плаваючий віджет: лише магазини поточного користувача з /suppliers/me/import-progress. */
export function GlobalAIWidget() {
  const { isAuthenticated, effectiveRole } = useTelegramAuthContext();
  const enabled =
    isAuthenticated &&
    (effectiveRole === "supplier" || effectiveRole === "admin" || effectiveRole === "owner");
  const [queueData, setQueueData] = useState<BackendWidgetQueueShop[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setQueueData([]);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const data = await fetchSupplierImportProgress();
        if (cancelled) return;
        setQueueData(Array.isArray(data) ? data.filter(Boolean) : []);
      } catch (error) {
        if (cancelled) return;
        const status = error instanceof BackendApiError ? error.status : undefined;
        if (status === 401 || status === 403 || status === 404) {
          setQueueData([]);
          return;
        }
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

  if (!enabled) return null;
  if (!Array.isArray(queueData) || queueData.length === 0) return null;

  return (
    <div className="fixed bottom-24 left-4 z-[100] flex items-end pointer-events-none">
      <div
        className={`pointer-events-auto cursor-pointer flex items-center justify-center bg-[#1c1c1e]/90 backdrop-blur-xl border border-white/10 border-l-0 rounded-r-xl p-2 shadow-lg transition-all duration-500 hover:bg-slate-800 ${isCollapsed ? "translate-x-0 opacity-100 w-10" : "-translate-x-full opacity-0 w-0 overflow-hidden"}`}
        onClick={() => setIsCollapsed(false)}
      >
        <ChevronRight className="w-5 h-5 text-emerald-500 animate-pulse" />
      </div>

      <div
        className={`pointer-events-auto relative ml-2 bg-[#1c1c1e]/85 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.5)] flex flex-col gap-3 transition-all duration-500 ease-in-out origin-left ${isCollapsed ? "w-0 h-0 opacity-0 scale-x-0 p-0 border-0 overflow-hidden" : "w-[240px] h-auto min-h-min opacity-100 scale-x-100 p-3 pr-8"}`}
      >
        <button
          type="button"
          onClick={() => setIsCollapsed(true)}
          className="absolute top-2 right-2 p-1 text-slate-400 hover:text-white bg-white/5 rounded-full transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <ShopQueueRows queueData={queueData} />
      </div>
    </div>
  );
}
