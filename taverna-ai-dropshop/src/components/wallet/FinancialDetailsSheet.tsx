import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Receipt, Percent } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const fmt = (v: number) => Number(v || 0).toLocaleString("uk-UA", { maximumFractionDigits: 0 });

export type FinancialTab = "income" | "margin";

interface Entry {
  orderId: string;
  date: string;
  shop: string;
  total: number;
  income: number;
  margin: number;
  paid: boolean;
}

/** Демо-дані розбивки замовлень: скільки з кожного замовлення пішло постачальнику й платформі. */
const ENTRIES: Entry[] = [
  { orderId: "#1042-A", date: "07.09.2026", shop: "Tactical Pro", total: 1350, income: 1200, margin: 150, paid: true },
  { orderId: "#1041-B", date: "07.09.2026", shop: "Tactical Pro", total: 2480, income: 2170, margin: 310, paid: true },
  { orderId: "#1039-A", date: "06.09.2026", shop: "Military Store", total: 890, income: 780, margin: 110, paid: false },
  { orderId: "#1036-C", date: "05.09.2026", shop: "Urban Gear", total: 4120, income: 3560, margin: 560, paid: true },
  { orderId: "#1033-A", date: "04.09.2026", shop: "Tactical Pro", total: 760, income: 660, margin: 100, paid: false },
  { orderId: "#1030-B", date: "03.09.2026", shop: "Military Store", total: 3240, income: 2820, margin: 420, paid: true },
  { orderId: "#1028-A", date: "02.09.2026", shop: "Urban Gear", total: 1580, income: 1370, margin: 210, paid: true },
  { orderId: "#1025-D", date: "01.09.2026", shop: "Tactical Pro", total: 5300, income: 4590, margin: 710, paid: true },
];

interface FinancialDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: FinancialTab;
}

/** Прозора розбивка: дохід постачальника та знята націнка платформи по кожному замовленню. */
export function FinancialDetailsSheet({ open, onOpenChange, initialTab = "income" }: FinancialDetailsSheetProps) {
  const totals = useMemo(
    () => ({
      income: ENTRIES.reduce((s, e) => s + e.income, 0),
      margin: ENTRIES.reduce((s, e) => s + e.margin, 0),
      unpaidMargin: ENTRIES.filter((e) => !e.paid).reduce((s, e) => s + e.margin, 0),
      turnover: ENTRIES.reduce((s, e) => s + e.total, 0),
    }),
    [],
  );

  const Row = ({ e, mode }: { e: Entry; mode: FinancialTab }) => (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{e.orderId}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {e.date} · {e.shop}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-foreground">{fmt(e.total)}₴</p>
          <p className="text-[10px] text-muted-foreground">сума замовлення</p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <span
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            mode === "income" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
          )}
        >
          <ArrowUpRight className="h-3 w-3" /> +{fmt(e.income)}₴ дохід
        </span>
        <span
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            mode === "margin" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground",
          )}
        >
          <ArrowDownRight className="h-3 w-3" /> −{fmt(e.margin)}₴ націнка
        </span>
        {mode === "margin" && (
          <span
            className={cn(
              "ml-auto text-[10px] font-medium",
              e.paid ? "text-success" : "text-warning",
            )}
          >
            {e.paid ? "утримано" : "до сплати"}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[88vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Деталізація фінансів</SheetTitle>
          <SheetDescription>Скільки з кожного замовлення отримали ви, а скільки — платформа</SheetDescription>
        </SheetHeader>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-border bg-card p-2.5">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Receipt className="h-3 w-3" /> Оборот</p>
            <p className="text-sm font-bold text-foreground">{fmt(totals.turnover)}₴</p>
          </div>
          <div className="rounded-xl border border-success/30 bg-success/10 p-2.5">
            <p className="text-[10px] text-muted-foreground">Ваш дохід</p>
            <p className="text-sm font-bold text-success">+{fmt(totals.income)}₴</p>
          </div>
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-2.5">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Percent className="h-3 w-3" /> Націнка</p>
            <p className="text-sm font-bold text-destructive">−{fmt(totals.margin)}₴</p>
          </div>
        </div>

        <Tabs defaultValue={initialTab} className="mt-3">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="income" className="text-xs">Дохід з замовлень</TabsTrigger>
            <TabsTrigger value="margin" className="text-xs">Вся знята націнка</TabsTrigger>
          </TabsList>

          <TabsContent value="income" className="mt-3 space-y-2 pb-6">
            {ENTRIES.map((e) => <Row key={e.orderId} e={e} mode="income" />)}
          </TabsContent>

          <TabsContent value="margin" className="mt-3 space-y-2 pb-6">
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-3">
              <p className="text-xs text-muted-foreground">Ще не утримано з післяплат</p>
              <p className="text-lg font-bold text-warning">{fmt(totals.unpaidMargin)}₴</p>
            </div>
            {ENTRIES.map((e) => <Row key={e.orderId} e={e} mode="margin" />)}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
