import { useState } from "react";
import { motion } from "framer-motion";
import {
  Store, ChevronRight, Clock, TrendingUp, Lock, Zap, Check,
  AlertTriangle, CreditCard, ArrowLeftRight, EyeOff,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { hapticSelection } from "@/lib/haptics";
import type { ShopSummary, ShopsTotals } from "@/hooks/useWallet";
import { cn } from "@/lib/utils";
import { DEBT_BLOCK_THRESHOLD, SHOP_RESERVE, isShopBlocked, withdrawableOf } from "@/lib/payoutAllocation";
import { ShopDebtPayDialog, ShopDebtTransferDialog } from "@/components/wallet/ShopDebtDialogs";

interface ShopBalancesListProps {
  shops: ShopSummary[];
  totals: ShopsTotals | null;
  onOpenShop: (id: string) => void;
  /** Зберегти налаштування автовиводу для магазину */
  onSaveAuto?: (supplierId: string, patch: Record<string, unknown>) => void | Promise<unknown>;
  /** Тільки перегляд (менеджер магазину) */
  readOnly?: boolean;
  /** Борги магазинів перед платформою */
  debts?: Record<string, number>;
  /** Погашення боргу: карткою або переказом з іншого магазину */
  onSettleDebt?: (shopId: string, amount: number, source: { type: "card" } | { type: "shop"; fromShopId: string }) => void;
}

const uah = (v: number) => `${Number(v || 0).toLocaleString("uk-UA")}₴`;

const PROVIDERS: { id: string; label: string }[] = [
  { id: "telegram_wallet", label: "Wallet" },
  { id: "card", label: "Картка" },
  { id: "iban", label: "IBAN" },
];

export function ShopBalancesList({
  shops, totals, onOpenShop, onSaveAuto, readOnly, debts = {}, onSettleDebt,
}: ShopBalancesListProps) {
  const [openAuto, setOpenAuto] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMin, setBulkMin] = useState("500");
  const [bulkProvider, setBulkProvider] = useState("telegram_wallet");
  const [payShop, setPayShop] = useState<ShopSummary | null>(null);
  const [transferShop, setTransferShop] = useState<ShopSummary | null>(null);

  const debtOf = (shop: ShopSummary) => Number(debts[shop.id] ?? shop.debt ?? 0);


  const ownedShops = shops.filter((s) => s.role === "owner");
  const canManage = !readOnly && !!onSaveAuto && ownedShops.length > 0;

  if (shops.length === 0) {
    return (
      <div className="rounded-xl border border-border p-8 text-center">
        <Store className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">Магазинів поки немає</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {totals && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-gradient-to-br from-success/15 via-success/5 to-transparent p-4"
        >
          <p className="text-xs text-muted-foreground">Загальний баланс магазинів · доступно до виводу</p>
          <p className="text-3xl font-bold text-foreground mt-0.5">{uah(totals.available)}</p>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <MiniStat label="В обробці" value={uah(totals.pending)} />
            <MiniStat label="Виплачено" value={uah(totals.lifetime_paid)} />
            <MiniStat label="Замовлень" value={String(totals.orders)} />
          </div>

          {canManage && (
            <div className="mt-3">
              <button
                onClick={() => { hapticSelection(); setBulkOpen((v) => !v); }}
                className="w-full h-9 rounded-lg border border-primary/40 bg-card text-primary text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Zap className="h-3.5 w-3.5" /> Автовивід усім магазинам
              </button>

              {bulkOpen && (
                <div className="mt-2 rounded-xl border border-border bg-card p-3 space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    Однакові правила для {ownedShops.length} магазин(ів), де ви власник
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={bulkMin}
                      onChange={(e) => setBulkMin(e.target.value.replace(/[^\d]/g, ""))}
                      className="h-9 text-xs"
                      placeholder="Мін. сума, ₴"
                    />
                    <div className="flex gap-1">
                      {PROVIDERS.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setBulkProvider(p.id)}
                          className={cn(
                            "px-2 h-9 rounded-lg border text-[11px]",
                            bulkProvider === p.id ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground",
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button
                    className="w-full h-9 text-xs"
                    onClick={async () => {
                      hapticSelection();
                      for (const s of ownedShops) {
                        await onSaveAuto?.(s.id, {
                          auto_withdraw: true,
                          auto_withdraw_min: Number(bulkMin || 500),
                          payout_provider: bulkProvider,
                        });
                      }
                      setBulkOpen(false);
                    }}
                  >
                    <Check className="h-3.5 w-3.5 mr-1" /> Увімкнути для всіх
                  </Button>
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}

      {shops.map((shop, i) => {
        const debt = debtOf(shop);
        const blocked = isShopBlocked(debt);
        const free = withdrawableOf({ id: shop.id, name: shop.shop_name, available: shop.available });
        return (
        <motion.div
          key={shop.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.04 * i }}
          className={cn(
            "rounded-xl border p-3.5 backdrop-blur",
            blocked ? "border-destructive/60 bg-destructive/5 ring-1 ring-destructive/30" : "border-border bg-card",
          )}
        >
          {blocked && (
            <div className="mb-3 rounded-lg bg-destructive/10 border border-destructive/40 p-2.5">
              <p className="text-[11px] font-semibold text-destructive flex items-center gap-1.5">
                <EyeOff className="h-3.5 w-3.5" /> Магазин приховано з каталогу через заборгованість
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Борг {uah(debt)} ≥ ліміту {uah(DEBT_BLOCK_THRESHOLD)}. Погасіть його, щоб відновити продажі та вивід коштів.
              </p>
            </div>
          )}

          <button onClick={() => onOpenShop(shop.id)} className="w-full text-left active:scale-[0.99] transition-transform">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted overflow-hidden flex items-center justify-center shrink-0">
                {shop.logo_url ? (
                  <img src={shop.logo_url} alt={shop.shop_name} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <Store className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-medium text-sm text-foreground truncate">{shop.shop_name}</p>
                  <span className={cn(
                    "text-[9px] px-1.5 py-0.5 rounded-full shrink-0",
                    shop.role === "owner" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                  )}>
                    {shop.role === "owner" ? "Власник" : "Менеджер"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {shop.orders} замовлень · оборот {uah(shop.turnover)}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-base font-bold text-foreground">{uah(shop.available)}</p>
                <p className="text-[10px] text-muted-foreground">баланс</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>

            <div className="grid grid-cols-3 gap-2 mt-3">
              <Chip icon={Clock} label="В обробці" value={uah(shop.pending)} />
              <Chip icon={TrendingUp} label="Виплачено" value={uah(shop.lifetime_paid)} />
              <Chip icon={Clock} label="Очікує виплат" value={String(shop.awaiting_payout)} highlight={shop.awaiting_payout > 0} />
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground">
              До виводу: <span className="font-semibold text-success">{uah(free)}</span> · {uah(SHOP_RESERVE)} зарезервовано платформою
            </p>
          </button>

          {/* Борг магазину */}
          {debt > 0 && (
            <div className={cn(
              "mt-3 rounded-lg border p-2.5",
              blocked ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5",
            )}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <AlertTriangle className={cn("h-3.5 w-3.5", blocked ? "text-destructive" : "text-warning")} />
                  Борг перед платформою
                </p>
                <p className={cn("text-sm font-bold", blocked ? "text-destructive" : "text-warning")}>{uah(debt)}</p>
              </div>

              {readOnly || shop.role === "manager" ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Погашення доступне лише власнику
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <Button
                    size="sm"
                    className="h-9 text-[11px]"
                    onClick={() => { hapticSelection(); setPayShop(shop); }}
                  >
                    <CreditCard className="h-3.5 w-3.5 mr-1" /> Оплатити карткою
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-[11px]"
                    onClick={() => { hapticSelection(); setTransferShop(shop); }}
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5 mr-1" /> З іншого магазину
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Автовивід для конкретного магазину */}
          {readOnly || shop.role === "manager" ? (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground border-t border-border pt-2.5">
              <Lock className="h-3 w-3" /> Керування коштами доступне лише власнику
            </div>
          ) : (
            <ShopAutoPayout
              shop={shop}
              open={openAuto === shop.id}
              onToggleOpen={() => setOpenAuto(openAuto === shop.id ? null : shop.id)}
              onSave={(patch) => onSaveAuto?.(shop.id, patch)}
            />
          )}
        </motion.div>
        );
      })}

      <ShopDebtPayDialog
        shop={payShop}
        debt={payShop ? debtOf(payShop) : 0}
        onOpenChange={(o) => !o && setPayShop(null)}
        onConfirm={(amount) => {
          if (payShop) onSettleDebt?.(payShop.id, amount, { type: "card" });
          setPayShop(null);
        }}
      />
      <ShopDebtTransferDialog
        shop={transferShop}
        debt={transferShop ? debtOf(transferShop) : 0}
        donors={shops}
        onOpenChange={(o) => !o && setTransferShop(null)}
        onConfirm={(fromShopId, amount) => {
          if (transferShop) onSettleDebt?.(transferShop.id, amount, { type: "shop", fromShopId });
          setTransferShop(null);
        }}
      />

    </div>
  );
}

function ShopAutoPayout({
  shop, open, onToggleOpen, onSave,
}: {
  shop: ShopSummary;
  open: boolean;
  onToggleOpen: () => void;
  onSave: (patch: Record<string, unknown>) => void | Promise<unknown>;
}) {
  const [min, setMin] = useState(String(shop.auto_withdraw_min ?? 500));
  const [provider, setProvider] = useState(shop.payout_provider || "telegram_wallet");
  const enabled = !!shop.auto_withdraw;

  return (
    <div className="mt-3 border-t border-border pt-2.5">
      <div className="flex items-center justify-between">
        <button onClick={() => { hapticSelection(); onToggleOpen(); }} className="flex items-center gap-1.5 text-xs">
          <Zap className={cn("h-3.5 w-3.5", enabled ? "text-success" : "text-muted-foreground")} />
          <span className={cn("font-medium", enabled ? "text-success" : "text-muted-foreground")}>
            Автовивід {enabled ? `від ${Number(shop.auto_withdraw_min ?? 0).toLocaleString("uk-UA")}₴` : "вимкнено"}
          </span>
        </button>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => onSave({ auto_withdraw: v, auto_withdraw_min: Number(min || 500), payout_provider: provider })}
        />
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <Input
              value={min}
              onChange={(e) => setMin(e.target.value.replace(/[^\d]/g, ""))}
              className="h-9 text-xs"
              placeholder="Мін. сума, ₴"
            />
            <div className="flex gap-1">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProvider(p.id)}
                  className={cn(
                    "px-2 h-9 rounded-lg border text-[11px]",
                    provider === p.id ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <Button
            variant="outline"
            className="w-full h-9 text-xs"
            onClick={() => onSave({ auto_withdraw: true, auto_withdraw_min: Number(min || 500), payout_provider: provider })}
          >
            Зберегти правила автовиводу
          </Button>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-card/70 border border-border p-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-xs font-semibold text-foreground">{value}</p>
    </div>
  );
}

function Chip({ icon: Icon, label, value, highlight }: { icon: any; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-2", highlight ? "border-warning/40 bg-warning/5" : "border-border bg-muted/30")}>
      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Icon className="h-2.5 w-2.5" /> {label}
      </p>
      <p className={cn("text-xs font-semibold", highlight ? "text-warning" : "text-foreground")}>{value}</p>
    </div>
  );
}
