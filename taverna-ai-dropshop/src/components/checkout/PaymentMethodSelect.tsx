import { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Banknote, CreditCard, Wallet, Check, Smartphone, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type PaymentMethod = "cash" | "card" | "mono" | "applepay" | "googlepay" | "telegram_wallet" | "taverna_balance";
export type PaymentType = "full_prepayment" | "markup_only" | "cod";

interface PaymentMethodSelectProps {
  value: PaymentMethod;
  onChange: (value: PaymentMethod) => void;
  paymentType: PaymentType;
  onPaymentTypeChange: (value: PaymentType) => void;
  error?: string;
  /** Рахунок Taverna доступний лише для ролей із реальним балансом */
  allowTavernaBalance?: boolean;
}

const paymentMethods: {
  id: PaymentMethod;
  label: string;
  description: string;
  icon: React.ReactNode;
  disabled?: boolean;
  badge?: string;
  online?: boolean;
}[] = [
  {
    id: "taverna_balance",
    label: "Рахунок Taverna",
    description: "Баланс + бонуси в один тап",
    icon: (
      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
        <Wallet className="h-4 w-4 text-primary-foreground" />
      </div>
    ),
    badge: "1 тап",
    online: true,
  },
  {
    id: "cash",
    label: "Оплата при отриманні",
    description: "Готівкою або карткою на пошті",
    icon: <Banknote className="h-6 w-6" />,
    online: false,
  },
  {
    id: "card",
    label: "Картка Visa/Mastercard",
    description: "Безпечна онлайн оплата",
    icon: <CreditCard className="h-6 w-6" />,
    disabled: true,
    badge: "Скоро",
    online: true,
  },
  {
    id: "mono",
    label: "MonoPay",
    description: "Швидка оплата через Monobank",
    icon: (
      <div className="w-6 h-6 rounded-full bg-foreground flex items-center justify-center">
        <span className="text-background text-xs font-bold">M</span>
      </div>
    ),
    disabled: true,
    badge: "Скоро",
    online: true,
  },
  {
    id: "applepay",
    label: "Apple Pay",
    description: "Оплата через Apple Wallet",
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
        <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
      </svg>
    ),
    disabled: true,
    badge: "Скоро",
    online: true,
  },
  {
    id: "googlepay",
    label: "Google Pay",
    description: "Оплата через Google Wallet",
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6">
        <path fill="#4285F4" d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.345-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z"/>
      </svg>
    ),
    disabled: true,
    badge: "Скоро",
    online: true,
  },
  {
    id: "telegram_wallet",
    label: "Telegram Wallet",
    description: "Миттєва оплата в Telegram (TON/USDT)",
    icon: (
      <div className="w-6 h-6 rounded-full bg-[hsl(200,85%,50%)] flex items-center justify-center">
        <Wallet className="h-4 w-4 text-white" />
      </div>
    ),
    badge: "Миттєво",
    online: true,
  },
];

const paymentTypeOptions: {
  id: PaymentType;
  label: string;
  description: string;
}[] = [
  {
    id: "full_prepayment",
    label: "Повна оплата",
    description: "Оплатіть 100% вартості зараз",
  },
  {
    id: "markup_only",
    label: "Часткова оплата (Лише націнка)",
    description: "Оплатіть лише націнку платформи. Решту — накладним платежем при отриманні",
  },
  {
    id: "cod",
    label: "При отриманні (Накладений платіж)",
    description: "Оплатіть повну суму на пошті при отриманні",
  },
];

export const PaymentMethodSelect = ({
  value,
  onChange,
  paymentType,
  onPaymentTypeChange,
  error,
  allowTavernaBalance = false,
}: PaymentMethodSelectProps) => {
  // Keep payment method in sync with payment type
  useEffect(() => {
    if (paymentType === "cod" && value !== "cash") {
      onChange("cash");
    } else if (paymentType === "markup_only" && value === "cash") {
      onChange("telegram_wallet");
    }
  }, [paymentType, value, onChange]);

  const visibleMethods = paymentType === "cod"
    ? paymentMethods.filter((m) => m.id === "cash")
    : paymentMethods.filter((m) => {
        if (m.id === "taverna_balance" && !allowTavernaBalance) return false;
        if (paymentType === "markup_only" && m.id === "cash") return false;
        return true;
      });

  return (
    <div className="space-y-5">
      {/* Payment Type Selection */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-foreground">
          Вид оплати
          <span className="text-destructive ml-1">*</span>
        </Label>
        <RadioGroup
          value={paymentType}
          onValueChange={(val) => onPaymentTypeChange(val as PaymentType)}
          className="space-y-2"
        >
          {paymentTypeOptions.map((option) => {
            const isSelected = paymentType === option.id;
            return (
              <label
                key={option.id}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                  isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <RadioGroupItem
                  value={option.id}
                  className="sr-only"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground text-sm">{option.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {option.description}
                  </p>
                </div>
                {isSelected && (
                  <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
              </label>
            );
          })}
        </RadioGroup>
      </div>

      {/* Payment Method Selection */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-foreground">
          Спосіб оплати
          <span className="text-destructive ml-1">*</span>
        </Label>

        {paymentType === "cod" ? (
          <div className="flex items-center gap-3 p-3 rounded-xl border border-primary/20 bg-primary/5 ring-1 ring-primary">
            <div className="w-11 h-11 rounded-xl bg-primary/20 text-primary flex items-center justify-center shrink-0">
              <Banknote className="h-6 w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-medium text-foreground text-sm">Оплата при отриманні на пошті</span>
              <p className="text-xs text-muted-foreground truncate">Готівкою або карткою у відділенні</p>
            </div>
            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
              <Check className="h-4 w-4 text-primary-foreground" />
            </div>
          </div>
        ) : (
          <RadioGroup
            value={value}
            onValueChange={(val) => onChange(val as PaymentMethod)}
            className="space-y-2"
          >
            {visibleMethods.map((method) => {
              const isSelected = value === method.id;
              const isDisabled = method.disabled;

              return (
                <label
                  key={method.id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all relative overflow-hidden",
                    isSelected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/50",
                    isDisabled && "opacity-60 cursor-not-allowed"
                  )}
                >
                  <RadioGroupItem
                    value={method.id}
                    disabled={isDisabled}
                    className="sr-only"
                  />

                  {/* Icon */}
                  <div
                    className={cn(
                      "w-11 h-11 rounded-xl flex items-center justify-center shrink-0",
                      isSelected ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {method.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground text-sm">{method.label}</span>
                      {method.badge && (
                        <span className="text-[10px] font-medium bg-warning/20 text-warning px-1.5 py-0.5 rounded-full">
                          {method.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{method.description}</p>
                  </div>

                  {/* Selection indicator */}
                  {isSelected && (
                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                      <Check className="h-4 w-4 text-primary-foreground" />
                    </div>
                  )}
                </label>
              );
            })}
          </RadioGroup>
        )}
      </div>

      {error && <p className="text-xs text-destructive mt-2">{error}</p>}

      {/* Payment Security Badge */}
      <div className="flex items-center justify-center gap-2 pt-2">
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-success fill-current">
          <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
        </svg>
        <span className="text-xs text-muted-foreground">Безпечна оплата з шифруванням даних</span>
      </div>
    </div>
  );
};
