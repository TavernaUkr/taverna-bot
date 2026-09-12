import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ShieldCheck, Wallet2, Info, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { hapticNotification, hapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";

const fmt = (v: number) => Number(v || 0).toLocaleString("uk-UA", { maximumFractionDigits: 0 });

interface SupplierDebtCardProps {
  /** Дохід, доступний до виводу */
  earnings: number;
  /** Заборгованість перед платформою (націнка з післяплат) */
  debt: number;
  autoRepay: boolean;
  autoRepayPercent: number;
  onAutoRepayChange: (enabled: boolean) => void;
  onAutoRepayPercentChange: (percent: number) => void;
  onPayDebt: () => void;
  onWithdraw?: () => void;
  readOnly?: boolean;
  /** Відкриває шторку з деталізацією доходу / націнки */
  onOpenDetails?: (tab: "income" | "margin") => void;
}

/** Два основні баланси постачальника: дохід і борг перед платформою. */
export function SupplierDebtCard({
  earnings,
  debt,
  autoRepay,
  autoRepayPercent,
  onAutoRepayChange,
  onAutoRepayPercentChange,
  onPayDebt,
  onWithdraw,
  readOnly,
  onOpenDetails,
}: SupplierDebtCardProps) {
  const hasDebt = debt > 0;
  const withheld = Math.round((earnings * autoRepayPercent) / 100);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* A — Мій дохід */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border bg-gradient-to-br from-success/15 via-success/5 to-transparent p-5"
      >
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Wallet2 className="h-3.5 w-3.5 text-success" /> Мій дохід
        </p>
        <div className="mt-1 text-3xl font-bold text-foreground">
          {fmt(earnings)}<span className="text-xl">₴</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Доступно до виводу зараз</p>
        {onOpenDetails && (
          <Button
            variant="link"
            className="h-auto p-0 mt-1 text-xs text-success"
            onClick={() => { hapticSelection(); onOpenDetails("income"); }}
          >
            Детально
            <ChevronRight className="h-3 w-3 ml-0.5" />
          </Button>
        )}
        {!readOnly && onWithdraw && (
          <Button className="w-full mt-3 h-10" onClick={() => { hapticSelection(); onWithdraw(); }}>
            Вивести
          </Button>
        )}
      </motion.div>

      {/* B — Заборгованість перед платформою */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className={cn(
          "rounded-2xl border p-5",
          hasDebt
            ? "border-destructive/40 bg-gradient-to-br from-destructive/15 via-destructive/5 to-transparent"
            : "border-border bg-card",
        )}
      >
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          {hasDebt
            ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            : <ShieldCheck className="h-3.5 w-3.5 text-success" />}
          Заборгованість перед платформою
        </p>
        <div className={cn("mt-1 text-3xl font-bold", hasDebt ? "text-destructive" : "text-foreground")}>
          {fmt(debt)}<span className="text-xl">₴</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {hasDebt
            ? "Націнка платформи, отримана вами готівкою на післяплатах"
            : "Боргів немає — усі націнки погашені"}
        </p>
        {onOpenDetails && (
          <Button
            variant="link"
            className={cn("h-auto p-0 mt-1 text-xs", hasDebt ? "text-destructive" : "text-muted-foreground")}
            onClick={() => { hapticSelection(); onOpenDetails("margin"); }}
          >
            Детально
            <ChevronRight className="h-3 w-3 ml-0.5" />
          </Button>
        )}
        {hasDebt && !readOnly && (
          <Button
            variant="destructive"
            className="w-full mt-3 h-10"
            onClick={() => { hapticNotification("warning"); onPayDebt(); }}
          >
            Погасити борг
          </Button>
        )}
      </motion.div>

      {/* Авто-погашення — лише для власника коштів */}
      {!readOnly && (
      <div className="sm:col-span-2 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Авто-погашення боргу з доходу</p>
            <p className="text-[11px] text-muted-foreground">
              Частина кожного надходження автоматично йде на погашення націнки
            </p>
          </div>
          <Switch
            checked={autoRepay}
            disabled={readOnly}
            onCheckedChange={(v) => { hapticSelection(); onAutoRepayChange(v); }}
          />
        </div>

        <div className={cn("mt-4 transition-opacity", !autoRepay && "opacity-40 pointer-events-none")}>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-muted-foreground">Відсоток утримання</span>
            <span className="font-semibold text-foreground">{autoRepayPercent}%</span>
          </div>
          <Slider
            value={[autoRepayPercent]}
            min={0}
            max={100}
            step={5}
            disabled={readOnly || !autoRepay}
            onValueChange={([v]) => onAutoRepayPercentChange(v)}
          />
          <p className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1">
            <Info className="h-3 w-3" />
            З поточного доходу буде утримано ≈ {fmt(withheld)}₴
          </p>
        </div>
      </div>
      )}

      {readOnly && (
        <div className="sm:col-span-2 rounded-2xl border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
          Режим перегляду: менеджер магазину бачить лише суми надходжень. Виводом коштів і погашенням боргу керує власник.
        </div>
      )}
    </div>
  );
}


/** Хук-стан для демо-керування боргом у прев'ю (без бекенду). */
export function useDebtControls(initialDebt: number) {
  const [debt, setDebt] = useState(initialDebt);
  const [autoRepay, setAutoRepay] = useState(false);
  const [percent, setPercent] = useState(25);

  const payDebt = () => {
    setDebt(0);
    toast.success("Борг погашено", { description: "Кошти списано з доходу магазинів" });
  };

  return { debt, autoRepay, percent, setAutoRepay, setPercent, payDebt };
}
