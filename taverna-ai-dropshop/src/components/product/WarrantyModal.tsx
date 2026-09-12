import { Shield, AlertCircle, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WarrantyModalProps {
  isOpen: boolean;
  onClose: () => void;
  warrantyInfo?: string;
  productName: string;
}

export function WarrantyModal({ isOpen, onClose, warrantyInfo, productName }: WarrantyModalProps) {
  const hasWarranty = warrantyInfo && warrantyInfo.toLowerCase() !== "без гарантії" && warrantyInfo.trim() !== "";
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Гарантія
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{productName}</span>
          </div>
          
          {hasWarranty ? (
            <div className="bg-success/10 border border-success/20 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Check className="h-5 w-5 text-success shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-success">Гарантія надається</p>
                  <p className="text-sm text-foreground mt-1">{warrantyInfo}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-muted/50 border border-border rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-muted-foreground">Без гарантії</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    На даний товар гарантія виробника не поширюється. 
                    Однак ви можете скористатися правом на повернення протягом 14 днів.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
            <p className="font-medium mb-1">📋 Загальні умови гарантії:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Гарантія діє з моменту отримання товару</li>
              <li>Зберігайте чек та упаковку для гарантійного обслуговування</li>
              <li>Гарантія не поширюється на механічні пошкодження</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
