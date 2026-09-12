import { Truck, MapPin, Clock, Package, CreditCard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DeliveryInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  estimatedCost?: number;
  productPrice: number;
}

export function DeliveryInfoModal({ isOpen, onClose, estimatedCost, productPrice }: DeliveryInfoModalProps) {
  // Calculate estimated delivery cost based on product price
  // This is a rough estimate until full API integration
  const calculateEstimate = () => {
    if (estimatedCost) return estimatedCost;
    
    // Base cost + weight estimate based on price
    // Cheaper items are usually lighter
    if (productPrice < 500) return 50;
    if (productPrice < 1000) return 60;
    if (productPrice < 3000) return 70;
    if (productPrice < 10000) return 90;
    return 120;
  };

  const deliveryCost = calculateEstimate();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            Доставка
          </DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {/* Estimated cost */}
            <div className="bg-primary/5 border border-primary/10 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">Орієнтовна вартість</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Нова Пошта</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-primary">від {deliveryCost} ₴</p>
                  <p className="text-xs text-muted-foreground">до відділення</p>
                </div>
              </div>
            </div>

            {/* Delivery options */}
            <div className="space-y-3">
              <h4 className="font-semibold text-sm text-foreground">Способи доставки:</h4>
              
              <div className="bg-muted/50 rounded-xl p-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#e31e24]/10 flex items-center justify-center shrink-0">
                    <Package className="h-5 w-5 text-[#e31e24]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-foreground text-sm">Нова Пошта — Відділення</p>
                    <p className="text-xs text-muted-foreground">від {deliveryCost} ₴ • 1-3 дні</p>
                  </div>
                </div>
              </div>

              <div className="bg-muted/50 rounded-xl p-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#e31e24]/10 flex items-center justify-center shrink-0">
                    <MapPin className="h-5 w-5 text-[#e31e24]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-foreground text-sm">Нова Пошта — Кур'єр</p>
                    <p className="text-xs text-muted-foreground">від {deliveryCost + 30} ₴ • 1-3 дні</p>
                  </div>
                </div>
              </div>

              <div className="bg-muted/50 rounded-xl p-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#FFD700]/10 flex items-center justify-center shrink-0">
                    <Package className="h-5 w-5 text-[#F7941D]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-foreground text-sm">Укрпошта</p>
                    <p className="text-xs text-muted-foreground">від {Math.round(deliveryCost * 0.7)} ₴ • 3-7 днів</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment info */}
            <div className="bg-muted/30 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <p className="font-medium text-sm text-foreground">Оплата доставки:</p>
              </div>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Накладений платіж (оплата при отриманні)</li>
                <li>• Передоплата на карту</li>
                <li>• Безкоштовна доставка від 2000 ₴</li>
              </ul>
            </div>

            {/* Timing */}
            <div className="flex items-center gap-3 p-3 bg-success/5 border border-success/10 rounded-xl">
              <Clock className="h-5 w-5 text-success" />
              <div>
                <p className="font-medium text-sm text-foreground">Відправка за 1-2 дні</p>
                <p className="text-xs text-muted-foreground">Замовлення до 14:00 — відправка сьогодні</p>
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
