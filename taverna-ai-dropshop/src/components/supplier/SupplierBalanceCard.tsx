import { useState, useEffect, useCallback } from "react";
import {
  Wallet, Loader2, ArrowDownToLine, CreditCard, RefreshCw,
  TrendingUp, TrendingDown, Banknote, ShieldCheck, Zap,
  CheckCircle2, Clock, ReceiptText, Send,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  supplierId: string;
  /** Force read-only (managers). When omitted, derived from server access level. */
  readOnly?: boolean;
  /** Dev role preview ("жук") — forwarded so admins can view as supplier/manager. */
  previewRole?: string | null;
}

const TYPE_META: Record<string, { label: string; positive: boolean }> = {
  payout_accrual: { label: "Нарахування за товар", positive: true },
  markup_debit: { label: "Наша націнка (наложений)", positive: false },
  withdrawal: { label: "Вивід коштів", positive: false },
  card_charge: { label: "Списання націнки з картки", positive: false },
  refund_adjust: { label: "Коригування повернення", positive: false },
  penalty: { label: "Штраф", positive: false },
};

interface PaymentRow {
  id: string;
  order_number: string;
  payment_method: string | null;
  status: "created" | "partial" | "paid";
  amount?: number | null;
  created_at: string;
}

interface PayoutRow {
  id: string;
  amount: number;
  payout_method: string | null;
  payout_status: string | null;
  transaction_id: string | null;
  scheduled_at: string | null;
  processed_at: string | null;
  created_at: string;
}

const PAYMENT_STATUS: Record<PaymentRow["status"], { label: string; cls: string }> = {
  created: { label: "Створено", cls: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  partial: { label: "Часткова", cls: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  paid: { label: "Оплачено", cls: "bg-green-500/10 text-green-600 border-green-500/20" },
};

export function SupplierBalanceCard({ supplierId, readOnly: readOnlyProp, previewRole }: Props) {
  const { sessionToken } = useTelegramAuthContext();
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<any>(null);
  const [method, setMethod] = useState<any>(null);
  const [providers, setProviders] = useState<{ monobank: string; liqpay: string; telegram_wallet?: string }>({ monobank: "sandbox", liqpay: "sandbox", telegram_wallet: "sandbox" });
  const [movements, setMovements] = useState<any[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [canManageServer, setCanManageServer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [minWithdraw, setMinWithdraw] = useState("");
  const [iban, setIban] = useState("");
  const [holderName, setHolderName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletCurrency, setWalletCurrency] = useState("USDT");

  const load = useCallback(async () => {
    if (!sessionToken || !supplierId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [bal, mv, pay, po] = await Promise.all([
        supabase.functions.invoke("bank-gateway", { body: { action: "get_balance", session_token: sessionToken, supplier_id: supplierId, preview_role: previewRole || undefined } }),
        supabase.functions.invoke("bank-gateway", { body: { action: "list_movements", session_token: sessionToken, supplier_id: supplierId, preview_role: previewRole || undefined } }),
        supabase.functions.invoke("bank-gateway", { body: { action: "list_shop_payments", session_token: sessionToken, supplier_id: supplierId, preview_role: previewRole || undefined } }),
        supabase.functions.invoke("bank-gateway", { body: { action: "list_payouts", session_token: sessionToken, supplier_id: supplierId, preview_role: previewRole || undefined } }),
      ]);
      if (bal.data?.error) throw new Error(bal.data.error);
      if (mv.data?.error) throw new Error(mv.data.error);
      if (pay.data?.error) throw new Error(pay.data.error);
      if (po.data?.error) throw new Error(po.data.error);
      setBalance(bal.data?.balance || null);
      setMethod(bal.data?.method || null);
      setMinWithdraw(bal.data?.method?.min_withdraw != null ? String(bal.data.method.min_withdraw) : "");
      setIban(bal.data?.method?.iban || "");
      setHolderName(bal.data?.method?.holder || "");
      setWalletAddress(bal.data?.method?.wallet_address || "");
      setWalletCurrency(bal.data?.method?.wallet_currency || "USDT");
      setCanManageServer(bal.data?.canManage !== false);
      setProviders(bal.data?.providers || { monobank: "sandbox", liqpay: "sandbox", telegram_wallet: "sandbox" });
      setMovements(mv.data?.movements || []);
      setPayments(pay.data?.payments || []);
      setPayouts(po.data?.payouts || []);
    } catch (e: any) {
      console.error(e);
      toast.error("Не вдалося завантажити баланс");
    } finally {
      setLoading(false);
    }
  }, [sessionToken, supplierId, previewRole]);

  useEffect(() => { load(); }, [load]);

  const callAction = async (action: string, extra: Record<string, any> = {}, successMsg?: string) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("bank-gateway", {
        body: { action, session_token: sessionToken, supplier_id: supplierId, preview_role: previewRole || undefined, ...extra },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (successMsg) toast.success(successMsg);
      await load();
      return data;
    } catch (e: any) {
      toast.error(e.message || "Помилка операції");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const withdraw = () => callAction("request_withdrawal", {}, "Запит на вивід відправлено");
  const bindCard = async () => {
    if (cardNumber.replace(/\D/g, "").length < 12) { toast.error("Введіть коректний номер картки"); return; }
    const r = await callAction("bind_card", { card_number: cardNumber, holder: cardHolder, provider: "liqpay" }, "Картку прив'язано");
    if (r) { setCardOpen(false); setCardNumber(""); setCardHolder(""); }
  };
  const saveWallet = async () => {
    if (walletAddress.trim().length < 6) { toast.error("Введіть адресу Telegram Wallet"); return; }
    const r = await callAction("set_payout_method",
      { wallet_address: walletAddress.trim(), wallet_currency: walletCurrency, provider: "telegram_wallet" },
      "Telegram Wallet підключено");
    if (r) setWalletOpen(false);
  };
  const toggleAuto = (field: "auto_withdraw" | "auto_charge", value: boolean) =>
    callAction("set_payout_method", { [field]: value }, "Налаштування збережено");

  const available = Number(balance?.available || 0);
  const pending = Number(balance?.pending || 0);
  const lifetimePaid = Number(balance?.lifetime_paid || 0);
  const readOnly = readOnlyProp ?? !canManageServer;

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Balance header */}
      <Card className="overflow-hidden border-primary/20">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Баланс магазину</p>
                <p className="text-2xl font-bold">{available.toLocaleString("uk-UA")} ₴</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={load} disabled={busy}>
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Banknote className="h-3.5 w-3.5" />
            Всього виплачено: <span className="font-semibold text-foreground">{lifetimePaid.toLocaleString("uk-UA")} ₴</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <RefreshCw className="h-3.5 w-3.5" />
            В обробці: <span className="font-semibold text-foreground">{pending.toLocaleString("uk-UA")} ₴</span>
          </div>
          {readOnly ? (
            <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground text-center">
              Режим перегляду — виплатами керує власник магазину
            </div>
          ) : (
            <div className="space-y-2">
              <Button className="w-full" onClick={withdraw} disabled={busy || available <= 0}>
                <ArrowDownToLine className="h-4 w-4" /> Вивести {available > 0 ? `${available.toLocaleString("uk-UA")} ₴` : ""}
                {method?.provider === "telegram_wallet" ? " на Telegram Wallet" : ""}
              </Button>
              <p className="text-[11px] text-center text-muted-foreground">
                {method?.provider === "telegram_wallet"
                  ? `Миттєвий вивід у Telegram Wallet (${method?.wallet_currency || "USDT"})`
                  : "Вивід на банківські реквізити"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Order payments */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <ReceiptText className="h-4 w-4 text-primary" />
            <p className="font-semibold text-sm">Тестові оплати замовлень</p>
          </div>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Поки немає оплат</p>
          ) : (
            <ScrollArea className="h-64 pr-3">
              <div className="space-y-2">
                {payments.map((p) => {
                  const meta = PAYMENT_STATUS[p.status];
                  const isCod = p.payment_method === "cash_on_delivery";
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.order_number}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {isCod ? "Наложений платіж" : "Оплата карткою"} · {new Date(p.created_at).toLocaleDateString("uk-UA")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.amount != null && <span className="text-sm font-bold">{Number(p.amount).toLocaleString("uk-UA")} ₴</span>}
                        <Badge variant="outline" className={cn("text-[10px]", meta.cls)}>{meta.label}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Payout method + Auto-payments — hidden for read-only (managers) */}
      {!readOnly && (
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Спосіб виплати</span>
            </div>
            {method?.masked_pan ? (
              <Badge variant="outline" className="font-mono">{method.masked_pan}</Badge>
            ) : (
              <Badge variant="secondary">Не прив'язано</Badge>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* Bind card */}
            <Dialog open={cardOpen} onOpenChange={setCardOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="w-full">
                  <CreditCard className="h-4 w-4" /> {method?.masked_pan ? "Змінити картку" : "Картка"}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Прив'язка картки</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-lg p-3">
                    <ShieldCheck className="h-4 w-4 text-green-600 shrink-0" />
                    Зберігаємо лише токен і останні 4 цифри. Повний номер та CVV не зберігаються.
                  </div>
                  <div className="space-y-1.5">
                    <Label>Номер картки</Label>
                    <Input inputMode="numeric" placeholder="0000 0000 0000 0000" value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Власник картки</Label>
                    <Input placeholder="IVAN PETRENKO" value={cardHolder} onChange={(e) => setCardHolder(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={bindCard} disabled={busy}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />} Прив'язати
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Telegram Wallet payout method */}
            <Dialog open={walletOpen} onOpenChange={setWalletOpen}>
              <DialogTrigger asChild>
                <Button variant={method?.provider === "telegram_wallet" ? "default" : "outline"} className="w-full">
                  <Send className="h-4 w-4" /> Wallet
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Send className="h-4 w-4 text-primary" /> Telegram Wallet
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-lg p-3">
                    <ShieldCheck className="h-4 w-4 text-green-600 shrink-0" />
                    Вивід коштів прямо в Telegram Wallet — зазвичай миттєво, без банківських затримок.
                  </div>
                  <div className="space-y-1.5">
                    <Label>Адреса гаманця</Label>
                    <Input placeholder="UQ... / TON або USDT адреса" value={walletAddress}
                      onChange={(e) => setWalletAddress(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Валюта виводу</Label>
                    <div className="flex gap-2">
                      {["USDT", "TON"].map((c) => (
                        <Button key={c} type="button" variant={walletCurrency === c ? "default" : "outline"}
                          size="sm" onClick={() => setWalletCurrency(c)}>{c}</Button>
                      ))}
                    </div>
                  </div>
                  <Badge variant="outline">Режим: {providers.telegram_wallet || "sandbox"}</Badge>
                </div>
                <DialogFooter>
                  <Button onClick={saveWallet} disabled={busy}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />} Зберегти
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Dedicated auto-payments dialog */}
            <Dialog open={autoOpen} onOpenChange={setAutoOpen}>
              <DialogTrigger asChild>
                <Button variant={method?.auto_withdraw || method?.auto_charge ? "default" : "outline"} className="w-full">
                  <Zap className="h-4 w-4" /> Автооплати
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Автооплати</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-1">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Mono: {providers.monobank}</Badge>
                    <Badge variant="outline">LiqPay: {providers.liqpay}</Badge>
                    <Badge variant="outline">Wallet: {providers.telegram_wallet || "sandbox"}</Badge>
                    {method?.masked_pan && <Badge variant="secondary" className="font-mono">{method.masked_pan}</Badge>}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-sm">Авто-вивід коштів</Label>
                      <p className="text-xs text-muted-foreground">Щодня автоматично виводимо доступний баланс на картку</p>
                    </div>
                    <Switch checked={!!method?.auto_withdraw} disabled={busy}
                      onCheckedChange={(v) => toggleAuto("auto_withdraw", v)} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-sm">Авто-списання націнки</Label>
                      <p className="text-xs text-muted-foreground">Списувати нашу націнку з картки по наложених платежах</p>
                    </div>
                    <Switch checked={!!method?.auto_charge} disabled={busy || !method?.masked_pan}
                      onCheckedChange={(v) => toggleAuto("auto_charge", v)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Мінімальна сума авто-виводу (₴)</Label>
                    <Input inputMode="numeric" placeholder="100" value={minWithdraw}
                      onChange={(e) => setMinWithdraw(e.target.value.replace(/\D/g, ""))} />
                    <p className="text-xs text-muted-foreground">Авто-вивід спрацьовує лише коли баланс ≥ цієї суми</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">IBAN для виводу</Label>
                    <Input placeholder="UA..." value={iban} onChange={(e) => setIban(e.target.value.toUpperCase())} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Отримувач</Label>
                    <Input placeholder="ФОП / власник картки" value={holderName} onChange={(e) => setHolderName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Telegram Wallet для авто-виводу</Label>
                    <Input placeholder="UQ... (залиште порожнім для банку)" value={walletAddress}
                      onChange={(e) => setWalletAddress(e.target.value)} />
                    <p className="text-xs text-muted-foreground">
                      Якщо вказано — авто-вивід іде миттєво в Telegram Wallet ({walletCurrency}), інакше на IBAN.
                    </p>
                  </div>
                  {!method?.masked_pan && (
                    <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-500/10 rounded-lg p-3">
                      <ShieldCheck className="h-4 w-4 shrink-0" />
                      Спершу прив'яжіть картку, щоб увімкнути авто-списання націнки.
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    onClick={async () => {
                      const r = await callAction("set_payout_method",
                        {
                          min_withdraw: Number(minWithdraw || 0),
                          iban: iban.trim() || undefined,
                          holder: holderName.trim() || undefined,
                          wallet_address: walletAddress.trim() || undefined,
                          wallet_currency: walletCurrency,
                          provider: walletAddress.trim() ? "telegram_wallet" : "liqpay",
                        }, "Налаштування автооплат збережено");
                      if (r) setAutoOpen(false);
                    }}
                    disabled={busy}
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />} Зберегти
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
      )}




      {/* Movements */}
      <Card>
        <CardContent className="p-5">
          <p className="font-semibold text-sm mb-3">Історія руху коштів</p>
          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Поки немає рухів</p>
          ) : (
            <ScrollArea className="h-72 pr-3">
              <div className="space-y-2">
                {movements.map((m) => {
                  const meta = TYPE_META[m.type] || { label: m.type, positive: m.amount >= 0 };
                  const positive = m.amount >= 0;
                  return (
                    <div key={m.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                          positive ? "bg-green-500/10" : "bg-red-500/10")}>
                          {positive ? <TrendingUp className="h-4 w-4 text-green-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{meta.label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(m.created_at).toLocaleDateString("uk-UA")} · {m.provider}
                            {m.status === "failed" && " · помилка"}
                          </p>
                        </div>
                      </div>
                      <span className={cn("text-sm font-bold shrink-0", positive ? "text-green-600" : "text-red-600")}>
                        {positive ? "+" : ""}{Number(m.amount).toLocaleString("uk-UA")} ₴
                      </span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Payouts */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <p className="font-semibold text-sm">Виплати постачальнику</p>
          </div>
          {payouts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Поки немає виплат</p>
          ) : (
            <ScrollArea className="h-56 pr-3">
              <div className="space-y-2">
                {payouts.map((p) => {
                  const isDone = p.payout_status === "completed";
                  const date = p.processed_at || p.scheduled_at || p.created_at;
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", isDone ? "bg-green-500/10" : "bg-amber-500/10")}>
                          {isDone ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Clock className="h-4 w-4 text-amber-600" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{isDone ? "Виплачено" : "Очікує виплати"}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {new Date(date).toLocaleDateString("uk-UA")} · {p.payout_method || "method"}{p.transaction_id ? ` · ${p.transaction_id}` : ""}
                          </p>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-green-600 shrink-0">{Number(p.amount).toLocaleString("uk-UA")} ₴</span>
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
