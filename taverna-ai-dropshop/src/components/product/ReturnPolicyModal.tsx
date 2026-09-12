import { Package, Check, X, AlertTriangle, Scale } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ReturnPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ReturnPolicyModal({ isOpen, onClose }: ReturnPolicyModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Повернення та обмін
          </DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {/* Legal basis */}
            <div className="bg-primary/5 border border-primary/10 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Scale className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-foreground text-sm">Згідно законодавства України</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Закон України «Про захист прав споживачів» (ст. 9)
                  </p>
                </div>
              </div>
            </div>
            
            {/* Returnable items */}
            <div className="bg-success/5 border border-success/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Check className="h-5 w-5 text-success" />
                <p className="font-semibold text-success">Підлягають поверненню/обміну:</p>
              </div>
              <ul className="text-sm text-foreground space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-success">✓</span>
                  Одяг та взуття (зі збереженням товарного вигляду)
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-success">✓</span>
                  Сумки, рюкзаки та аксесуари
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-success">✓</span>
                  Електроніка (з непорушеною упаковкою)
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-success">✓</span>
                  Товари для дому та побуту
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-success">✓</span>
                  Спортивний інвентар та екіпірування
                </li>
              </ul>
            </div>
            
            {/* Non-returnable items */}
            <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <X className="h-5 w-5 text-destructive" />
                <p className="font-semibold text-destructive">НЕ підлягають поверненню:</p>
              </div>
              <ul className="text-sm text-foreground space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-destructive">✗</span>
                  Натільна білизна та купальники
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-destructive">✗</span>
                  Парфумерія та косметика (з порушеною упаковкою)
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-destructive">✗</span>
                  Товари особистої гігієни
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-destructive">✗</span>
                  Лікарські засоби та медичні вироби
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-destructive">✗</span>
                  Друкована продукція
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-destructive">✗</span>
                  Товари з індивідуальним замовленням
                </li>
              </ul>
            </div>
            
            {/* Conditions */}
            <div className="bg-warning/5 border border-warning/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <p className="font-semibold text-foreground text-sm">Умови повернення:</p>
              </div>
              <ul className="text-xs text-muted-foreground space-y-1.5">
                <li>• Термін: <span className="font-medium text-foreground">14 днів</span> з моменту отримання</li>
                <li>• Товар не був у використанні</li>
                <li>• Збережено товарний вигляд, бірки та пломби</li>
                <li>• Наявність чеку або підтвердження покупки</li>
                <li>• Оригінальна упаковка (бажано)</li>
              </ul>
            </div>
            
            {/* How to return */}
            <div className="bg-muted/50 rounded-xl p-4">
              <p className="font-semibold text-foreground text-sm mb-2">📦 Як оформити повернення:</p>
              <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>Зверніться до служби підтримки через чат</li>
                <li>Вкажіть номер замовлення та причину</li>
                <li>Отримайте інструкції для відправки</li>
                <li>Надішліть товар Новою Поштою</li>
                <li>Кошти повернуться протягом 3-5 днів</li>
              </ol>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
