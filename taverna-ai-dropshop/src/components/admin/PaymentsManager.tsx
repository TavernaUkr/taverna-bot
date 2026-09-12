import { useState, useEffect, useMemo } from "react";
import {
  Loader2, Wallet, Search, RefreshCw, PackageCheck, ReceiptText,
  CheckCircle2, Clock, FileText, Banknote, Store, Upload, AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";

interface PaymentsManagerProps {
  mode: "admin" | "moderator";
}

interface PayoutSplit {
  id: string;
  order_id: string;
  supplier_id: string;
  product_total: number;
  supplier_amount: number;
  platform_commission: number;
  payout_stage: string;
  payout_type: string | null;
  eligible_payout_at: string | null;
  paid_at: string | null;
  receipt_url: string | null;
  is_returnable: boolean | null;
  stage_label: string;
  shop_name: string;
  has_requisites: boolean;
  requisites: { iban?: string; card_holder?: string; bank?: string } | null;
  order: {
    order_number?: string;
    status?: string;
    payment_method?: string;
    received_at?: string | null;
    tracking_status?: string | null;
    delivery_tracking?: string | null;
  } | null;
}

const STAGES = [
  { key: "all", label: "Усі" },
  { key: "created", label: "Створено" },
  { key: "processing", label: "В обробці" },
  { key: "paid", label: "Оплачено" },
];

const stageStyle: Record<string, string> = {
  created: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  processing: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  paid: "bg-green-500/10 text-green-600 border-green-500/30",
};

const stageIcon: Record<string, React.ElementType> = {
  created: Clock,
  processing: RefreshCw,
  paid: CheckCircle2,
};

export function PaymentsManager({ mode }: PaymentsManagerProps) {
  const { sessionToken } = useTelegramAuthContext();
  const [splits, setSplits] = useState<PayoutSplit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stage, setStage] = useState("all");
  const [search, setSearch] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchData = async () => {
    if (!sessionToken) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-payments", {
        body: { action: "list", session_token: sessionToken, stage: stage === "all" ? undefined : stage },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSplits(data?.splits || []);
    } catch (err: any) {
      console.error("payments list error:", err);
      toast.error("Помилка завантаження оплат");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken, stage]);

  const markReceived = async (orderId: string) => {
    setProcessingId(orderId);
    try {
      const { data, error } = await supabase.functions.invoke("manage-payments", {
        body: { action: "mark_received", session_token: sessionToken, order_id: orderId },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success("Позначено як отримано, таймер виплати запущено");
      fetchData();
    } catch {
      toast.error("Помилка позначки отримання");
    } finally {
      setProcessingId(null);
    }
  };

  const markPaid = async (splitId: string) => {
    setProcessingId(splitId);
    try {
      const { data, error } = await supabase.functions.invoke("manage-payments", {
        body: { action: "mark_paid", session_token: sessionToken, split_id: splitId },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success("Виплату позначено як оплачену");
      fetchData();
    } catch {
      toast.error("Помилка виплати");
    } finally {
      setProcessingId(null);
    }
  };

  const uploadReceipt = async (splitId: string, file: File) => {
    setProcessingId(splitId);
    try {
      const path = `receipts/${splitId}-${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("payment-receipts").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from("payment-receipts").createSignedUrl(path, 60 * 60 * 24 * 365);
      const receiptUrl = signed?.signedUrl || path;
      const { data, error } = await supabase.functions.invoke("manage-payments", {
        body: { action: "attach_receipt", session_token: sessionToken, split_id: splitId, receipt_url: receiptUrl },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success("Чек прикріплено");
      fetchData();
    } catch (err: any) {
      console.error(err);
      toast.error("Помилка завантаження чека");
    } finally {
      setProcessingId(null);
    }
  };

  const filtered = useMemo(() => {
    let r = splits;
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((s) =>
        (s.order?.order_number || "").toLowerCase().includes(q) ||
        (s.shop_name || "").toLowerCase().includes(q),
      );
    }
    return r;
  }, [splits, search]);

  const stats = useMemo(() => {
    return {
      created: splits.filter((s) => s.payout_stage === "created").length,
      processing: splits.filter((s) => s.payout_stage === "processing").length,
      paid: splits.filter((s) => s.payout_stage === "paid").length,
    };
  }, [splits]);

  const formatDate = (d?: string | null) =>
    d ? new Date(d).toLocaleDateString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <Card><CardContent className="p-3 text-center">
          <Clock className="h-4 w-4 text-yellow-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-foreground">{stats.created}</p>
          <p className="text-[10px] text-muted-foreground">Створено</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <RefreshCw className="h-4 w-4 text-blue-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-foreground">{stats.processing}</p>
          <p className="text-[10px] text-muted-foreground">В обробці</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-foreground">{stats.paid}</p>
          <p className="text-[10px] text-muted-foreground">Оплачено</p>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <Button
            key={s.key}
            variant={stage === s.key ? "default" : "outline"}
            size="sm"
            className="text-xs"
            onClick={() => setStage(s.key)}
          >
            {s.label}
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={fetchData} className="ml-auto">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Пошук за № замовлення або магазином"
          className="pl-9"
        />
      </div>

      <ScrollArea className="h-[calc(100vh-440px)]">
        <div className="space-y-3 pr-3">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">Немає оплат за цим фільтром</p>
            </div>
          ) : (
            filtered.map((s) => {
              const StageIcon = stageIcon[s.payout_stage] || Clock;
              const received = !!s.order?.received_at;
              return (
                <Card key={s.id} className="overflow-hidden">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                          <Store className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="truncate">{s.shop_name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          № {s.order?.order_number || s.order_id.slice(0, 8)}
                        </p>
                      </div>
                      <Badge variant="outline" className={cn("gap-1 shrink-0", stageStyle[s.payout_stage])}>
                        <StageIcon className="h-3 w-3" /> {s.stage_label}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-muted/50 rounded-lg p-2">
                        <p className="text-[10px] text-muted-foreground">Роздріб</p>
                        <p className="text-sm font-bold text-foreground">{Math.round(s.product_total)}₴</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-2">
                        <p className="text-[10px] text-muted-foreground">Постачальнику</p>
                        <p className="text-sm font-bold text-green-600">{Math.round(s.supplier_amount)}₴</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-2">
                        <p className="text-[10px] text-muted-foreground">Націнка</p>
                        <p className="text-sm font-bold text-primary">{Math.round(s.platform_commission)}₴</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <Badge variant="secondary" className="font-normal">
                        {s.payout_type === "full_prepaid" ? "Повна предоплата" : "Часткова (націнка)"}
                      </Badge>
                      <Badge variant="outline" className="font-normal">
                        {s.is_returnable === false ? "Незворотний" : "Зворотний 14дн"}
                      </Badge>
                      {s.order?.delivery_tracking && (
                        <Badge variant="outline" className="font-normal">ТТН {s.order.delivery_tracking}</Badge>
                      )}
                    </div>

                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p>Доставка: {s.order?.tracking_status || (received ? "Отримано" : "В дорозі")}</p>
                      {received && <p>Отримано: {formatDate(s.order?.received_at)}</p>}
                      {s.eligible_payout_at && s.payout_stage !== "paid" && (
                        <p>Виплата після: {formatDate(s.eligible_payout_at)}</p>
                      )}
                      {s.paid_at && <p>Оплачено: {formatDate(s.paid_at)}</p>}
                    </div>

                    {mode === "admin" && s.requisites && (s.requisites.iban || s.requisites.card_holder) && (
                      <div className="text-[11px] text-muted-foreground bg-muted/40 rounded-lg p-2">
                        <p className="flex items-center gap-1"><Banknote className="h-3 w-3" /> {s.requisites.iban || s.requisites.card_holder}</p>
                        {s.requisites.bank && <p>{s.requisites.bank}</p>}
                      </div>
                    )}

                    {mode === "admin" && !s.has_requisites && s.payout_stage !== "paid" && (
                      <div className="flex items-center gap-1.5 text-[11px] text-amber-600 bg-amber-500/10 rounded-lg p-2">
                        <AlertTriangle className="h-3.5 w-3.5" /> Немає реквізитів постачальника
                      </div>
                    )}

                    {s.receipt_url && (
                      <a href={s.receipt_url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <FileText className="h-3.5 w-3.5" /> Чек перерахування
                      </a>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {!received && (
                        <Button
                          variant="outline" size="sm" className="text-xs gap-1"
                          onClick={() => markReceived(s.order_id)}
                          disabled={processingId === s.order_id}
                        >
                          {processingId === s.order_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />}
                          Отримано
                        </Button>
                      )}

                      {mode === "admin" && s.payout_stage !== "paid" && (
                        <>
                          <label className="inline-flex">
                            <input
                              type="file" accept="image/*,application/pdf" className="hidden"
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadReceipt(s.id, f); }}
                            />
                            <span className="inline-flex items-center gap-1 text-xs px-3 h-8 rounded-md border border-input cursor-pointer hover:bg-accent">
                              <Upload className="h-3.5 w-3.5" /> Чек
                            </span>
                          </label>
                          <Button
                            size="sm" className="text-xs gap-1"
                            onClick={() => markPaid(s.id)}
                            disabled={processingId === s.id || !s.has_requisites}
                          >
                            {processingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ReceiptText className="h-3.5 w-3.5" />}
                            Виплатити
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
