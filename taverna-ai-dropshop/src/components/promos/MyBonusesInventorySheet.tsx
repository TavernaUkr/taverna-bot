import { useMemo } from "react";
import { Gift, Crown, Tag, Truck, Percent, Clock, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hapticSelection } from "@/lib/haptics";
import { toast } from "sonner";

type BonusSource = "personal" | "platform";

interface BonusItem {
  id: string;
  title: string;
  value: string;
  description: string;
  source: BonusSource;
  icon: any;
  expires?: string;
  usedAt?: string;
  status?: "used" | "expired";
}

/** Демо-інвентар бонусів користувача. */
const AVAILABLE: BonusItem[] = [
  { id: "p1", title: "Персональна знижка", value: "-15%", description: "Випав із персонального бонусу", source: "personal", icon: Crown, expires: "до 21.09.2026" },
  { id: "p2", title: "Безкоштовна доставка", value: "до 150₴", description: "Нагорода за 3 місце за тиждень", source: "personal", icon: Truck, expires: "до 14.09.2026" },
  { id: "p3", title: "Бонуси на рахунок", value: "+200₴", description: "Реферальна винагорода", source: "personal", icon: Gift, expires: "без обмежень" },
  { id: "s1", title: "Осіння акція", value: "-10%", description: "На все тактичне спорядження", source: "platform", icon: Tag, expires: "до 30.09.2026" },
  { id: "s2", title: "Промокод TAVERNA5", value: "-5%", description: "На перше замовлення в новому магазині", source: "platform", icon: Percent, expires: "до 12.09.2026" },
];

const HISTORY: BonusItem[] = [
  { id: "h1", title: "Персональна знижка", value: "-20%", description: "Використано в замовленні #1042-A", source: "personal", icon: Crown, usedAt: "07.09.2026", status: "used" },
  { id: "h2", title: "Літній промокод", value: "-15%", description: "Не використано вчасно", source: "platform", icon: Tag, usedAt: "31.08.2026", status: "expired" },
  { id: "h3", title: "Безкоштовна доставка", value: "до 120₴", description: "Використано в замовленні #1030-B", source: "personal", icon: Truck, usedAt: "03.09.2026", status: "used" },
  { id: "h4", title: "Бонуси за відгук", value: "+50₴", description: "Зараховано на бонусний рахунок", source: "platform", icon: Gift, usedAt: "28.08.2026", status: "used" },
];

const sourceTag = (source: BonusSource) =>
  source === "personal"
    ? { label: "Персональний", cls: "bg-warning/15 text-warning" }
    : { label: "Акція платформи", cls: "bg-primary/15 text-primary" };

interface MyBonusesInventorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: "available" | "history";
}

/** Єдиний інвентар бонусів: доступні та історія використання. */
export function MyBonusesInventorySheet({ open, onOpenChange, initialTab = "available" }: MyBonusesInventorySheetProps) {
  const counts = useMemo(
    () => ({
      personal: AVAILABLE.filter((b) => b.source === "personal").length,
      platform: AVAILABLE.filter((b) => b.source === "platform").length,
    }),
    [],
  );

  const apply = (b: BonusItem) => {
    hapticSelection();
    toast.success("Бонус застосовано", { description: `${b.title} · ${b.value}` });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Мої бонуси</SheetTitle>
          <SheetDescription>Персональні нагороди та акції платформи в одному місці</SheetDescription>
        </SheetHeader>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-2.5">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Crown className="h-3 w-3" /> Персональні
            </p>
            <p className="text-lg font-bold text-warning leading-tight">{counts.personal}</p>
          </div>
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-2.5">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Акції
            </p>
            <p className="text-lg font-bold text-primary leading-tight">{counts.platform}</p>
          </div>
        </div>

        <Tabs defaultValue={initialTab} className="mt-3">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="available" className="text-xs">Доступні</TabsTrigger>
            <TabsTrigger value="history" className="text-xs">Історія</TabsTrigger>
          </TabsList>

          <TabsContent value="available" className="mt-3 space-y-2 pb-6">
            {AVAILABLE.map((b) => {
              const tag = sourceTag(b.source);
              return (
                <div key={b.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start gap-3">
                    <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", b.source === "personal" ? "bg-warning/15" : "bg-primary/15")}>
                      <b.icon className={cn("h-4 w-4", b.source === "personal" ? "text-warning" : "text-primary")} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-foreground truncate">{b.title}</p>
                        <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0", tag.cls)}>{tag.label}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{b.description}</p>
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="h-2.5 w-2.5" /> {b.expires}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-extrabold text-foreground">{b.value}</p>
                      <Button size="sm" variant="outline" className="mt-1 h-7 text-[11px] rounded-lg" onClick={() => apply(b)}>
                        Застосувати
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="history" className="mt-3 space-y-2 pb-6">
            {HISTORY.map((b) => (
              <div key={b.id} className="rounded-xl border border-border bg-muted/30 p-3 opacity-70">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
                    <b.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-muted-foreground line-through truncate">{b.title}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{b.description}</p>
                    <p className={cn("text-[10px] flex items-center gap-1 mt-0.5", b.status === "used" ? "text-success" : "text-destructive")}>
                      {b.status === "used" ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                      {b.status === "used" ? `Використано ${b.usedAt}` : `Протерміновано ${b.usedAt}`}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-muted-foreground line-through shrink-0">{b.value}</p>
                </div>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
