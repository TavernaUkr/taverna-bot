import { useState } from "react";
import { Flag, AlertTriangle, Tag, MessageSquare, ShieldAlert, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { triggerHapticFeedback } from "@/lib/haptics";

const REPORT_REASONS = [
  { value: "counterfeit", label: "Підробка / Контрафакт", icon: ShieldAlert },
  { value: "wrong_category", label: "Неправильна категорія", icon: Tag },
  { value: "misleading", label: "Оманлива інформація", icon: AlertTriangle },
  { value: "offensive", label: "Образливий контент", icon: MessageSquare },
  { value: "other", label: "Інше", icon: Flag },
] as const;

interface ReportProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  productId: string;
  productName: string;
}

export function ReportProductModal({
  isOpen,
  onClose,
  productId,
  productName,
}: ReportProductModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedReason) {
      toast.error("Оберіть причину скарги");
      triggerHapticFeedback("notification", "warning");
      return;
    }

    setIsSubmitting(true);
    triggerHapticFeedback("impact", "light");

    try {
      // Get telegram ID if available
      // @ts-ignore - Telegram WebApp types
      const telegramId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id?.toString() || null;
      const { error } = await supabase.from("reports").insert({
        product_id: productId,
        reason: selectedReason,
        description: description.trim() || null,
        reporter_telegram_id: telegramId,
      });

      if (error) throw error;

      triggerHapticFeedback("notification", "success");
      toast.success("Скаргу надіслано. Дякуємо за допомогу!");
      
      // Reset and close
      setSelectedReason("");
      setDescription("");
      onClose();
    } catch (err) {
      console.error("Error submitting report:", err);
      triggerHapticFeedback("notification", "error");
      toast.error("Помилка надсилання скарги");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Flag className="h-5 w-5" />
            Поскаржитись на товар
          </DialogTitle>
          <DialogDescription className="text-left">
            Повідомте нам про проблему з товаром "{productName}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Reason Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Причина скарги *</Label>
            <RadioGroup
              value={selectedReason}
              onValueChange={(value) => {
                setSelectedReason(value);
                triggerHapticFeedback("selection");
              }}
              className="space-y-2"
            >
              <AnimatePresence mode="wait">
                {REPORT_REASONS.map((reason, index) => {
                  const Icon = reason.icon;
                  const isSelected = selectedReason === reason.value;
                  
                  return (
                    <motion.div
                      key={reason.value}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <label
                        className={`
                          flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border-2
                          ${isSelected 
                            ? "bg-destructive/10 border-destructive text-destructive" 
                            : "bg-muted/50 border-transparent hover:bg-muted"
                          }
                        `}
                      >
                        <RadioGroupItem value={reason.value} className="sr-only" />
                        <Icon className={`h-5 w-5 ${isSelected ? "text-destructive" : "text-muted-foreground"}`} />
                        <span className="text-sm font-medium">{reason.label}</span>
                        {isSelected && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="ml-auto w-5 h-5 rounded-full bg-destructive flex items-center justify-center"
                          >
                            <svg className="w-3 h-3 text-destructive-foreground" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </motion.div>
                        )}
                      </label>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </RadioGroup>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm font-medium">
              Додатковий опис (необов'язково)
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Опишіть проблему детальніше..."
              rows={3}
              className="resize-none"
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground text-right">
              {description.length}/500
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1"
          >
            Скасувати
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedReason}
            className="flex-1"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Надсилання...
              </>
            ) : (
              <>
                <Flag className="h-4 w-4 mr-2" />
                Надіслати
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
