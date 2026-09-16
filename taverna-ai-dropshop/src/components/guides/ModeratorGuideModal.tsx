import { Flag, Shield } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useModalHistory } from "@/hooks/useModalHistory";
import { GuideNumberedSteps } from "@/components/guides/GuideNumberedSteps";

interface ModeratorGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STEPS = [
  {
    title: "Черга скарг",
    text: "Відкрийте панель модератора і перегляньте нові скарги. Перевірте товар, замовлення та вкладені докази.",
  },
  {
    title: "Повернення",
    text: "Підтвердіть або відхиліть заявку. Коротко зафіксуйте причину, щоб клієнт і магазин бачили рішення.",
  },
  {
    title: "Чати спорів",
    text: "Відповідайте в чаті між клієнтом і магазином. Не передавайте особисті контакти сторін.",
  },
  {
    title: "Ескалація адміну",
    text: "Складні кейси, підозра на шахрайство або повторні порушення передайте адміністратору.",
  },
];

export function ModeratorGuideModal({ isOpen, onClose }: ModeratorGuideModalProps) {
  useModalHistory(isOpen, onClose);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-lg max-h-[90vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 pb-0 w-full max-w-full overflow-hidden">
          <DialogTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
            <Shield className="h-5 w-5 text-orange-500" />
            Інструкція модератора
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[75vh] w-full max-w-full overflow-hidden">
          <div className="p-4 pt-2 space-y-4 w-full max-w-full overflow-hidden break-words whitespace-normal">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Flag className="h-4 w-4 text-orange-500" />
              Як модерувати платформу?
            </h3>
            <GuideNumberedSteps steps={STEPS} />
            <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-xl">
              <p className="text-xs text-muted-foreground">
                Рішення модератора має бути коротким і зрозумілим. У сумніві — не блокуйте одразу, ескалюйте адміну.
              </p>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
