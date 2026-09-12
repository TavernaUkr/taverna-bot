import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, Sparkles, MapPin, Package, Clock, RotateCcw, PartyPopper } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Risk = "low" | "medium" | "high";

interface AuditShop {
  id: string;
  name: string;
  initials: string;
  categories: string[];
  region: string;
  products: number;
  submitted: string;
  verdict: string;
  risk: Risk;
}

const MOCK_SHOPS: AuditShop[] = [
  {
    id: "a1",
    name: "Tactical Line UA",
    initials: "TL",
    categories: ["Тактичний одяг", "Взуття"],
    region: "Львів",
    products: 148,
    submitted: "2 години тому",
    verdict: "Ціни відповідають ринку. Фото унікальні. Ризик низький",
    risk: "low",
  },
  {
    id: "a2",
    name: "Nord Gear Shop",
    initials: "NG",
    categories: ["Рюкзаки", "Спорядження"],
    region: "Київ",
    products: 92,
    submitted: "5 годин тому",
    verdict: "Частина фото знайдена у інших магазинів. Потрібна перевірка контенту",
    risk: "medium",
  },
  {
    id: "a3",
    name: "Alpha Optics",
    initials: "AO",
    categories: ["Оптика", "Аксесуари"],
    region: "Дніпро",
    products: 61,
    submitted: "вчора",
    verdict: "Документи ФОП підтверджені. Ціни на 4% нижчі за ринок. Ризик низький",
    risk: "low",
  },
  {
    id: "a4",
    name: "Fast Import Store",
    initials: "FI",
    categories: ["Різне", "Електроніка"],
    region: "Одеса",
    products: 512,
    submitted: "вчора",
    verdict: "Ціни занижені на 40%, відсутній EDRPOU, ознаки перепродажу. Високий ризик",
    risk: "high",
  },
  {
    id: "a5",
    name: "Karpaty Outdoor",
    initials: "KO",
    categories: ["Туризм", "Одяг"],
    region: "Івано-Франківськ",
    products: 77,
    submitted: "2 дні тому",
    verdict: "Асортимент унікальний, відгуки з інших майданчиків позитивні. Ризик низький",
    risk: "low",
  },
];

const RISK_LABEL: Record<Risk, string> = {
  low: "Низький ризик",
  medium: "Середній ризик",
  high: "Високий ризик",
};

export function SupplierAuditCards() {
  const [queue, setQueue] = useState<AuditShop[]>(MOCK_SHOPS);
  const [exitDir, setExitDir] = useState<1 | -1>(1);

  const current = queue[0];
  const next = queue[1];

  const decide = (approved: boolean) => {
    if (!current) return;
    setExitDir(approved ? 1 : -1);
    setQueue((q) => q.slice(1));
    toast({
      title: approved ? `Схвалено: ${current.name}` : `Відхилено: ${current.name}`,
      description: "Демо-рішення — заявка в базі не змінюється.",
      variant: approved ? undefined : "destructive",
    });
  };

  return (
    <Card className="border-border/60 bg-card/70 backdrop-blur-xl">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-warning" />
          <p className="text-sm font-semibold text-foreground">AI-аудит магазинів</p>
          <span className="ml-auto text-[11px] text-muted-foreground">
            Залишилось {queue.length}
          </span>
        </div>

        <div className="relative min-h-[290px]">
          {!current && (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <PartyPopper className="h-8 w-8 text-success" />
              <p className="text-sm font-medium text-foreground">Черга порожня</p>
              <p className="text-xs text-muted-foreground">Усі заявки опрацьовані</p>
              <Button variant="outline" size="sm" onClick={() => setQueue(MOCK_SHOPS)}>
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Повторити демо
              </Button>
            </div>
          )}

          {next && (
            <div className="absolute inset-x-2 top-2 h-[260px] rounded-2xl border border-border/50 bg-muted/40 scale-[0.96]" />
          )}

          <AnimatePresence mode="wait" initial={false}>
            {current && (
              <motion.div
                key={current.id}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.4}
                onDragEnd={(_, info) => {
                  if (info.offset.x > 110) decide(true);
                  else if (info.offset.x < -110) decide(false);
                }}
                initial={{ opacity: 0, scale: 0.95, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
                exit={{
                  opacity: 0,
                  x: exitDir * 420,
                  rotate: exitDir * 18,
                  transition: { duration: 0.32, ease: "easeOut" },
                }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                className="relative rounded-2xl border border-border bg-card p-4 shadow-lg cursor-grab active:cursor-grabbing"
              >
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-sm font-bold text-primary-foreground">
                    {current.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{current.name}</p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-2">
                      <span className="flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" /> {current.region}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Package className="h-3 w-3" /> {current.products}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Clock className="h-3 w-3" /> {current.submitted}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {current.categories.map((c, idx) => (
                    <Badge key={`${current.id}-${c}-${idx}`} variant="secondary" className="text-[10px]">
                      {c}
                    </Badge>
                  ))}
                </div>

                <div
                  className={cn(
                    "mt-3 rounded-xl border p-3",
                    current.risk === "low" && "border-success/30 bg-success/5",
                    current.risk === "medium" && "border-warning/35 bg-warning/5",
                    current.risk === "high" && "border-destructive/35 bg-destructive/5",
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Sparkles
                      className={cn(
                        "h-3.5 w-3.5",
                        current.risk === "low" && "text-success",
                        current.risk === "medium" && "text-warning",
                        current.risk === "high" && "text-destructive",
                      )}
                    />
                    <p className="text-[11px] font-semibold text-foreground">AI-вердикт</p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "ml-auto text-[9px] px-1.5 py-0",
                        current.risk === "low" && "border-success/40 text-success",
                        current.risk === "medium" && "border-warning/40 text-warning",
                        current.risk === "high" && "border-destructive/40 text-destructive",
                      )}
                    >
                      {RISK_LABEL[current.risk]}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{current.verdict}</p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button
                    variant="destructive"
                    className="h-12 text-sm font-semibold"
                    onClick={() => decide(false)}
                  >
                    <X className="h-5 w-5 mr-1.5" />
                    Відхилити
                  </Button>
                  <Button
                    className="h-12 text-sm font-semibold bg-success text-success-foreground hover:bg-success/90"
                    onClick={() => decide(true)}
                  >
                    <Check className="h-5 w-5 mr-1.5" />
                    Схвалити
                  </Button>
                </div>

                <p className="mt-2 text-center text-[10px] text-muted-foreground">
                  Свайпніть картку вправо — схвалити, вліво — відхилити
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}
