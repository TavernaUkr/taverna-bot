import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import {
  BackendApiError,
  fetchAdminAiQueue,
  fetchSupplierImportProgress,
  type BackendAdminAiQueue,
  type BackendWidgetQueueShop,
} from "@/lib/backendApi";

const POLL_MS = 10000;

function shopsFromAdminQueue(data: BackendAdminAiQueue | null | undefined): BackendWidgetQueueShop[] {
  if (!data) return [];
  if (Array.isArray(data.shops) && data.shops.length > 0) {
    return data.shops.filter(Boolean).map((shop) => ({
      shop_name: shop.shop_name,
      status:
        shop.status ||
        (shop.is_fetching_xml ? "fetching_xml" : shop.is_processing ? "processing" : "waiting"),
      processed: shop.processed,
      total: shop.total,
      queue_position: shop.queue_position,
      estimated_minutes: shop.estimated_minutes ?? shop.wait_minutes ?? 0,
      supplier_id: shop.supplier_id,
      is_fetching_xml: Boolean(shop.is_fetching_xml),
    }));
  }
  const rows: BackendWidgetQueueShop[] = [];
  if (data.current_processing) {
    const current = data.current_processing;
    rows.push({
      shop_name: current.shop_name,
      status: current.is_fetching_xml ? "fetching_xml" : "processing",
      processed: current.processed,
      total: current.total,
      queue_position: 0,
      estimated_minutes: current.remaining_minutes ?? 0,
      supplier_id: current.supplier_id,
      is_fetching_xml: Boolean(current.is_fetching_xml),
    });
  }
  for (const item of data.waiting_list || []) {
    rows.push({
      shop_name: item.shop_name,
      status: item.is_fetching_xml ? "fetching_xml" : "waiting",
      processed: item.processed ?? 0,
      total: item.total ?? 0,
      queue_position: item.queue_position,
      estimated_minutes: item.estimated_minutes ?? item.remaining_minutes ?? 0,
      supplier_id: item.supplier_id,
      is_fetching_xml: Boolean(item.is_fetching_xml),
    });
  }
  return rows;
}

function ShopQueueRows({ queueData }: { queueData: BackendWidgetQueueShop[] }) {
  return (
    <>
      {queueData.map((shop, index) => {
        const isProcessing = shop.queue_position === 0 && !shop.is_fetching_xml;
        const isFetching = Boolean(shop.is_fetching_xml);

        let topText = "";
        if (isFetching) {
          topText = `Завантаження XML: ${shop.shop_name}... (В черзі #${shop.queue_position})`;
        } else if (isProcessing) {
          topText = `AI-обробка: ${shop.shop_name}... Завантажено ${shop.processed} з ${shop.total}`;
        } else {
          topText = `Очікування: ${shop.shop_name} (В черзі #${shop.queue_position})`;
        }

        const percentage = shop.total > 0 ? (shop.processed / shop.total) * 100 : 0;

        return (
          <div
            key={shop.supplier_id || shop.shop_name}
            className={`flex flex-col gap-2 ${index > 0 ? "pt-3 border-t border-white/10" : ""}`}
          >
            <div className="flex items-start gap-2">
              <Loader2 className="w-4 h-4 text-emerald-500 animate-spin shrink-0 mt-0.5" />
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium text-slate-200 leading-tight truncate block">{topText}</span>
                <span className="text-[10px] text-slate-400 mt-1 truncate block">
                  Орієнтовний час: ~{shop.estimated_minutes} хв
                </span>
              </div>
            </div>
            {isProcessing && (
              <div className="h-1.5 w-full bg-slate-700/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export function SupplierImportProgress() {
  const { effectiveRole, profile } = useTelegramAuthContext();
  const isAdmin = effectiveRole === "admin" || effectiveRole === "owner";
  const enabled =
    effectiveRole === "supplier" || isAdmin;
  const [queueData, setQueueData] = useState<BackendWidgetQueueShop[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        let next: BackendWidgetQueueShop[] = [];
        if (isAdmin) {
          const telegramId =
            profile?.telegram_id ||
            (typeof window !== "undefined"
              ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id
              : undefined);
          const data = await fetchAdminAiQueue(telegramId ? Number(telegramId) : undefined);
          next = shopsFromAdminQueue(data);
        } else {
          const data = await fetchSupplierImportProgress();
          next = Array.isArray(data) ? data.filter(Boolean) : [];
        }
        if (cancelled) return;
        setQueueData(next);
      } catch (error) {
        if (cancelled) return;
        const status = error instanceof BackendApiError ? error.status : undefined;
        if (status === 401 || status === 403 || status === 404) {
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
  }, [enabled, isAdmin, profile?.telegram_id]);

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
        className={`pointer-events-auto relative ml-2 bg-[#1c1c1e]/85 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.5)] flex flex-col gap-3 overflow-hidden transition-all duration-500 ease-in-out origin-left ${isCollapsed ? "w-0 opacity-0 scale-x-0 p-0 border-0" : "w-[240px] opacity-100 scale-x-100 p-3"}`}
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
