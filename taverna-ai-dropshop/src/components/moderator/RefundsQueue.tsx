import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Loader2, Check, X, CreditCard, Store, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { isPreviewDevEnvironment } from "@/lib/dev-preview";
import { DEMO_REFUNDS } from "@/hooks/useOrderRefunds";
import { hapticNotification } from "@/lib/haptics";
import { toast } from "sonner";

interface RefundRow {
  id: string;
  order_id: string;
  amount: number;
  bonus_amount: number;
  reason: string;
  comment: string | null;
  status: string;
  rejection_reason: string | null;
  refund_target: string | null;
  transaction_id: string | null;
  created_at: string;
  order?: { order_number: string; total: number } | null;
  supplier?: { shop_name: string } | null;
}

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "destructive" | "outline" | "secondary" }> = {
  requested: { label: "Нова заявка", variant: "destructive" },
  approved: { label: "Схвалено", variant: "default" },
  paid: { label: "Виплачено", variant: "secondary" },
  rejected: { label: "Відхилено", variant: "outline" },
};

/** Черга заявок на повернення для модератора/адміна. */
export function RefundsQueue() {
  const { sessionToken } = useTelegramAuthContext() as any;
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rejecting, setRejecting] = useState<RefundRow | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const demoRows = (): RefundRow[] =>
    DEMO_REFUNDS.map((r) => ({
      ...r,
      order: { order_number: `TAV-DEMO-${r.order_id.slice(-3)}`, total: r.amount },
      supplier: { shop_name: "Demo Shop" },
    }));

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!sessionToken) {
        setRefunds(isPreviewDevEnvironment() ? demoRows() : []);
        return;
      }
      const { data, error } = await supabase.functions.invoke("order-refunds", {
        body: { action: "list_pending", session_token: sessionToken },
      });
      if (error || data?.error) throw new Error(data?.error || "error");
      const rows: RefundRow[] = (data?.refunds || []).map((r: any) => ({
        ...r, amount: Number(r.amount), bonus_amount: Number(r.bonus_amount || 0),
      }));
      setRefunds(rows.length === 0 && isPreviewDevEnvironment() ? demoRows() : rows);
    } catch {
      setRefunds(isPreviewDevEnvironment() ? demoRows() : []);
    } finally {
      setIsLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (refund: RefundRow, status: "approved" | "paid" | "rejected", rejection_reason?: string) => {
    setBusyId(refund.id);
    try {
      if (!sessionToken && isPreviewDevEnvironment()) {
        setRefunds((prev) => prev.map((r) => (r.id === refund.id
          ? { ...r, status, rejection_reason: rejection_reason || null, transaction_id: status === "paid" ? "RFND-DEMO" : r.transaction_id }
          : r)));
      } else {
        const { data, error } = await supabase.functions.invoke("order-refunds", {
          body: { action: "set_status", session_token: sessionToken, refund_id: refund.id, status, rejection_reason },
        });
        if (error || data?.error) throw new Error(data?.error || "error");
        await load();
      }
      hapticNotification("success");
      toast.success(status === "paid" ? "Кошти позначено як виплачені" : status === "approved" ? "Заявку схвалено" : "Заявку відхилено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не вдалося оновити заявку");
    } finally {
      setBusyId(null);
      setRejecting(null);
      setReason("");
    }
  };

  const active = refunds.filter((r) => r.status === "requested" || r.status === "approved").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <RotateCcw className="h-5 w-5 text-rose-500" />
          Повернення коштів
        </h3>
        <Badge variant={active > 0 ? "destructive" : "outline"}>{active} в роботі</Badge>
      </div>

      <ScrollArea className="h-[350px]">
        <div className="space-y-3 pr-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : refunds.length === 0 ? (
            <div className="text-center py-12">
              <RotateCcw className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Немає заявок на повернення</p>
            </div>
          ) : (
            refunds.map((r) => {
              const st = STATUS_LABEL[r.status] || STATUS_LABEL.requested;
              return (
                <Card key={r.id}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{r.reason}</span>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2 min-w-0">
                        <Package className="h-4 w-4 shrink-0" />
                        <span className="truncate">{r.order?.order_number || "Замовлення"}</span>
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        <Store className="h-4 w-4 shrink-0" />
                        <span className="truncate">{r.supplier?.shop_name || "—"}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg bg-muted/50 p-2.5">
                      <div className="flex items-center gap-2 text-sm min-w-0">
                        <CreditCard className="h-4 w-4 text-success shrink-0" />
                        <span className="truncate">{r.refund_target || "Реквізити не вказано"}</span>
                      </div>
                      <span className="font-bold">{r.amount.toLocaleString()} ₴</span>
                    </div>

                    {r.comment && <p className="text-xs text-muted-foreground">{r.comment}</p>}
                    {r.rejection_reason && <p className="text-xs text-destructive">Причина відмови: {r.rejection_reason}</p>}
                    {r.transaction_id && <p className="text-xs text-muted-foreground">Транзакція: {r.transaction_id}</p>}

                    {(r.status === "requested" || r.status === "approved") && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline" size="sm" className="flex-1"
                          disabled={busyId === r.id}
                          onClick={() => setRejecting(r)}
                        >
                          <X className="h-4 w-4 mr-1" /> Відхилити
                        </Button>
                        <Button
                          size="sm" className="flex-1"
                          disabled={busyId === r.id}
                          onClick={() => setStatus(r, r.status === "requested" ? "approved" : "paid")}
                        >
                          {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                          {r.status === "requested" ? "Схвалити" : "Позначити виплаченим"}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>

      <Dialog open={!!rejecting} onOpenChange={() => setRejecting(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Відхилити повернення</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Причина відмови</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Поясніть клієнту рішення..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Скасувати</Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || !!busyId}
              onClick={() => rejecting && setStatus(rejecting, "rejected", reason.trim())}
            >
              Відхилити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
