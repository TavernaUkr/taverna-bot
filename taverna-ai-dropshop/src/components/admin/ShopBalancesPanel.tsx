import { useState, useEffect, useCallback } from "react";
import {
  Wallet, Loader2, RefreshCw, Banknote, Store, Zap, FlaskConical,
  PlayCircle, CreditCard, ShieldCheck, ChevronDown, TrendingUp, TrendingDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  mode: "admin" | "moderator";
}

const TYPE_LABEL: Record<string, string> = {
  payout_accrual: "Нарахування",
  markup_debit: "Націнка (наложений)",
  withdrawal: "Вивід",
  card_charge: "Списання з картки",
  refund_adjust: "Повернення",
  penalty: "Штраф",
};

export function ShopBalancesPanel({ mode }: Props) {
  const { sessionToken } = useTelegramAuthContext();
  const isAdmin = mode === "admin";
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [providers, setProviders] = useState<{ monobank: string; liqpay: string }>({ monobank: "sandbox", liqpay: "sandbox" });
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [movements, setMovements] = useState<Record<string, any[]>>({});

  const load = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("bank-gateway", {
        body: { action: "list_balances", session_token: sessionToken },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setRows(data?.rows || []);
      setProviders(data?.providers || { monobank: "sandbox", liqpay: "sandbox" });
    } catch (e: any) {
      toast.error("Помилка завантаження балансів");
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  const loadMovements = async (supplierId: string) => {
    if (movements[supplierId]) return;
    const { data } = await supabase.functions.invoke("bank-gateway", {
      body: { action: "list_movements", session_token: sessionToken, supplier_id: supplierId },
    });
    setMovements((p) => ({ ...p, [supplierId]: data?.movements || [] }));
  };

  const act = async (key: string, body: Record<string, any>, msg?: string) => {
    setBusy(key);
    try {
      const { data, error } = await supabase.functions.invoke("bank-gateway", {
        body: { session_token: sessionToken, ...body },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (msg) toast.success(msg);
      setMovements({});
      await load();
      return data;
    } catch (e: any) {
      toast.error(e.message || "Помилка");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const seed = async () => {
    setBusy("seed");
    try {
      const { data, error } = await supabase.functions.invoke("seed-test-payments", {
        body: { session_token: sessionToken, mode: "seed" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Оновлено тестові оплати: ${data?.created || 0} замовлень, ${data?.shops || 0} магазинів`);
      setMovements({});
      await load();
    } catch (e: any) {
      toast.error(e.message || "Помилка генерації");
    } finally {
      setBusy(null);
    }
  };

  const totalAvailable = rows.reduce((s, r) => s + Number(r.available || 0), 0);

  return (
    <div className="space-y-4">
      {/* Header / controls */}
      <Card className="border-primary/20">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">До виплати всього</p>
                <p className="text-xl font-bold">{totalAvailable.toLocaleString("uk-UA")} ₴</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1">
                Mono: <span className={providers.monobank === "live" ? "text-green-600" : "text-yellow-600"}>{providers.monobank}</span>
              </Badge>
              <Badge variant="outline" className="gap-1">
                LiqPay: <span className={providers.liqpay === "live" ? "text-green-600" : "text-yellow-600"}>{providers.liqpay}</span>
              </Badge>
              <Button variant="ghost" size="icon" onClick={load}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
            </div>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => act("accruals", { action: "run_accruals" }, "Нарахування виконано")} disabled={!!busy}>
                {busy === "accruals" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Нарахувати
              </Button>
              <Button size="sm" variant="outline" onClick={() => act("auto", { action: "run_auto_withdrawals" }, "Авто-виводи виконано")} disabled={!!busy}>
                {busy === "auto" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Авто-вивід
              </Button>
              <Button size="sm" variant="secondary" onClick={seed} disabled={!!busy}>
                {busy === "seed" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Тест-дані
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : rows.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">Немає магазинів</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Collapsible key={r.supplier_id} open={openId === r.supplier_id}
              onOpenChange={(o) => { setOpenId(o ? r.supplier_id : null); if (o) loadMovements(r.supplier_id); }}>
              <Card>
                <CardContent className="p-4">
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Store className="h-4 w-4 text-primary shrink-0" />
                        <div className="text-left min-w-0">
                          <p className="font-semibold text-sm truncate">{r.shop_name}</p>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            {r.method?.masked_pan && <span className="font-mono">{r.method.masked_pan}</span>}
                            {r.method?.auto_withdraw && <Badge variant="outline" className="h-4 px-1 text-[9px]">авто-вивід</Badge>}
                            {r.method?.auto_charge && <Badge variant="outline" className="h-4 px-1 text-[9px]">авто-списання</Badge>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <p className="font-bold text-sm">{Number(r.available).toLocaleString("uk-UA")} ₴</p>
                          <p className="text-[10px] text-muted-foreground">виплачено {Number(r.lifetime_paid).toLocaleString("uk-UA")} ₴</p>
                        </div>
                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", openId === r.supplier_id && "rotate-180")} />
                      </div>
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="pt-3 mt-3 border-t">
                    {isAdmin && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        <Button size="sm" variant="outline" disabled={!!busy || Number(r.available) <= 0}
                          onClick={() => act(`pay-${r.supplier_id}`, { action: "admin_payout", supplier_id: r.supplier_id }, "Виплату виконано")}>
                          <Banknote className="h-3.5 w-3.5" /> Виплатити зараз
                        </Button>
                      </div>
                    )}
                    {(movements[r.supplier_id]?.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">Немає рухів</p>
                    ) : (
                      <ScrollArea className="h-56 pr-2">
                        <div className="space-y-1.5">
                          {(movements[r.supplier_id] || []).map((m) => {
                            const positive = Number(m.amount) >= 0;
                            return (
                              <div key={m.id} className="flex items-center justify-between gap-2 text-xs py-1.5 border-b border-border/40 last:border-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  {positive ? <TrendingUp className="h-3.5 w-3.5 text-green-600 shrink-0" /> : <TrendingDown className="h-3.5 w-3.5 text-red-600 shrink-0" />}
                                  <span className="truncate">{TYPE_LABEL[m.type] || m.type}</span>
                                </div>
                                <span className={cn("font-semibold shrink-0", positive ? "text-green-600" : "text-red-600")}>
                                  {positive ? "+" : ""}{Number(m.amount).toLocaleString("uk-UA")} ₴
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    )}
                  </CollapsibleContent>
                </CardContent>
              </Card>
            </Collapsible>
          ))}
        </div>
      )}
    </div>
  );
}
