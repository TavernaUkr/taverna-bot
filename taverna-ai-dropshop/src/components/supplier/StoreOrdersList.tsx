import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  ChevronRight,
  Clock,
  Loader2,
  Package,
  RotateCcw,
  Sparkles,
  Truck,
  User,
  XCircle,
  CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { hapticNotification, hapticSelection } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BackendApiError,
  type BackendSupplierOrder,
  type BackendSupplierOrderItem,
  type BackendOrderStatus,
  getSupplierOrders,
  updateOrderStatus,
} from "@/lib/backendApi";

/**
 * B2B Хаб Замовлень: вкладка «Замовлення» (StoreOrdersHub).
 *
 * Список замовлень магазину з бекенду (GET /api/v1/orders/supplier/{id}) +
 * зміна статусу менеджером (PATCH /api/v1/orders/{id}/status) + розділ
 * «Історія замовлень» (завершені/скасовані/обміняні — внизу, як посилання).
 */

// --- Статуси ----------------------------------------------------------------

const STATUS_META: Record<string, { label: string; className: string; icon: typeof Package }> = {
  new: { label: "Нове", className: "bg-primary/10 text-primary", icon: Sparkles },
  pending: { label: "Очікує", className: "bg-yellow-500/10 text-yellow-600", icon: Clock },
  confirmed: { label: "Підтверджено", className: "bg-sky-500/10 text-sky-600", icon: CheckCircle2 },
  processing: { label: "В обробці", className: "bg-blue-500/10 text-blue-600", icon: Package },
  shipped: { label: "Відправлено", className: "bg-purple-500/10 text-purple-600", icon: Truck },
  delivered: { label: "Доставлено", className: "bg-emerald-500/10 text-emerald-600", icon: CheckCircle2 },
  cancelled: { label: "Скасовано", className: "bg-red-500/10 text-red-600", icon: XCircle },
  returned: { label: "Повернення", className: "bg-rose-500/10 text-rose-600", icon: RotateCcw },
};

const statusMeta = (status: string) => STATUS_META[status] ?? { label: status, className: "bg-muted text-muted-foreground", icon: Package };

/** Статуси «в роботі» — показуємо у верхньому списку. */
const ACTIVE_STATUSES: BackendOrderStatus[] = ["new", "pending", "confirmed", "processing", "shipped", "delivered"];

/** Статуси архіву: завершені (delivered через 14 днів), скасовані, повернення. */
const HISTORY_STATUSES: BackendOrderStatus[] = ["cancelled", "returned", "delivered"];

const ARCHIVE_DELIVERED_DAYS = 14;

function isDeliveredOld(order: BackendSupplierOrder): boolean {
  if (order.status !== "delivered") return false;
  const ts = order.updated_at || order.created_at;
  if (!ts) return false;
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000);
  return days >= ARCHIVE_DELIVERED_DAYS;
}

// --- Утиліти ----------------------------------------------------------------

function formatOrderDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "d MMM, HH:mm", { locale: uk });
  } catch {
    return "—";
  }
}

function formatMoney(value?: number | null): string {
  return `${(value ?? 0).toLocaleString("uk-UA")} ₴`;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Готівка",
  card: "Картка",
  cod: "Наложений платіж",
  full_prepayment: "Повна передоплата",
};

function paymentLabel(p?: string | null): string | null {
  if (!p) return null;
  return PAYMENT_LABELS[p] ?? p;
}

// --- Картка замовлення ------------------------------------------------------

function OrderItemsBlock({ items }: { items: BackendSupplierOrderItem[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2.5 space-y-1.5">
      {items.map((item) => (
        <div key={item.id} className="flex items-start gap-2 text-xs text-muted-foreground">
          <Package className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground/60" />
          <span className="min-w-0 flex-1">
            <span className="text-foreground/90">{item.product_name}</span>
            {item.options_text ? ` · ${item.options_text}` : ""}
          </span>
          <span className="shrink-0 whitespace-nowrap">
            {item.quantity} × {item.price_per_item.toLocaleString("uk-UA")} ₴
          </span>
        </div>
      ))}
    </div>
  );
}

function OrderCard({
  order,
  isUpdating = false,
  onStatusChange,
}: {
  order: BackendSupplierOrder;
  isUpdating?: boolean;
  onStatusChange: (order: BackendSupplierOrder, next: BackendOrderStatus) => void;
}) {
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const meta = statusMeta(order.status);
  const StatusIcon = meta.icon;

  const handleChange = (next: string) => {
    setIsSelectOpen(false);
    if (next === order.status) return;
    hapticSelection();
    onStatusChange(order, next as BackendOrderStatus);
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        {/* Рядок 1: номер + статус */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm text-foreground truncate">
            {order.order_uid}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0",
              meta.className
            )}
          >
            <StatusIcon className="h-3 w-3" />
            {meta.label}
          </span>
        </div>

        {/* Рядок 2: клієнт + сума */}
        <div className="mt-2 flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-1.5 min-w-0">
            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="truncate text-muted-foreground">
              {order.customer_name || "Клієнт"}
            </span>
          </span>
          <span className="font-bold text-primary whitespace-nowrap">
            {formatMoney(order.total_price)}
          </span>
        </div>

        {/* Рядок 3: дата + оплата */}
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 min-w-0">
            <Clock className="h-3 w-3 shrink-0" />
            <span className="truncate">{formatOrderDate(order.created_at)}</span>
          </span>
          {paymentLabel(order.payment_type) && (
            <span className="shrink-0">{paymentLabel(order.payment_type)}</span>
          )}
        </div>

        <OrderItemsBlock items={order.items} />

        {/* Зміна статусу менеджером */}
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-3">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            {isUpdating && <Loader2 className="h-3 w-3 animate-spin" />}
            Змінити статус
          </span>
          <Select
            value={order.status}
            onValueChange={handleChange}
            open={isSelectOpen}
            onOpenChange={setIsSelectOpen}
            disabled={isUpdating}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
 <SelectContent>
              {(Object.keys(STATUS_META) as BackendOrderStatus[]).map((s) => {
                const m = statusMeta(s);
                const SIcon = m.icon;
                return (
                  <SelectItem key={s} value={s} className="text-xs">
                    <span className="flex items-center gap-1.5">
                      <SIcon className="h-3.5 w-3.5" />
                      {m.label}
                    </span>
                  </SelectItem>
                  );
              })}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Компонент --------------------------------------------------------------

export function StoreOrdersList({ supplierId }: { supplierId: number }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<BackendSupplierOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());

  const loadOrders = useCallback(async () => {
    try {
      const data = await getSupplierOrders(supplierId);
      setOrders(data);
      setLoadError(null);
    } catch (err) {
      console.error("Error loading supplier orders:", err);
      setLoadError(
        err instanceof Error ? err.message : "Не вдалося завантажити замовлення"
      );
    } finally {
      setIsLoading(false);
    }
  }, [supplierId]);

  useEffect(() => {
    setIsLoading(true);
    void loadOrders();
  }, [loadOrders]);

  const handleStatusChange = useCallback(
    async (order: BackendSupplierOrder, next: BackendOrderStatus) => {
      const optimisticId = order.id;
      // Оптимістичний апдейт: одразу показуємо новий статус
      setOrders((prev) =>
        prev.map((o) => (o.id === optimisticId ? { ...o, status: next } : o))
      );
      setUpdatingIds((prev) => new Set(prev).add(order.id));
      try {
        const updated = await updateOrderStatus(order.id, next);
        setOrders((prev) =>
          prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o))
        );
        hapticNotification("success");
        toast.success(`Статус змінено → ${statusMeta(next).label}`);
      } catch (err) {
        console.error("Error updating order status:", err);
        // Відкат оптимістичного апдейту
        await loadOrders();
        hapticNotification("error");
        toast.error(
          err instanceof BackendApiError
            ? err.message
            : "Не вдалося змінити статус замовлення"
        );
      } finally {
        setUpdatingIds((prev) => {
          const copy = new Set(prev);
          copy.delete(order.id);
          return copy;
        });
      }
    },
    [loadOrders]
  );

  const activeOrders = useMemo(
    () => orders.filter((o) => ACTIVE_STATUSES.includes(o.status as BackendOrderStatus) && !isDeliveredOld(o)),
    [orders]
  );

  const historyOrders = useMemo(
    () => orders.filter((o) => HISTORY_STATUSES.includes(o.status as BackendOrderStatus) && (o.status !== "delivered" || isDeliveredOld(o))),
    [orders]
  );

  const newCount = useMemo(
    () => orders.filter((o) => o.status === "new").length,
    [orders]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-4 space-y-3 text-center">
        <AlertTriangle className="h-8 w-8 mx-auto text-warning" />
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => void loadOrders()}>
          Спробувати ще
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Заголовок списку */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          Замовлення
        </h3>
        <div className="flex items-center gap-2">
          {newCount > 0 && (
            <Badge variant="default" className="text-[10px]">
              Нових: {newCount}
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {activeOrders.length}
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => void loadOrders()}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Активні замовлення */}
      {activeOrders.length === 0 ? (
        <EmptyState
          type="inbox"
          title="Активних замовлень немає"
          description="Нові замовлення з кошика з'являться тут автоматично"
        />
      ) : (
        <div className="space-y-3">
          {activeOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              isUpdating={updatingIds.has(order.id)}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}

      {/* Історія замовлень (веб-посилання) */}
      <button
        type="button"
        onClick={() => {
          hapticSelection();
          navigate(`/store-orders-history/${supplierId}`);
        }}
        className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all bg-card border-border hover:border-muted-foreground/50"
      >
        <div className="w-10 h-10 rounded-full flex items-center justify-center bg-muted shrink-0">
          <Archive className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1 text-left min-w-0">
          <h4 className="font-medium text-foreground">Історія замовлень</h4>
          <p className="text-xs text-muted-foreground">Завершені, скасовані, обміняні</p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </button>

      {/* Кількість оброблених замовлень (службова стрічка) */}
      <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
        <span>
          Активних: {activeOrders.length} · В архіві: {historyOrders.length}
        </span>
      </div>
    </div>
  );
}

export default StoreOrdersList;
