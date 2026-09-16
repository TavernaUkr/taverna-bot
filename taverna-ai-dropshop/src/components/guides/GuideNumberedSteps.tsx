export type GuideStepItem = {
  title: string;
  text: string;
};

/** Зелені кружечки з цифрами — той самий шаблон, що в «Як користуватись». */
export function GuideNumberedSteps({ steps }: { steps: GuideStepItem[] }) {
  return (
    <div className="space-y-3 w-full max-w-full overflow-hidden break-words whitespace-normal">
      {steps.map((step, index) => (
        <div
          key={step.title}
          className="flex items-start gap-3 p-3 bg-muted rounded-xl w-full max-w-full overflow-hidden"
        >
          <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs shrink-0">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1 w-full max-w-full overflow-hidden break-words whitespace-normal">
            <h4 className="font-medium text-gray-900 dark:text-white text-sm break-words whitespace-normal">
              {step.title}
            </h4>
            <p className="text-xs text-gray-700 dark:text-gray-300 break-words whitespace-normal">
              {step.text}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
