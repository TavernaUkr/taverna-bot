import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2, RefreshCw, TrendingUp, Wallet, Clock, Banknote, Store,
  BarChart3, Landmark, Crown, ArrowRight, ShoppingBag, PiggyBank,
  TrendingDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Period = "day" | "week" | "month" | "year";
const periodLabels: Record<Period, string> = { day: "День", week: "Тиждень", month: "Місяць", year: "Рік" };
const fmt = (n: number) => Number(n || 0).toLocaleString("uk-UA");

const TYPE_LABEL: Record<string, string> = {
  payout_accrual: "Нарахування",
  markup_debit: "Націнка (наложений)",
  withdrawal: "Вивід постачальнику",
  card_charge: "Списання з картки",
  refund_adjust: "Повернення",
  penalty: "Штраф",
};

export function TavernaGroupPanel() {
  const navigate = useNavigate();
  const { sessionToken } = useTelegramAuthContext();
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<any>(null);
  const [shops, setShops] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [subAccounts, setSubAccounts] = useState<any[]>([]);
  const [series, setSeries] = useState<Record<Period, any[]>>({ day: [], week: [], month: [], year: [] });
  const [providers, setProviders] = useState<{ monobank: string; liqpay: string }>({ monobank: "sandbox", liqpay: "sandbox" });
  const [period, setPeriod] = useState<Period>("month");

  const load = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("bank-gateway", {
        body: { action: "group_earnings", session_token: sessionToken },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setGroup(data?.group || null);
      setShops(data?.shops || []);
      setLedger(data?.ledger || []);
      setSubAccounts(data?.subAccounts || []);
      setSeries(data?.series || { day: [], week: [], month: [], year: [] });
      setProviders(data?.providers || { monobank: "sandbox", liqpay: "sandbox" });
    } catch (e: any) {
      toast.error("Не вдалося завантажити дані Taverna Group");
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  const points = series[period] || [];
  const maxVal = Math.max(1, ...points.map((p) => p.turnover));

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-amber-500/10 via-primary/5 to-emerald-500/10">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-primary/15 flex items-center justify-center">
                <Landmark className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Казначейство групи</p>
                <p className="text-xl font-bold">Taverna Group</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 text-[10px]">
                Mono: <span className={providers.monobank === "live" ? "text-green-600" : "text-yellow-600"}>{providers.monobank}</span>
              </Badge>
              <Button variant="ghost" size="icon" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-xs text-muted-foreground">Наш заробіток (націнка)</p>
            <p className="text-3xl font-bold text-foreground">{fmt(group?.earned)} ₴</p>
            <p className="text-xs text-muted-foreground mt-1">
              Оборот {fmt(group?.turnover)} ₴ · {fmt(group?.ordersCount)} замовлень · {fmt(group?.shopsCount)} магазинів
              {group?.myShopsCount ? ` · ${fmt(group.myShopsCount)} моїх` : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><TrendingUp className="h-3.5 w-3.5 text-blue-500" /> Оборот</div>
          <p className="text-lg font-bold">{fmt(group?.turnover)} ₴</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><Wallet className="h-3.5 w-3.5 text-green-600" /> Заробіток</div>
          <p className="text-lg font-bold">{fmt(group?.earned)} ₴</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><Clock className="h-3.5 w-3.5 text-amber-500" /> В обробці</div>
          <p className="text-lg font-bold">{fmt(group?.processing)} ₴</p>
          <p className="text-[11px] text-muted-foreground">створено {fmt(group?.created)} ₴</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><Banknote className="h-3.5 w-3.5 text-primary" /> Виплачено</div>
          <p className="text-lg font-bold">{fmt(group?.paidToSuppliers)} ₴</p>
        </CardContent></Card>
      </div>

      {/* Period breakdown */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Розбивка по періодам</span>
          </div>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList className="grid grid-cols-4 w-full h-9">
              {(["day", "week", "month", "year"] as Period[]).map((p) => (
                <TabsTrigger key={p} value={p} className="text-xs">{periodLabels[p]}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="space-y-1.5">
            {points.every((p) => p.turnover === 0) ? (
              <p className="text-center text-sm text-muted-foreground py-6">Немає даних за цей період</p>
            ) : (
              points.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground w-20 shrink-0">{p.label}</span>
                  <div className="flex-1 mx-2 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(p.turnover / maxVal) * 100}%` }} />
                  </div>
                  <span className="font-semibold text-foreground w-24 text-right">{fmt(p.turnover)} ₴</span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* MonoBank sub-accounts */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <PiggyBank className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Суб-рахунки ФОП (MonoBank)</span>
          <Badge variant="outline" className={cn("text-[10px] ml-auto", providers.monobank === "live" ? "text-green-600" : "text-yellow-600")}>
            {providers.monobank}
          </Badge>
        </div>
        {subAccounts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Немає суб-рахунків. Додайте MONOBANK_TOKEN для реальних даних.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {subAccounts.map((a) => (
              <Card key={a.id}><CardContent className="p-4">
                <p className="text-[11px] text-muted-foreground truncate">{a.name}</p>
                <p className="text-base font-bold">{fmt(a.balance)} {a.currency}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] font-mono text-muted-foreground">{a.iban}</span>
                  <Badge variant="secondary" className="text-[9px] h-4 px-1">{a.type}</Badge>
                </div>
              </CardContent></Card>
            ))}
          </div>
        )}
      </div>

      {/* Per-shop breakdown */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">По магазинах</span>
        </div>
        {shops.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Немає магазинів</p>
        ) : shops.map((s) => (
          <Card key={s.supplier_id} className="cursor-pointer hover:border-primary/40 transition-colors"
            onClick={() => navigate(`/wallet/${s.supplier_id}`)}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={s.logo_url || undefined} alt={s.shop_name} />
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">{s.shop_name?.charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-sm truncate">{s.shop_name}</p>
                    {s.is_mine && <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{fmt(s.ordersCount)} замовлень · оборот {fmt(s.turnover)} ₴</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-green-600">{fmt(s.earned)} ₴</p>
                  <p className="text-[10px] text-muted-foreground">заробіток</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
              <div className="flex items-center gap-2 mt-2 text-[10px]">
                <Badge variant="outline" className="h-4 px-1">створено {fmt(s.created)}₴</Badge>
                <Badge variant="outline" className="h-4 px-1 text-amber-600">обробка {fmt(s.processing)}₴</Badge>
                <Badge variant="outline" className="h-4 px-1 text-green-600">виплачено {fmt(s.paid)}₴</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Treasury ledger */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShoppingBag className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Журнал казначейства</span>
          </div>
          {ledger.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Немає рухів</p>
          ) : (
            <ScrollArea className="h-72 pr-2">
              <div className="space-y-1.5">
                {ledger.map((m) => {
                  const positive = Number(m.amount) >= 0;
                  return (
                    <div key={m.id} className="flex items-center justify-between gap-2 text-xs py-1.5 border-b border-border/40 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {positive ? <TrendingUp className="h-3.5 w-3.5 text-green-600 shrink-0" /> : <TrendingDown className="h-3.5 w-3.5 text-red-600 shrink-0" />}
                        <div className="min-w-0">
                          <p className="truncate">{TYPE_LABEL[m.type] || m.type}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{m.shop_name} · {new Date(m.created_at).toLocaleDateString("uk-UA")}</p>
                        </div>
                      </div>
                      <span className={cn("font-semibold shrink-0", positive ? "text-green-600" : "text-red-600")}>
                        {positive ? "+" : ""}{fmt(m.amount)} ₴
                      </span>
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
