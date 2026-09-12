import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, CheckCircle2, Clock, Hourglass, CreditCard, Banknote } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  supplierId: string;
  previewRole?: string | null;
}

interface Payment {
  id: string;
  order_number: string;
  payment_method: string | null;
  status: "created" | "partial" | "paid";
  created_at: string;
  paid_at: string | null;
}

const STATUS_META: Record<Payment["status"], { label: string; icon: any; cls: string }> = {
  created: { label: "Створено", icon: Clock, cls: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  partial: { label: "Часткова оплата", icon: Hourglass, cls: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  paid: { label: "Оплачено", icon: CheckCircle2, cls: "bg-green-500/10 text-green-600 border-green-500/20" },
};

export function ShopPaymentsView({ supplierId, previewRole }: Props) {
  const { sessionToken } = useTelegramAuthContext();
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<Payment[]>([]);

  const load = useCallback(async () => {
    if (!sessionToken || !supplierId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("bank-gateway", {
        body: { action: "list_shop_payments", session_token: sessionToken, supplier_id: supplierId, preview_role: previewRole || undefined },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPayments(data?.payments || []);
    } catch (e: any) {
      toast.error("Не вдалося завантажити оплати");
    } finally {
      setLoading(false);
    }
  }, [sessionToken, supplierId, previewRole]);

  useEffect(() => { load(); }, [load]);

  const counts = payments.reduce(
    (acc, p) => { acc[p.status] += 1; return acc; },
    { created: 0, partial: 0, paid: 0 } as Record<Payment["status"], number>
  );

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
        Режим менеджера — ви бачите статуси оплат замовлень (чи надійшли кошти), без доступу до балансу та виплат постачальника.
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(["created", "partial", "paid"] as const).map((s) => {
          const M = STATUS_META[s];
          return (
            <Card key={s} className={cn("border", M.cls)}>
              <CardContent className="p-3 text-center">
                <M.icon className="h-4 w-4 mx-auto mb-1" />
                <p className="text-lg font-bold">{counts[s]}</p>
                <p className="text-[10px] leading-tight">{M.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-sm">Оплати замовлень</p>
            <Button variant="ghost" size="icon" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : payments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Поки немає замовлень</p>
          ) : (
            <ScrollArea className="h-80 pr-3">
              <div className="space-y-2">
                {payments.map((p) => {
                  const M = STATUS_META[p.status];
                  const isCod = p.payment_method === "cash_on_delivery";
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.order_number}</p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                          {isCod ? <Banknote className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}
                          {isCod ? "Наложений" : "Передоплата"} · {new Date(p.created_at).toLocaleDateString("uk-UA")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={cn("gap-1 text-[10px]", M.cls)}>
                          <M.icon className="h-3 w-3" /> {M.label}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
