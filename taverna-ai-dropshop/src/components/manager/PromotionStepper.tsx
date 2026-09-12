import { useState } from "react";
import { Check, Ticket, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight } from "lucide-react";

/** Демо-промокоди для симуляції знижки на вартість просування. */
const PROMO_CODES: Record<string, number> = {
  TAVERNA10: 10,
  BOOST20: 20,
  PARTNER30: 30,
};

interface PromoCodeFieldProps {
  /** Базова вартість просування, ₴ */
  cost: number;
  onDiscountChange?: (percent: number, finalCost: number) => void;
}

/** Поле промокоду на фінальному кроці запуску. */
export function PromoCodeField({ cost, onDiscountChange }: PromoCodeFieldProps) {
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<{ code: string; percent: number } | null>(null);

  const finalCost = applied ? Math.round(cost * (1 - applied.percent / 100)) : cost;

  const apply = () => {
    const key = code.trim().toUpperCase();
    const percent = PROMO_CODES[key];
    if (!percent) {
      toast.error("Промокод не знайдено", { description: "Перевірте код і спробуйте ще раз" });
      return;
    }
    setApplied({ code: key, percent });
    onDiscountChange?.(percent, Math.round(cost * (1 - percent / 100)));
    toast.success(`Промокод ${key} застосовано`, { description: `Знижка −${percent}% на просування` });
  };

  const reset = () => {
    setApplied(null);
    setCode("");
    onDiscountChange?.(0, cost);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Ticket className="h-3.5 w-3.5 text-primary" /> Промокод
      </p>

      {applied ? (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-success/15 text-success px-2.5 py-1 text-xs font-semibold">
            <Check className="h-3 w-3" /> {applied.code} · −{applied.percent}%
          </span>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={reset}>
            <X className="h-3 w-3 mr-1" /> Скасувати
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Ввести промокод"
            className="h-9"
          />
          <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={apply} disabled={!code.trim()}>
            Застосувати
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Вартість просування</span>
        <span className="flex items-center gap-1.5">
          {applied && <span className="text-muted-foreground line-through">{cost.toLocaleString("uk-UA")}₴</span>}
          <span className="text-sm font-bold text-foreground">{finalCost.toLocaleString("uk-UA")}₴</span>
        </span>
      </div>
    </div>
  );
}

export interface StepDef {
  id: number;
  label: string;
  icon: LucideIcon;
}

interface PromotionStepperProps {
  steps: StepDef[];
  currentStep: number;
}

export function PromotionStepper({ steps, currentStep }: PromotionStepperProps) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <div className="flex items-center justify-between px-1">
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = step.id === currentStep;

        return (
          <div key={step.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0",
                  isCompleted
                    ? "bg-primary text-primary-foreground"
                    : isCurrent
                    ? "bg-primary/20 text-primary border-2 border-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <step.icon className="h-4 w-4" />
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] mt-1 font-medium text-center leading-tight max-w-[64px]",
                  isCurrent ? "text-primary" : "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>

            {index < steps.length - 1 && (
              <div
                className={cn(
                  "h-0.5 flex-1 mx-1 -mt-4 rounded",
                  isCompleted ? "bg-primary" : "bg-muted"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface StepNavProps {
  step: number;
  totalSteps: number;
  canProceed: boolean;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  finalSlot?: React.ReactNode;
}

export function StepNav({
  step,
  totalSteps,
  canProceed,
  onBack,
  onNext,
  nextLabel = "Далі",
  finalSlot,
}: StepNavProps) {
  const isLast = step >= totalSteps;
  return (
    <div className="flex items-center gap-2 pt-1">
      {step > 1 && (
        <Button variant="outline" size="lg" onClick={onBack} className="shrink-0">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Назад
        </Button>
      )}
      {isLast ? (
        <div className="flex-1">{finalSlot}</div>
      ) : (
        <Button
          size="lg"
          className="flex-1"
          onClick={onNext}
          disabled={!canProceed}
        >
          {nextLabel}
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      )}
    </div>
  );
}
