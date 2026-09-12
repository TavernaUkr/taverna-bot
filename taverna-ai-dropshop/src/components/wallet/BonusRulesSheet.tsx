import { Star, Percent, TrendingUp, Users, RotateCcw, Clock } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

const RULES = [
  {
    icon: Star,
    tone: "text-rating",
    bg: "bg-rating/15",
    title: "Нарахування",
    text: "Бонуси нараховуються після отримання замовлення, а також за відгук із фото.",
  },
  {
    icon: Percent,
    tone: "text-primary",
    bg: "bg-primary/15",
    title: "Ліміт оплати",
    text: "Бонусами можна оплатити до 7% суми кошика — решта карткою або Telegram Wallet.",
  },
  {
    icon: TrendingUp,
    tone: "text-success",
    bg: "bg-success/15",
    title: "Множник рангу",
    text: "Чим вищий ранг, тим більший множник: від ×1 для «Новачка» до максимуму для «Легенди».",
  },
  {
    icon: Users,
    tone: "text-live",
    bg: "bg-live/15",
    title: "Реферали",
    text: "За кожного друга, який завершить перше замовлення, ви отримуєте бонуси на рахунок.",
  },
  {
    icon: RotateCcw,
    tone: "text-warning",
    bg: "bg-warning/15",
    title: "Повернення",
    text: "Використані бонуси повертаються, якщо замовлення скасовано або оформлено повернення.",
  },
  {
    icon: Clock,
    tone: "text-muted-foreground",
    bg: "bg-muted",
    title: "Термін дії",
    text: "Бонуси активні, доки ви робите хоча б одне замовлення на рік.",
  },
];

interface BonusRulesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Правила бонусної програми — окреме вікно, щоб не перевантажувати рахунок текстом. */
export function BonusRulesSheet({ open, onOpenChange }: BonusRulesSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[88vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Правила бонусної програми</SheetTitle>
          <SheetDescription>Коротко про те, як заробляти та витрачати бонуси</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2.5 pb-4">
          {RULES.map((r) => (
            <div key={r.title} className="flex gap-3 rounded-xl border border-border bg-card p-3">
              <div className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${r.bg}`}>
                <r.icon className={`h-4.5 w-4.5 ${r.tone}`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{r.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{r.text}</p>
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
