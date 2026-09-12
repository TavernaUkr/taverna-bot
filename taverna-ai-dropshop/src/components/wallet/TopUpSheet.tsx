import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { hapticSelection } from "@/lib/haptics";
import type { WalletLimit } from "@/hooks/useWallet";

export const TOPUP_PROVIDERS: { id: string; label: string; hint: string }[] = [
  { id: "telegram_wallet", label: "Telegram Wallet", hint: "Миттєво" },
  { id: "apple_pay", label: "Apple Pay", hint: "Скоро" },
  { id: "google_pay", label: "Google Pay", hint: "Скоро" },
  { id: "mono", label: "Mono Pay", hint: "Скоро" },
  { id: "liqpay", label: "LiqPay", hint: "Скоро" },
  { id: "nova_pay", label: "Nova Pay", hint: "Скоро" },
];

interface TopUpSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limits: WalletLimit[];
  mode: "sandbox" | "live";
  onTopUp: (amount: number, provider: string) => Promise<any>;
  /** Перевірка статусу оплати в Telegram Wallet — щоб баланс оновився миттєво */
  onCheckTopUp?: (transactionId: string) => Promise<any>;
}

const QUICK = [200, 500, 1000, 2000];

export function TopUpSheet({ open, onOpenChange, limits, mode, onTopUp, onCheckTopUp }: TopUpSheetProps) {
  const [amount, setAmount] = useState("500");
  const [provider, setProvider] = useState("telegram_wallet");
  const [isBusy, setIsBusy] = useState(false);

  const isProviderLive = (id: string) =>
    mode === "sandbox" || limits.find((l) => l.provider === id)?.is_active !== false;

  /** Опитуємо статус, поки Wallet не підтвердить оплату (миттєве зарахування) */
  const waitForPayment = async (transactionId: string) => {
    if (!onCheckTopUp || !transactionId) return;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const res = await onCheckTopUp(transactionId);
        if (res?.topup_status === "completed") {
          toast.success("Баланс поповнено");
          return;
        }
        if (res?.topup_status === "failed" || res?.topup_status === "expired") {
          toast.error("Оплату не завершено");
          return;
        }
      } catch {
        /* повторимо на наступній ітерації */
      }
    }
    toast.info("Очікуємо підтвердження оплати від Telegram Wallet");
  };

  const submit = async () => {
    const value = Number(amount);
    if (!value || value <= 0) return toast.error("Вкажіть суму поповнення");
    setIsBusy(true);
    try {
      const res = await onTopUp(value, provider);
      if (res?.pay_link) {
        const tg = (window as any).Telegram?.WebApp;
        if (tg?.openInvoice) {
          tg.openInvoice(res.pay_link, (status: string) => {
            if (status === "paid") {
              toast.loading("Зараховуємо поповнення…", { id: "topup-check", duration: 2000 });
              void waitForPayment(res.transaction_id);
            } else if (status === "cancelled" || status === "failed") {
              toast.error("Оплату скасовано");
            }
          });
        } else {
          window.open(res.pay_link, "_blank", "noopener");
          void waitForPayment(res.transaction_id);
        }
      } else {
        toast.success(mode === "sandbox" ? "Тестове поповнення зараховано" : "Поповнення створено");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не вдалося поповнити");
    } finally {
      setIsBusy(false);
    }
  };


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Поповнити рахунок</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Сума, ₴</Label>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-12 text-lg font-semibold"
            />
            <div className="flex gap-2 pt-1">
              {QUICK.map((q) => (
                <Button key={q} variant="outline" size="sm" className="flex-1"
                  onClick={() => { hapticSelection(); setAmount(String(q)); }}>
                  {q}₴
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Метод поповнення</Label>
            <div className="grid grid-cols-2 gap-2">
              {TOPUP_PROVIDERS.map((p) => {
                const enabled = isProviderLive(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!enabled}
                    onClick={() => { hapticSelection(); setProvider(p.id); }}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-all",
                      provider === p.id ? "border-primary bg-primary/5" : "border-border",
                      !enabled && "opacity-50",
                    )}
                  >
                    <p className="text-sm font-medium text-foreground">{p.label}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {enabled ? (p.id === "telegram_wallet" ? "Миттєво" : mode === "sandbox" ? "Тестовий режим" : p.hint) : p.hint}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <Button className="w-full h-12" onClick={submit} disabled={isBusy}>
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Поповнити на {amount || 0}₴
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
