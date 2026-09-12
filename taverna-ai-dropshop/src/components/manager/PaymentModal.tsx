import { useState } from "react";
import {
  CreditCard,
  Smartphone,
  Building,
  Globe,
  Loader2,
  Check,
  Shield,
  ExternalLink,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount: number;
  description: string;
  onSuccess?: () => void;
  type: "posting" | "advertising";
}

interface PaymentMethod {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
  badge?: string;
  features: string[];
  commission: string;
}

const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: "monopay",
    name: "MonoPay",
    icon: <Smartphone className="h-6 w-6" />,
    description: "Оплата через Monobank",
    badge: "Популярний",
    features: ["Apple Pay / Google Pay", "Миттєве зарахування", "Кешбек 1%"],
    commission: "0%",
  },
  {
    id: "liqpay",
    name: "LiqPay",
    icon: <Building className="h-6 w-6" />,
    description: "Оплата через ПриватБанк",
    features: ["Visa / Mastercard", "Приват24", "Безпечна оплата"],
    commission: "0%",
  },
  {
    id: "stripe",
    name: "Stripe",
    icon: <Globe className="h-6 w-6" />,
    description: "Міжнародні платежі",
    features: ["Всі картки світу", "Apple Pay / Google Pay", "Підписки"],
    commission: "2.9%",
  },
];

export function PaymentModal({
  open,
  onOpenChange,
  amount,
  description,
  onSuccess,
  type,
}: PaymentModalProps) {
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handlePayment = async () => {
    if (!selectedMethod) {
      toast.error("Оберіть спосіб оплати");
      return;
    }

    setIsProcessing(true);
    
    // Simulate payment processing
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    // In production, this would call the actual payment API
    toast.success(`Оплата через ${PAYMENT_METHODS.find(m => m.id === selectedMethod)?.name} успішна!`);
    setIsProcessing(false);
    onOpenChange(false);
    onSuccess?.();
  };

  const handlePaymentMethodClick = (methodId: string) => {
    if (methodId === "monopay") {
      toast.info("MonoPay API буде підключено найближчим часом");
    } else if (methodId === "liqpay") {
      toast.info("LiqPay API буде підключено найближчим часом");
    } else if (methodId === "stripe") {
      toast.info("Stripe API буде підключено найближчим часом");
    }
    setSelectedMethod(methodId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Оплата {type === "posting" ? "постинга" : "реклами"}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Amount Display */}
          <div className="p-4 bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg border border-primary/20">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">До оплати:</span>
              <span className="text-2xl font-bold text-primary">{amount} ₴</span>
            </div>
          </div>

          {/* Payment Methods */}
          <div className="space-y-2">
            {PAYMENT_METHODS.map((method) => (
              <button
                key={method.id}
                onClick={() => handlePaymentMethodClick(method.id)}
                className={cn(
                  "w-full flex items-start gap-4 p-4 rounded-lg border-2 transition-all text-left",
                  selectedMethod === method.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div
                  className={cn(
                    "w-12 h-12 rounded-lg flex items-center justify-center",
                    selectedMethod === method.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {method.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{method.name}</span>
                    {method.badge && (
                      <Badge variant="secondary" className="text-xs">
                        {method.badge}
                      </Badge>
                    )}
                    {method.commission !== "0%" && (
                      <Badge variant="outline" className="text-xs">
                        +{method.commission}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{method.description}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {method.features.map((feature) => (
                      <span key={feature} className="text-xs text-muted-foreground">
                        • {feature}
                      </span>
                    ))}
                  </div>
                </div>
                {selectedMethod === method.id && (
                  <Check className="h-5 w-5 text-primary shrink-0" />
                )}
              </button>
            ))}
          </div>

          {/* Security Notice */}
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <Shield className="h-4 w-4 text-success shrink-0" />
            <p className="text-xs text-muted-foreground">
              Усі платежі захищені 256-бітним SSL шифруванням
            </p>
          </div>

          {/* Pay Button */}
          <Button
            className="w-full"
            size="lg"
            onClick={handlePayment}
            disabled={!selectedMethod || isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
            ) : (
              <CreditCard className="h-5 w-5 mr-2" />
            )}
            {isProcessing ? "Обробка..." : `Оплатити ${amount} ₴`}
          </Button>

          {/* Terms Notice */}
          <p className="text-xs text-center text-muted-foreground">
            Натискаючи "Оплатити", ви погоджуєтесь з{" "}
            <a href="#" className="text-primary hover:underline">
              умовами сервісу
            </a>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
