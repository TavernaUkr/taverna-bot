import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Loader2, Store, Wallet as WalletIcon, Lock, ShieldCheck } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { WalletLimit, WalletState } from "@/hooks/useWallet";
import { calcPayoutFees, PLATFORM_PAYOUT_FEE_PERCENT, PLATFORM_PAYOUT_FEE_MIN } from "@/lib/payoutFees";
import {
  allocateAmount, isShopBlocked, withdrawableOf, PERSONAL_KEY, SHOP_RESERVE,
} from "@/lib/payoutAllocation";

const PAYOUT_PROVIDERS = [
  { id: "telegram_wallet", label: "Telegram Wallet", placeholder: "UQ... / USDT адреса" },
  { id: "card", label: "Картка", placeholder: "0000 0000 0000 0000" },
  { id: "iban", label: "IBAN", placeholder: "UA00 0000 0000 0000 0000 0000 000" },
];

export interface PayoutSource {
  /** null = особистий гаманець */
  id: string | null;
  name: string;
  available: number;
  pending?: number;
  debt?: number;
}

interface PayoutSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: WalletState;
  limits: WalletLimit[];
  /** Джерела списання: магазини постачальника (+ особистий гаманець, якщо є) */
  sources?: PayoutSource[];
  onPayout: (amount: number, provider: string, destination?: string, sourceShopId?: string) => Promise<unknown>;
}

const uah = (v: number) => Number(v || 0).toLocaleString("uk-UA", { maximumFractionDigits: 0 });

export function PayoutSheet({ open, onOpenChange, wallet, limits, sources = [], onPayout }: PayoutSheetProps) {
  const [provider, setProvider] = useState(wallet.payout_provider || "telegram_wallet");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState(wallet.tg_wallet_address || "");
  const [isBusy, setIsBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const multi = sources.length > 0;

  const rows = useMemo(
    () => sources.map((s) => ({
      ...s,
      key: s.id ?? PERSONAL_KEY,
      blocked: s.id !== null && isShopBlocked(s.debt),
      withdrawable: withdrawableOf(s),
    })),
    [sources],
  );

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setSelected(rows.filter((r) => !r.blocked && r.withdrawable > 0).map((r) => r.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = rows.filter((r) => selected.includes(r.key) && !r.blocked);
  const poolAvailable = chosen.reduce((s, r) => s + r.withdrawable, 0);
  const available = multi ? poolAvailable : Number(wallet.balance || 0);

  const limit = useMemo(() => limits.find((l) => l.provider === provider), [limits, provider]);
  const value = Number(amount) || 0;
  const { platformFee, providerFee, totalFee, net } = useMemo(() => calcPayoutFees(value, limit), [value, limit]);

  const allocation = useMemo(
    () => (multi ? allocateAmount(chosen, Math.min(value, poolAvailable)) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [multi, value, poolAvailable, selected.join("|")],
  );

  const toggle = (key: string) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const submit = async () => {
    if (multi && chosen.length === 0) return toast.error("Оберіть хоча б один магазин для списання");
    if (!value) return toast.error("Вкажіть суму виводу");
    if (value > available) return toast.error("Сума перевищує доступну до виводу (з урахуванням резерву)");
    if (limit && value < limit.min_payout) return toast.error(`Мінімум ${limit.min_payout}₴`);
    if (net <= 0) return toast.error("Сума менша за комісію виводу");
    setIsBusy(true);
    try {
      if (multi) {
        for (const row of chosen) {
          const part = allocation[row.key] || 0;
          if (part <= 0) continue;
          await onPayout(part, provider, destination, row.id ?? undefined);
        }
      } else {
        await onPayout(value, provider, destination);
      }
      toast.success("Запит на вивід створено");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не вдалося вивести кошти");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Вивести кошти</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          {multi && (
            <div className="space-y-2">
              <Label className="text-xs">Магазини для списання</Label>
              <div className="space-y-2">
                {rows.map((r) => {
                  const Icon = r.id ? Store : WalletIcon;
                  const isOn = selected.includes(r.key) && !r.blocked;
                  const part = allocation[r.key] || 0;
                  return (
                    <div
                      key={r.key}
                      className={cn(
                        "rounded-xl border p-3 backdrop-blur transition-colors",
                        r.blocked
                          ? "border-destructive/40 bg-destructive/5"
                          : isOn
                            ? "border-primary/50 bg-primary/5"
                            : "border-border bg-card/70",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={isOn}
                          disabled={r.blocked || r.withdrawable <= 0}
                          onCheckedChange={() => toggle(r.key)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground flex items-center gap-1.5 truncate">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            {r.name}
                            {r.blocked && <Lock className="h-3.5 w-3.5 text-destructive shrink-0" />}
                          </p>
                          {r.blocked ? (
                            <p className="text-[11px] text-destructive mt-0.5">
                              Вивід заблоковано: борг {uah(r.debt)}₴ перед платформою
                            </p>
                          ) : (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Доступно до виводу: <span className="font-semibold text-success">{uah(r.withdrawable)} ₴</span>
                              {r.id !== null && ` (${uah(SHOP_RESERVE)} ₴ зарезервовано платформою)`}
                            </p>
                          )}
                          {(r.pending ?? 0) > 0 && !r.blocked && (
                            <p className="text-[11px] text-muted-foreground">В обробці: {uah(r.pending)} ₴</p>
                          )}
                        </div>
                        {isOn && part > 0 && (
                          <span className="text-xs font-semibold text-primary shrink-0">−{uah(part)} ₴</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-success" />
                На кожному магазині завжди залишається {uah(SHOP_RESERVE)} ₴ резерву платформи
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {PAYOUT_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setProvider(p.id)}
                className={cn(
                  "rounded-xl border p-2.5 text-xs font-medium transition-all",
                  provider === p.id ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Сума, ₴ (доступно {uah(available)}₴)</Label>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-12 text-lg font-semibold"
              placeholder="0"
              disabled={multi && chosen.length === 0}
            />
            <button
              className="text-xs text-primary disabled:opacity-50"
              disabled={multi && chosen.length === 0}
              onClick={() => setAmount(String(available))}
            >
              Вивести все доступне
            </button>
          </div>

          {multi && value > 0 && (
            <div className="rounded-xl border border-border bg-card/70 backdrop-blur p-3 text-xs space-y-1">
              <p className="font-semibold text-foreground mb-1">Розподіл суми по магазинах</p>
              {chosen.map((r) => (
                <div key={r.key} className="flex justify-between">
                  <span className="text-muted-foreground truncate">{r.name}</span>
                  <span className="text-foreground font-medium">−{uah(allocation[r.key] || 0)} ₴</span>
                </div>
              ))}
              {value > poolAvailable && (
                <p className="text-destructive pt-1">
                  Максимум по обраних магазинах: {uah(poolAvailable)} ₴
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Реквізити</Label>
            <Input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder={PAYOUT_PROVIDERS.find((p) => p.id === provider)?.placeholder}
            />
          </div>

          <div className="rounded-xl border border-border p-3 text-xs space-y-1">
            {limit && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ліміти</span>
                  <span className="text-foreground">{limit.min_payout}₴ – {limit.max_payout.toLocaleString("uk-UA")}₴</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Добовий ліміт</span>
                  <span className="text-foreground">{limit.daily_limit.toLocaleString("uk-UA")}₴</span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Комісія платформи ({PLATFORM_PAYOUT_FEE_PERCENT}%, мін. {PLATFORM_PAYOUT_FEE_MIN}₴)
              </span>
              <span className="text-foreground">−{platformFee.toLocaleString("uk-UA")}₴</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Комісія методу</span>
              <span className="text-foreground">−{providerFee.toLocaleString("uk-UA")}₴</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1 mt-1">
              <span className="text-muted-foreground">Разом комісія</span>
              <span className="text-foreground">−{totalFee.toLocaleString("uk-UA")}₴</span>
            </div>
            <div className="flex justify-between font-semibold text-sm">
              <span className="text-muted-foreground">Отримаєте на руки</span>
              <span className="text-success">{net.toLocaleString("uk-UA")}₴</span>
            </div>
            {limit && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Термін</span>
                <span className="text-foreground">{limit.eta_text || "—"}</span>
              </div>
            )}
          </div>

          <Button className="w-full h-12" onClick={submit} disabled={isBusy || (multi && chosen.length === 0)}>
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowUpRight className="h-4 w-4 mr-2" />}
            {multi && chosen.length === 0 ? "Оберіть магазини" : "Вивести"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
