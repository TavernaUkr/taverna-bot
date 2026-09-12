import { Check, MapPin, CreditCard, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export type CheckoutStep = "contact" | "delivery" | "payment" | "confirm";

interface CheckoutStepsProps {
  currentStep: CheckoutStep;
  completedSteps: CheckoutStep[];
}

const steps: { id: CheckoutStep; label: string; icon: typeof MapPin }[] = [
  { id: "contact", label: "Контакт", icon: MapPin },
  { id: "delivery", label: "Доставка", icon: MapPin },
  { id: "payment", label: "Оплата", icon: CreditCard },
  { id: "confirm", label: "Підтвердження", icon: ClipboardCheck },
];

export const CheckoutSteps = ({
  currentStep,
  completedSteps,
}: CheckoutStepsProps) => {
  const currentIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <div className="flex items-center justify-between px-2">
      {steps.map((step, index) => {
        const isCompleted = completedSteps.includes(step.id);
        const isCurrent = step.id === currentStep;
        const isPast = index < currentIndex;

        return (
          <div key={step.id} className="flex items-center">
            {/* Step indicator */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                  isCompleted
                    ? "bg-primary text-primary-foreground"
                    : isCurrent
                    ? "bg-primary/20 text-primary border-2 border-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <step.icon className="h-5 w-5" />
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] mt-1 font-medium",
                  isCurrent ? "text-primary" : "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "w-8 h-0.5 mx-1",
                  isPast || isCompleted ? "bg-primary" : "bg-muted"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
