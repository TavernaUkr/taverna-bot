import { Package, Truck, Banknote, Tag, Wallet, Sparkles, Info } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { CartItem } from "@/components/CartModal";
import { PaymentType } from "./PaymentMethodSelect";

interface OrderSummaryProps {
  items: CartItem[];
  subtotal: number;
  deliveryCost: number;
  total: number;
  promoDiscount?: number;
  bonusesUsed?: number;
  personalBonusDiscount?: number;
  personalBonusName?: string;
  promoCode?: string;
  paymentType?: PaymentType;
  amountToPayNow?: number;
}

export const OrderSummary = ({
  items,
  subtotal,
  deliveryCost,
  total,
  promoDiscount = 0,
  bonusesUsed = 0,
  personalBonusDiscount = 0,
  personalBonusName,
  promoCode,
  paymentType = "full_prepayment",
  amountToPayNow = total,
}: OrderSummaryProps) => {
  const remainingAtPickup = Math.max(0, total - amountToPayNow);

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Package className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-foreground">Ваше замовлення</h3>
      </div>

      {/* Items */}
      <div className="space-y-3 max-h-40 overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} className="flex gap-3">
            <img
              src={item.image}
              alt={item.name}
              className="w-12 h-12 rounded-lg object-cover bg-muted"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground line-clamp-1">
                {item.name}
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{item.quantity} шт.</span>
                {item.size && <span>• {item.size}</span>}
                {item.color && <span>• {item.color}</span>}
              </div>
            </div>
            <p className="text-sm font-medium text-foreground whitespace-nowrap">
              {(item.price * item.quantity).toLocaleString()} ₴
            </p>
          </div>
        ))}
      </div>

      <Separator />

      {/* Totals */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Товари ({items.length})</span>
          <span className="text-foreground">{subtotal.toLocaleString()} ₴</span>
        </div>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Truck className="h-4 w-4" />
            <span>Доставка</span>
          </div>
          <span className="text-foreground">
            {deliveryCost > 0 ? `${deliveryCost.toLocaleString()} ₴` : "Безкоштовно"}
          </span>
        </div>

        {/* Discount breakdown */}
        {promoDiscount > 0 && (
          <div className="flex justify-between items-center text-emerald-500">
            <div className="flex items-center gap-1">
              <Tag className="h-4 w-4" />
              <span>Промокод {promoCode}</span>
            </div>
            <span>-{promoDiscount.toLocaleString()} ₴</span>
          </div>
        )}
        {bonusesUsed > 0 && (
          <div className="flex justify-between items-center text-primary">
            <div className="flex items-center gap-1">
              <Wallet className="h-4 w-4" />
              <span>Бонуси</span>
            </div>
            <span>-{bonusesUsed.toLocaleString()} ₴</span>
          </div>
        )}
        {personalBonusDiscount > 0 && (
          <div className="flex justify-between items-center text-amber-500">
            <div className="flex items-center gap-1">
              <Sparkles className="h-4 w-4" />
              <span>{personalBonusName || "Персональний бонус"}</span>
            </div>
            <span>-{personalBonusDiscount.toLocaleString()} ₴</span>
          </div>
        )}
      </div>

      <Separator />

      {/* Payment type helper */}
      {paymentType === "markup_only" && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-2.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
          <span>
            Часткова оплата: зараз сплачується націнка платформи (~25%). Решту суми потрібно буде сплатити при отриманні накладним платежем.
          </span>
        </div>
      )}

      {/* To pay now */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-primary" />
          <span className="font-semibold text-foreground">Сума до сплати зараз</span>
        </div>
        <span className="text-xl font-bold text-primary">
          {amountToPayNow.toLocaleString()} ₴
        </span>
      </div>

      {/* COD / remaining amount notices */}
      {paymentType === "cod" && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">До сплати на пошті:</span>
          <span className="text-lg font-bold text-warning">{total.toLocaleString()} ₴</span>
        </div>
      )}
      {paymentType === "markup_only" && remainingAtPickup > 0 && (
        <div className="bg-muted/50 rounded-xl p-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Решта при отриманні:</span>
          <span className="text-base font-semibold text-foreground">{remainingAtPickup.toLocaleString()} ₴</span>
        </div>
      )}
    </div>
  );
};
