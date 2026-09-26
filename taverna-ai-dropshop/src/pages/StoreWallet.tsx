import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Wallet, Landmark, TrendingDown, TrendingUp, Loader2,
  Settings2, Store, AlertTriangle, CalendarClock, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { triggerHapticFeedback, hapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { formatLocalTime } from "@/utils/dateFormatter";
import {
  getSupplierById,
  getSupplierTransactions,
  updateSupplierFinance,
  type BackendSupplierDetail,
  type BackendTransaction,
} from "@/lib/backendApi";

/**
 * «Фінанси магазину» — сторінка ОПЕРАЦІЙНОГО БАЛАНСУ (фінансовий спліт).
 * Маршрут: /wallet/:id (id = supplierId).
 *
 * - Статистика: balance / managers_debt / platform_debt (копійки → грн).
 * - Історія транзакцій: GET /wallets/supplier/{id}/transactions (пагінація).
 * - «Налаштування виплат»: PATCH /suppliers/{id}/finance
 *   (auto_payout_enabled, auto_payout_schedule) — лише власник.
 *
 * Доступ: власник або менеджер з правом can_view_balance
 * (бекенд сам віддає фінанси лише їм, інакше 403 на транзакції).
 */
export default function StoreWallet() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const supplierId = Number(id);
  const isValidId = Number.isInteger(supplierId) && supplierId > 0;

  const [shopName, setShopName] = useState<string>("");
  const [supplier, setSupplier] = useState<BackendSupplierDetail | null>(null);
  const [transactions, setTransactions] = useState<BackendTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTxLoading, setIsTxLoading] = useState(false);
  const [isOwner, setIsOwner] = useState(false);

  // Пагінація історії (порції по 20)
  const PAGE_SIZE = 20;
  const [txOffset, setTxOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Модалка «Налаштування виплат» (лише власник)
  const [showPayoutSettings, setShowPayoutSettings] = useState(false);
  const [payoutDraft, setPayoutDraft] = useState<{
    auto_payout_enabled: boolean;
    auto_payout_schedule: "daily" | "weekly";
  }>({ auto_payout_enabled: false, auto_payout_schedule: "daily" });
  const [isSavingPayout, setIsSavingPayout] = useState(false);

  /** Копійки → «1 234,56 ₴» (без символу для передачі в компоненти). */
  const fmtUAH = (kopecks: number | null | undefined) =>
    ((Number(kopecks) || 0) / 100).toLocaleString("uk-UA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  /** Завантаження магазину (баланси приходять лише власнику або менеджеру з правом). */
  const loadSupplier = useCallback(async () => {
    if (!isValidId) {
      navigate("/my-shops", { replace: true });
      return;
    }
    try {
      const s = await getSupplierById(supplierId);
      setSupplier(s);
      setShopName(s.store_name || "");
      setIsOwner(s.role === "owner");
      setPayoutDraft({
        auto_payout_enabled: Boolean(s.auto_payout_enabled),
        auto_payout_schedule: s.auto_payout_schedule === "weekly" ? "weekly" : "daily",
      });
    } catch (err: any) {
      console.error("Error loading supplier finance:", err);
      if (err?.status === 403) {
        toast.error("Немає доступу до фінансів цього магазину");
        navigate("/my-shops", { replace: true });
        return;
      }
      toast.error(err?.message || "Помилка завантаження магазину");
    }
  }, [supplierId, isValidId, navigate]);

  /** Порція історії транзакцій магазину. */
  const loadTransactions = useCallback(
    async (offset: number, append: boolean) => {
      if (!isValidId) return;
      setIsTxLoading(true);
      try {
        const page = await getSupplierTransactions(supplierId, PAGE_SIZE, offset);
        setTransactions((prev) => (append ? [...prev, ...page] : page));
        setHasMore(page.length === PAGE_SIZE);
        setTxOffset(offset);
      } catch (err: any) {
        console.error("Error loading supplier transactions:", err);
        if (!append) setTransactions([]);
        // 403 = менеджер без права can_view_balance: тихо — на сторінці
        // вже є підказка про приховані фінанси.
        if (err?.status !== 403) {
          toast.error(err?.message || "Не вдалося завантажити історію транзакцій");
        }
      } finally {
        setIsTxLoading(false);
      }
    },
    [supplierId, isValidId]
  );

  useEffect(() => {
    if (!isValidId) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      await Promise.all([loadSupplier(), loadTransactions(0, false)]);
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  /** Зберігає налаштування авто-виводу (лише власник). */
  const handleSavePayoutSettings = async () => {
    if (isSavingPayout || !isValidId) return;
    setIsSavingPayout(true);
    try {
      await updateSupplierFinance(supplierId, {
        auto_payout_enabled: payoutDraft.auto_payout_enabled,
        auto_payout_schedule: payoutDraft.auto_payout_schedule,
      });
      triggerHapticFeedback("notification", "success");
      toast.success("Налаштування виплат збережено");
      setShowPayoutSettings(false);
      await loadSupplier();
    } catch (err: any) {
      console.error("Error saving payout settings:", err);
      triggerHapticFeedback("notification", "error");
      toast.error(err?.message || "Не вдалося зберегти налаштування виплат");
    } finally {
      setIsSavingPayout(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const balance = Number(supplier?.balance) || 0;
  const managersDebt = Number(supplier?.managers_debt) || 0;
  const platformDebt = Number(supplier?.platform_debt) || 0;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* === Шапка === */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              hapticSelection();
              navigate("/my-shops");
            }}
            aria-label="Назад до магазинів"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-bold text-lg text-foreground truncate">Фінанси магазину</h1>
            <p className="text-xs text-muted-foreground truncate">
              {shopName || `Магазин #${supplierId}`}
            </p>
          </div>
          {/* Налаштування виплат — лише власник */}
          {isOwner && (
            <Button
              size="sm"
              variant="outline"
              className="gap-2 shrink-0"
              onClick={() => {
                hapticSelection();
                setShowPayoutSettings(true);
              }}
            >
              <Settings2 className="h-4 w-4" />
              Налаштування виплат
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* === Блок статистики: 3 картки === */}
        <div className="grid grid-cols-1 gap-3">
          <div className="rounded-2xl bg-gradient-to-br from-primary/15 via-primary/5 to-transparent border border-border p-5">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              <p className="text-sm font-medium text-foreground">Доступний баланс</p>
            </div>
            <p className="text-3xl font-bold text-foreground mt-2">
              {fmtUAH(balance)}
              <span className="text-xl">₴</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Операційний баланс магазину після сплату винагород менеджерам
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div
              className={cn(
                "rounded-2xl border p-4",
                managersDebt > 0
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-border bg-muted/30"
              )}
            >
              <div className="flex items-center gap-2">
                <Landmark className={cn("h-4 w-4", managersDebt > 0 ? "text-destructive" : "text-muted-foreground")} />
                <p className="text-xs font-medium text-muted-foreground">Борг менеджерам</p>
              </div>
              <p
                className={cn(
                  "text-xl font-bold mt-1.5",
                  managersDebt > 0 ? "text-destructive" : "text-foreground"
                )}
              >
                {fmtUAH(managersDebt)}₴
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {managersDebt > 0
                  ? "Погашається з нових надходжень"
                  : "Немає заборгованості"}
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground">Борг платформі</p>
              </div>
              <p
                className={cn(
                  "text-xl font-bold mt-1.5",
                  platformDebt > 0 ? "text-destructive" : "text-foreground"
                )}
              >
                {fmtUAH(platformDebt)}₴
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {platformDebt > 0
                  ? "Комісія платформи до сплати"
                  : "Немає заборгованості"}
              </p>
            </div>
          </div>

          {/* Стан авто-виводу (коротке підсумження, лише власник) */}
          {isOwner && supplier && (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card text-xs text-muted-foreground">
              <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
              <p>
                Авто-вивід:{" "}
                {supplier.auto_payout_enabled ? (
                  <span className="text-success font-medium">
                    увімкнено{supplier.auto_payout_schedule === "weekly" ? " (щотижня)" : " (щодня)"}
                  </span>
                ) : (
                  <span>вимкнено</span>
                )}
              </p>
            </div>
          )}
        </div>

        {/* === Історія транзакцій === */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Історія транзакцій
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!isTxLoading && transactions.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-muted/50 mx-auto flex items-center justify-center">
                  <Wallet className="h-6 w-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Транзакцій ще немає. Рухи операційного балансу магазину
                  з'являться тут автоматично
                </p>
              </div>
            ) : (
              <>
                {transactions.map((tx) => {
                  const isIncome = tx.amount > 0;
                  const isBonus = tx.currency === "BONUS";
                  return (
                    <div
                      key={tx.id}
                      className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card text-left"
                    >
                      <div
                        className={cn(
                          "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                          isIncome ? "bg-success/15" : "bg-muted"
                        )}
                      >
                        {isIncome ? (
                          <TrendingUp className="h-4 w-4 text-success" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {tx.description || TX_TYPE_TITLE[tx.type] || tx.type}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {tx.created_at ? formatLocalTime(tx.created_at) : ""}
                        </p>
                      </div>
                      <p
                        className={cn(
                          "text-sm font-semibold shrink-0",
                          isIncome ? "text-success" : "text-foreground"
                        )}
                      >
                        {isIncome ? "+" : ""}
                        {isBonus
                          ? `${tx.amount.toLocaleString("uk-UA")} бон.`
                          : `${fmtUAH(tx.amount)}₴`}
                      </p>
                    </div>
                  );
                })}

                {hasMore && (
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={isTxLoading}
                    onClick={() => {
                      hapticSelection();
                      loadTransactions(txOffset + PAGE_SIZE, true);
                    }}
                  >
                    {isTxLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Показати ще"
                    )}
                  </Button>
                )}
              </>
            )}
            {isTxLoading && transactions.length === 0 && (
              <p className="text-xs text-muted-foreground p-3 bg-muted/40 rounded-lg flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Завантаження історії…
              </p>
            )}
          </CardContent>
        </Card>

        {/* Підказка для менеджера без права (фінанси приховані — показуємо 0) */}
        {!isOwner && !supplier?.my_permissions?.can_view_balance && (
          <div className="flex items-start gap-2 p-3 rounded-xl border border-border bg-muted/30 text-xs text-muted-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              Фінансові дані приховано: зверніться до власника магазину, щоб
              отримати право «Перегляд балансу».
            </p>
          </div>
        )}
      </div>

      {/* === Модалка «Налаштування виплат» (лише власник) === */}
      <Dialog open={showPayoutSettings} onOpenChange={setShowPayoutSettings}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />
              Налаштування виплат
            </DialogTitle>
            <DialogDescription>
              Автоматичний переказ операційного балансу магазину на ваш
              особистий рахунок.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-muted/30">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Авто-вивід коштів</p>
                <p className="text-xs text-muted-foreground">
                  Баланс магазину автоматично переводиться на ваш рахунок
                </p>
              </div>
              <Switch
                checked={payoutDraft.auto_payout_enabled}
                onCheckedChange={(v) => {
                  hapticSelection();
                  setPayoutDraft({ ...payoutDraft, auto_payout_enabled: v });
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>Періодичність виводу</Label>
              <Select
                value={payoutDraft.auto_payout_schedule}
                onValueChange={(v) => {
                  hapticSelection();
                  setPayoutDraft({
                    ...payoutDraft,
                    auto_payout_schedule: v === "weekly" ? "weekly" : "daily",
                  });
                }}
                disabled={!payoutDraft.auto_payout_enabled}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Оберіть періодичність" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Щодня</SelectItem>
                  <SelectItem value="weekly">Щотижня</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Як часто платформа виводитиме накопичений баланс.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              className="w-full gap-2"
              disabled={isSavingPayout}
              onClick={handleSavePayoutSettings}
            >
              {isSavingPayout ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Зберігаємо…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Зберегти
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Людські назви типів транзакцій операційного балансу магазину. */
const TX_TYPE_TITLE: Record<string, string> = {
  supplier_ticket_payout: "Винагорода менеджеру (тікет)",
  supplier_order_payout: "Винагорода менеджеру (замовлення)",
  platform_fee: "Комісія платформи",
  supplier_income: "Надходження від замовлення",
  withdrawal: "Вивід коштів",
};
