import { AIChatAssistant } from "@/components/AIChatAssistant";
import { FloatingBonusWidget } from "@/components/promos/FloatingBonusWidget";
import { FloatingSupportWidget } from "@/components/floating/FloatingSupportWidget";
import { useFloatingTools } from "@/components/floating/FloatingToolsContext";

/**
 * Єдиний стовпчик глобальних FAB: AI (головна) знизу, бонуси і підтримка — супутники зверху.
 * Ховається повністю, коли відкрита стрічка товарів.
 */
export function FloatingToolsContainer() {
  const { isFeedActive } = useFloatingTools();

  if (isFeedActive) return null;

  return (
    <div className="fixed bottom-24 right-4 z-[90] flex flex-col items-end gap-3">
      <FloatingSupportWidget />
      <FloatingBonusWidget />
      <AIChatAssistant />
    </div>
  );
}
