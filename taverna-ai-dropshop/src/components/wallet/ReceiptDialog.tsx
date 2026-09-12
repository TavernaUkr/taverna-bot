import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Share2, Check } from "lucide-react";
import type { WalletTransaction } from "@/hooks/useWallet";

const TYPE_LABEL: Record<string, string> = {
  topup: "Поповнення",
  payment: "Оплата замовлення",
  payout: "Вивід коштів",
  bonus_earn: "Нарахування бонусів",
  bonus_spend: "Списання бонусів",
  refund: "Повернення",
  hold: "Заморожено",
};

const PROVIDER_LABEL: Record<string, string> = {
  telegram_wallet: "Telegram Wallet",
  internal: "Рахунок Taverna",
  card: "Картка",
  iban: "IBAN",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  mono: "Mono Pay",
  liqpay: "LiqPay",
  nova_pay: "Nova Pay",
};

interface ReceiptDialogProps {
  transaction: WalletTransaction | null;
  onOpenChange: (open: boolean) => void;
}

export function ReceiptDialog({ transaction, onOpenChange }: ReceiptDialogProps) {
  if (!transaction) return null;
  const r = (transaction.receipt || {}) as Record<string, any>;

  const share = () => {
    const text = `Чек Taverna Group\n${TYPE_LABEL[transaction.type]}\nСума: ${transaction.amount}₴\nМетод: ${PROVIDER_LABEL[transaction.provider] || transaction.provider}\nДата: ${new Date(transaction.created_at).toLocaleString("uk-UA")}`;
    const tg = (window as any).Telegram?.WebApp;
    const url = `https://t.me/share/url?url=${encodeURIComponent("https://t.me")}&text=${encodeURIComponent(text)}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank", "noopener");
  };

  return (
    <Dialog open={!!transaction} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-success/15 flex items-center justify-center">
              <Check className="h-4 w-4 text-success" />
            </span>
            Чек
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <Row label="Операція" value={TYPE_LABEL[transaction.type] || transaction.type} />
          <Row label="Сума" value={`${transaction.amount}₴`} />
          {transaction.bonus_amount > 0 && <Row label="Бонусами" value={`${transaction.bonus_amount}₴`} />}
          {r.fee != null && <Row label="Комісія" value={`${r.fee}₴`} />}
          {r.net != null && <Row label="До зарахування" value={`${r.net}₴`} />}
          <Row label="Метод" value={PROVIDER_LABEL[transaction.provider] || transaction.provider} />
          <Row label="Статус" value={transaction.status === "completed" ? "Виконано" : "В обробці"} />
          {r.order_number && <Row label="Замовлення" value={`#${r.order_number}`} />}
          <Row label="Дата" value={new Date(transaction.created_at).toLocaleString("uk-UA")} />
          <Row label="ID" value={transaction.id.slice(0, 13)} />
          {r.mode === "sandbox" && (
            <p className="text-[11px] text-warning pt-1">Тестовий режим — реальні кошти не рухалися</p>
          )}
        </div>

        <Button variant="outline" className="w-full mt-2" onClick={share}>
          <Share2 className="h-4 w-4 mr-2" />
          Поділитися чеком
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground text-right truncate max-w-[60%]">{value}</span>
    </div>
  );
}
