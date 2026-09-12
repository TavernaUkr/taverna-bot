import { useEffect, useMemo, useState } from "react";
import { CreditCard, Loader2, RotateCcw, ShieldCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { isPreviewDevEnvironment } from "@/lib/dev-preview";
import { hapticNotification } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const REASONS = [
  "Не підійшов розмір",
  "Товар не відповідає опису",
  "Пошкоджено при доставці",
  "Виявлено дефект",
  "Передумав(ла)",
];

const FREE_RETURN_MIN = 1500;

interface RefundItem {
  id: string;
  product_name: string;
  quantity: number;
  total: number;
}

interface RefundRequestSheetProps {
  order: {
    id: string;
    order_number: string;
    total: number;
    delivery_cost: number;
    items: RefundItem[];
  };
  onClose: () => void;
  onSubmit: (payload: { order_id: string; item_ids: string[]; reason: string; comment?: string }) => Promise<unknown>;
  onOpenRefundSettings?: () => void;
}

/** Форма заявки на повернення з прив'язкою до «Картки для повернень». */
export function RefundRequestSheet({ order, onClose, onSubmit, onOpenRefundSettings }: RefundRequestSheetProps) {
  const { sessionToken } = useTelegramAuthContext() as any;
  const [method, setMethod] = useState<{ masked_value: string; holder: string | null } | null>(null);
  const [isLoadingMethod, setIsLoadingMethod] = useState(true);
  const [selected, setSelected] = useState<string[]>(order.items.map((i) => i.id));
  const [reason, setReason] = useState(REASONS[0]);
  const [comment, setComment] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!sessionToken) {
          if (isPreviewDevEnvironment()) setMethod({ masked_value: "**** 4242", holder: "IVAN PETRENKO" });
          return;
        }
        const { data } = await supabase.functions.invoke("wallet-account", {
          body: { action: "get_refund_method", session_token: sessionToken },
        });
        setMethod(data?.methods?.[0] || null);
      } catch {
        setMethod(null);
      } finally {
        setIsLoadingMethod(false);
      }
    })();
  }, [sessionToken]);

  const amount = useMemo(() => {
    const items = order.items.filter((i) => selected.includes(i.id));
    const sum = items.reduce((s, i) => s + Number(i.total || 0), 0);
    const isFull = items.length === order.items.length && items.length > 0;
    return sum + (isFull && order.total >= FREE_RETURN_MIN ? Number(order.delivery_cost || 0) : 0);
  }, [selected, order]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = async () => {
    if (selected.length === 0) return toast.error("Оберіть товари для повернення");
    if (!method) return toast.error("Спочатку додайте картку для повернень");
    setIsSaving(true);
    try {
      await onSubmit({ order_id: order.id, item_ids: selected, reason, comment: comment.trim() || undefined });
      hapticNotification("success");
      toast.success("Заявку на повернення створено");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не вдалося створити заявку");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 animate-fade-in" onClick={onClose}>
      <div
        className="absolute inset-x-0 bottom-0 bg-background rounded-t-3xl max-h-[92vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-bold text-lg text-foreground flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-rose-500" />
            Повернення замовлення
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-xs text-muted-foreground">Замовлення {order.order_number}</p>

          {/* Куди повертаємо кошти */}
          {isLoadingMethod ? (
            <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : method ? (
            <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
                <CreditCard className="h-5 w-5 text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Кошти повернемо на</p>
                <p className="font-medium text-foreground">{method.masked_value}</p>
                <p className="text-xs text-muted-foreground truncate">{method.holder || "Без імені"}</p>
              </div>
              <ShieldCheck className="h-4 w-4 text-success" />
            </div>
          ) : (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-foreground">
                  Щоб оформити повернення, додайте «Картку для повернень» у налаштуваннях профілю.
                </p>
              </div>
              {onOpenRefundSettings && (
                <Button variant="outline" className="w-full" onClick={onOpenRefundSettings}>
                  Додати картку
                </Button>
              )}
            </div>
          )}

          {/* Товари */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Що повертаємо</Label>
            {order.items.map((item) => (
              <button
                key={item.id}
                onClick={() => toggle(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                  selected.includes(item.id) ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <Checkbox checked={selected.includes(item.id)} className="pointer-events-none" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{item.product_name}</p>
                  <p className="text-xs text-muted-foreground">{item.quantity} шт · {Number(item.total).toLocaleString()} ₴</p>
                </div>
              </button>
            ))}
          </div>

          {/* Причина */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Причина</Label>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs border transition-colors",
                    reason === r ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Коментар (необов'язково)</Label>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={1000} />
          </div>

          <div className="rounded-xl bg-muted/50 border border-border p-4 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Сума до повернення</span>
              <span className="font-bold text-foreground">{amount.toLocaleString()} ₴</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Остаточну суму підтверджує модератор. Доставка повертається, якщо повертається все замовлення на суму від {FREE_RETURN_MIN} ₴.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-border">
          <Button className="w-full h-12" onClick={submit} disabled={isSaving || !method}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Надіслати заявку"}
          </Button>
        </div>
      </div>
    </div>
  );
}
