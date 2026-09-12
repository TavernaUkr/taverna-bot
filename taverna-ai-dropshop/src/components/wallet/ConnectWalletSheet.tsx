import { useState } from "react";
import { Wallet, ShieldCheck, Zap, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { hapticNotification } from "@/lib/haptics";

interface ConnectWalletSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (address?: string, currency?: "TON" | "USDT") => Promise<unknown>;
  title?: string;
  subtitle?: string;
}

export function ConnectWalletSheet({
  open,
  onOpenChange,
  onConnect,
  title = "Підключіть Telegram Wallet",
  subtitle = "Миттєві оплати, поповнення та виводи прямо в Telegram — без карток і форм.",
}: ConnectWalletSheetProps) {
  const [address, setAddress] = useState("");
  const [currency, setCurrency] = useState<"TON" | "USDT">("USDT");
  const [isBusy, setIsBusy] = useState(false);

  const handleConnect = async () => {
    setIsBusy(true);
    try {
      await onConnect(address || undefined, currency);
      hapticNotification("success");
      toast.success("Telegram Wallet підключено");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не вдалося підключити гаманець");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            {title}
          </SheetTitle>
        </SheetHeader>

        <p className="text-sm text-muted-foreground mt-2">{subtitle}</p>

        <div className="grid grid-cols-2 gap-3 my-4">
          <div className="rounded-xl border border-border p-3">
            <Zap className="h-4 w-4 text-primary mb-1" />
            <p className="text-xs font-medium text-foreground">Миттєво</p>
            <p className="text-[11px] text-muted-foreground">Оплата і вивід за секунди</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <ShieldCheck className="h-4 w-4 text-success mb-1" />
            <p className="text-xs font-medium text-foreground">Безпечно</p>
            <p className="text-[11px] text-muted-foreground">Все всередині Telegram</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Адреса гаманця (необов'язково)</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="UQ... або адреса USDT (TON)"
            />
          </div>
          <div className="flex gap-2">
            {(["USDT", "TON"] as const).map((c) => (
              <Button
                key={c}
                type="button"
                variant={currency === c ? "default" : "outline"}
                className="flex-1"
                onClick={() => setCurrency(c)}
              >
                {c}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Пізніше
          </Button>
          <Button className="flex-1" onClick={handleConnect} disabled={isBusy}>
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wallet className="h-4 w-4 mr-2" />}
            Підключити
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
