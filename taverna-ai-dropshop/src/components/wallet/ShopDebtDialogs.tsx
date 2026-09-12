import { useEffect, useMemo, useState } from "react";
import { CreditCard, ArrowLeftRight, Store, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ShopSummary } from "@/hooks/useWallet";
import { SHOP_RESERVE, withdrawableOf } from "@/lib/payoutAllocation";

const uah = (v: number) => `${Number(v || 0).toLocaleString("uk-UA", { maximumFractionDigits: 0 })} ₴`;

interface PayDialogProps {
  shop: ShopSummary | null;
  debt: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (amount: number) => void;
}

/** Погашення боргу магазину карткою. */
export function ShopDebtPayDialog({ shop, debt, onOpenChange, onConfirm }: PayDialogProps) {
  const [card, setCard] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (shop) { setAmount(String(Math.round(debt))); setCard(""); }
  }, [shop, debt]);

  const value = Number(amount) || 0;
  const cardOk = card.replace(/\D/g, "").length >= 16;

  return (
    <Dialog open={!!shop} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" /> Оплатити карткою
          </DialogTitle>
          <DialogDescription>
            Погашення боргу магазину «{shop?.shop_name}» перед платформою
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-[11px] text-muted-foreground">Сума боргу</p>
            <p className="text-2xl font-bold text-destructive">{uah(debt)}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Номер картки</Label>
            <Input
              inputMode="numeric"
              value={card}
              onChange={(e) => setCard(e.target.value.replace(/[^\d ]/g, "").slice(0, 19))}
              placeholder="0000 0000 0000 0000"
              className="h-11"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Сума до сплати, ₴</Label>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              className="h-11 font-semibold"
            />
          </div>

          <Button
            className="w-full h-11"
            disabled={!cardOk || value <= 0}
            onClick={() => onConfirm(Math.min(value, debt))}
          >
            Сплатити {uah(Math.min(value || 0, debt))}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Після оплати магазин одразу повертається в каталог
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface TransferDialogProps {
  shop: ShopSummary | null;
  debt: number;
  /** Магазини-донори (власник), окрім поточного */
  donors: ShopSummary[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (fromShopId: string, amount: number) => void;
}

/** Переказ коштів з іншого магазину для погашення боргу. */
export function ShopDebtTransferDialog({ shop, debt, donors, onOpenChange, onConfirm }: TransferDialogProps) {
  const [from, setFrom] = useState<string>("");

  const options = useMemo(
    () => donors
      .filter((d) => d.id !== shop?.id && d.role === "owner")
      .map((d) => ({ shop: d, free: withdrawableOf({ id: d.id, name: d.shop_name, available: d.available }) })),
    [donors, shop],
  );

  useEffect(() => {
    if (shop) setFrom(options.find((o) => o.free > 0)?.shop.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop]);

  const picked = options.find((o) => o.shop.id === from);
  const amount = picked ? Math.min(debt, picked.free) : 0;
  const covers = amount >= debt;

  return (
    <Dialog open={!!shop} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-primary" /> Переказ з іншого магазину
          </DialogTitle>
          <DialogDescription>
            Погашення боргу «{shop?.shop_name}» — {uah(debt)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {options.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Немає інших магазинів із доступним балансом
            </p>
          )}
          {options.map(({ shop: d, free }) => (
            <button
              key={d.id}
              disabled={free <= 0}
              onClick={() => setFrom(d.id)}
              className={cn(
                "w-full rounded-xl border p-3 text-left transition-colors disabled:opacity-50",
                from === d.id ? "border-primary bg-primary/5" : "border-border bg-card/70 backdrop-blur",
              )}
            >
              <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Store className="h-3.5 w-3.5 text-muted-foreground" /> {d.shop_name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Вільно для переказу: <span className="font-semibold text-success">{uah(free)}</span> ·
                {" "}резерв {uah(SHOP_RESERVE)} недоторканний
              </p>
            </button>
          ))}

          {picked && (
            <div className="rounded-xl border border-border p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Буде переказано</span>
                <span className="font-semibold text-foreground">{uah(amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Залишок боргу</span>
                <span className={cn("font-semibold", covers ? "text-success" : "text-destructive")}>
                  {uah(Math.max(0, debt - amount))}
                </span>
              </div>
            </div>
          )}

          <Button
            className="w-full h-11"
            disabled={!picked || amount <= 0}
            onClick={() => picked && onConfirm(picked.shop.id, amount)}
          >
            <ShieldCheck className="h-4 w-4 mr-1.5" /> Переказати та погасити
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
