import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet, Clock, Banknote, TrendingUp, Percent, Store, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { isPreviewDevEnvironment } from "@/lib/dev-preview";
import { hapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import type { WalletState, ShopSummary, ShopsTotals } from "@/hooks/useWallet";
import { SupplierDebtCard, useDebtControls } from "@/components/wallet/SupplierDebtCard";
import { UsdtPayoutCard } from "@/components/wallet/UsdtPayoutCard";
import { FinancialDetailsSheet, type FinancialTab } from "@/components/wallet/FinancialDetailsSheet";

type Period = "day" | "week" | "month" | "year";
interface SeriesPoint { label: string; turnover: number; commission?: number }

const PERIODS: { id: Period; label: string }[] = [
  { id: "day", label: "День" },
  { id: "week", label: "Тиждень" },
  { id: "month", label: "Місяць" },
  { id: "year", label: "Рік" },
];

const fmt = (v: number) => Number(v || 0).toLocaleString("uk-UA", { maximumFractionDigits: 0 });

function demoSeries(period: Period): SeriesPoint[] {
  const n = period === "day" ? 8 : period === "week" ? 7 : period === "month" ? 10 : 12;
  return Array.from({ length: n }, (_, i) => ({
    label: period === "year" ? `${i + 1}м` : period === "week" ? ["Пн","Вт","Ср","Чт","Пт","Сб","Нд"][i] : `${i + 1}`,
    turnover: Math.round(2500 + Math.sin(i / 1.6) * 1400 + i * 320),
  }));
}

interface WalletOverviewProps {
  wallet: WalletState;
  shops: ShopSummary[];
  totals: ShopsTotals | null;
  onOpenShops: () => void;
  onWithdraw?: () => void;
  onConnectWallet?: () => void;
  readOnly?: boolean;
}

/** «Загалом»: зведення всіх магазинів + особисті кошти + графік по періодах. */
export function WalletOverview({ wallet, shops, totals, onOpenShops, onWithdraw, onConnectWallet, readOnly }: WalletOverviewProps) {
  const debtCtl = useDebtControls(
    Number(wallet.platform_debt ?? (isPreviewDevEnvironment() ? 4820 : 0)),
  );
  const auth = useTelegramAuthContext() as any;
  const sessionToken = auth?.sessionToken;
  const devRoleOverride = auth?.devRoleOverride;

  const [period, setPeriod] = useState<Period>("month");
  const [series, setSeries] = useState<Record<Period, SeriesPoint[]> | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      if (!sessionToken) throw new Error("no session");
      const { data, error } = await supabase.functions.invoke("bank-gateway", {
        body: { action: "get_stats", session_token: sessionToken, preview_role: devRoleOverride || undefined },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSeries(data?.series || null);
    } catch {
      if (isPreviewDevEnvironment()) {
        setSeries({ day: demoSeries("day"), week: demoSeries("week"), month: demoSeries("month"), year: demoSeries("year") });
      } else {
        setSeries(null);
      }
    } finally {
      setLoading(false);
    }
  }, [sessionToken, devRoleOverride]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const points = series?.[period] || [];
  const maxVal = Math.max(1, ...points.map((p) => p.turnover));

  const shopsAvailable = totals?.available ?? shops.reduce((s, r) => s + Number(r.available || 0), 0);
  const shopsPending = totals?.pending ?? shops.reduce((s, r) => s + Number(r.pending || 0), 0);
  const shopsPaid = totals?.lifetime_paid ?? shops.reduce((s, r) => s + Number(r.lifetime_paid || 0), 0);
  const turnover = totals?.turnover ?? 0;
  const commission = shops.reduce((s, r) => s + Number(r.commission || 0), 0);

  const grandTotal = useMemo(() => Number(shopsAvailable || 0), [shopsAvailable]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<FinancialTab>("income");
  const openDetails = (tab: FinancialTab) => { setDetailsTab(tab); setDetailsOpen(true); };


  return (
    <div className="space-y-4">
      {/* Дохід vs борг перед платформою */}
      <SupplierDebtCard
        earnings={grandTotal}
        debt={debtCtl.debt}
        autoRepay={debtCtl.autoRepay}
        autoRepayPercent={debtCtl.percent}
        onAutoRepayChange={debtCtl.setAutoRepay}
        onAutoRepayPercentChange={debtCtl.setPercent}
        onPayDebt={debtCtl.payDebt}
        onWithdraw={onWithdraw}
        readOnly={readOnly}
        onOpenDetails={openDetails}
      />

      {/* USDT / Telegram Wallet */}
      {!readOnly && onConnectWallet && (
        <UsdtPayoutCard
          connected={!!wallet.is_connected}
          address={wallet.tg_wallet_address}
          currency={wallet.tg_wallet_currency}
          onConnect={onConnectWallet}
        />
      )}

      <div className="grid grid-cols-3 gap-2">
        <Cell label="Доступно" value={shopsAvailable} icon={Store} tone="success" />
        <Cell label="В обробці" value={shopsPending} icon={Clock} tone="muted" />
        <Cell label="Виплачено" value={shopsPaid} icon={Banknote} />
      </div>


      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-success" /> Оборот
          </p>
          <p className="text-lg font-bold text-foreground">{fmt(turnover)} ₴</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Percent className="h-3 w-3 text-primary" /> Комісія платформи
          </p>
          <p className="text-lg font-bold text-foreground">{fmt(commission)} ₴</p>
        </div>
      </div>

      {/* Графік по періодах */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-foreground">Динаміка обороту</p>
          <div className="flex gap-1 p-0.5 rounded-lg bg-muted">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => { hapticSelection(); setPeriod(p.id); }}
                className={cn(
                  "px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
                  period === p.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : points.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">Даних за період поки немає</p>
        ) : (
          <div className="flex items-end gap-1.5 h-32">
            {points.map((p, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-primary/40 to-primary"
                  style={{ height: `${Math.max(4, (p.turnover / maxVal) * 100)}%` }}
                  title={`${fmt(p.turnover)} ₴`}
                />
                <span className="text-[9px] text-muted-foreground truncate w-full text-center">{p.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => { hapticSelection(); onOpenShops(); }}
        className="w-full rounded-xl border border-border bg-card p-4 flex items-center gap-3 text-left"
      >
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
          <Wallet className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Рахунки магазинів</p>
          <p className="text-xs text-muted-foreground">{shops.length} магазин(ів) · деталі та статистика кожного</p>
        </div>
      </button>

      <FinancialDetailsSheet
        key={detailsTab}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        initialTab={detailsTab}
      />
    </div>
  );
}

function Cell({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone?: "success" | "muted" }) {
  return (
    <div className="rounded-xl bg-card/70 border border-border p-2.5">
      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
        <Icon className={cn("h-3 w-3", tone === "success" && "text-success")} /> {label}
      </p>
      <p className={cn(
        "text-sm font-semibold",
        tone === "success" ? "text-success" : tone === "muted" ? "text-muted-foreground" : "text-foreground",
      )}>
        {fmt(value)}₴
      </p>
    </div>
  );
}
