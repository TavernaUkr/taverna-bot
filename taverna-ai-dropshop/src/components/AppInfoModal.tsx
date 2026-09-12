import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Info, Users, ShoppingBag, Shield, MessageCircle, ExternalLink } from "lucide-react";

interface AppInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AppInfoModal = ({ isOpen, onClose }: AppInfoModalProps) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" />
            Про Taverna Group
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* About */}
          <section className="space-y-2">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-primary" />
              Що таке Taverna?
            </h3>
            <p className="text-muted-foreground">
              Taverna Group — український маркетплейс тактичного спорядження. 
              Ми об'єднуємо надійних постачальників та покупців в одному зручному Telegram-додатку.
            </p>
          </section>

          {/* For Customers */}
          <section className="space-y-2">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-accent" />
              Для покупців
            </h3>
            <ul className="text-muted-foreground space-y-1 list-disc list-inside">
              <li>Широкий вибір тактичного спорядження</li>
              <li>Перевірені постачальники</li>
              <li>Доставка Новою Поштою по всій Україні</li>
              <li>Оплата при отриманні або онлайн</li>
              <li>Гарантія обміну та повернення</li>
            </ul>
          </section>

          {/* For Suppliers */}
          <section className="space-y-2">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-warning" />
              Для постачальників
            </h3>
            <ul className="text-muted-foreground space-y-1 list-disc list-inside">
              <li>Безкоштовна реєстрація</li>
              <li>Автоматичний імпорт товарів з XML</li>
              <li>AI-генерація описів для маркетплейсів</li>
              <li>Просування в Telegram-каналі</li>
              <li>Панель управління замовленнями</li>
            </ul>
          </section>

          {/* Contacts */}
          <section className="space-y-2">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-live" />
              Контакти
            </h3>
            <div className="space-y-2">
              <a 
                href="https://t.me/taverna_ukr_group" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Telegram канал: @taverna_ukr_group
              </a>
              <a 
                href="https://t.me/taverna_support_bot" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Підтримка: @taverna_support_bot
              </a>
            </div>
          </section>

          {/* Legal */}
          <section className="space-y-2 pt-2 border-t border-border">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              Правова інформація
            </h3>
            <p className="text-xs text-muted-foreground">
              Taverna Group діє відповідно до законодавства України. 
              Всі постачальники проходять верифікацію. Ми не несемо відповідальності 
              за якість товарів, але допомагаємо вирішувати спори між покупцями та продавцями.
            </p>
            <p className="text-xs text-muted-foreground">
              © 2024 Taverna Group. Всі права захищено.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};