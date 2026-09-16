import { Package, Store } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useModalHistory } from "@/hooks/useModalHistory";
import { GuideNumberedSteps } from "@/components/guides/GuideNumberedSteps";

interface ManagerGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STEPS = [
  {
    title: "Нові замовлення",
    text: "Відкрийте панель магазину і прийміть нове замовлення. Перевірте наявність і склад.",
  },
  {
    title: "Чат із клієнтом",
    text: "Відповідайте в чаті магазину: розмір, наявність, термін відправки. Не просіть оплату поза платформою.",
  },
  {
    title: "Відправка",
    text: "Оформіть ТТН, змініть статус замовлення на «Відправлено» і додайте трек-номер.",
  },
  {
    title: "Після видачі",
    text: "Коли клієнт отримав товар — закрийте замовлення. Скарги й повернення передайте модератору.",
  },
];

export function ManagerGuideModal({ isOpen, onClose }: ManagerGuideModalProps) {
  useModalHistory(isOpen, onClose);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-lg max-h-[90vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 pb-0 w-full max-w-full overflow-hidden">
          <DialogTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
            <Store className="h-5 w-5 text-primary" />
            Інструкція менеджера
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[75vh] w-full max-w-full overflow-hidden">
          <div className="p-4 pt-2 space-y-4 w-full max-w-full overflow-hidden break-words whitespace-normal">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              Як вести магазин?
            </h3>
            <GuideNumberedSteps steps={STEPS} />
            <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl">
              <p className="text-xs text-muted-foreground">
                Статус замовлення має збігатися з реальною відправкою. Клієнт бачить ТТН у своєму профілі.
              </p>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
