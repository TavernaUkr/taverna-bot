import { AIChatAssistant } from "@/components/AIChatAssistant";
import { BonusFab, BonusInventorySheets } from "@/components/promos/FloatingBonusWidget";
import { FloatingSupportWidget } from "@/components/floating/FloatingSupportWidget";
import { NotificationBell } from "@/components/floating/NotificationBell";
import { useFloatingTools } from "@/components/floating/FloatingToolsContext";

/**
 * Єдиний стовпчик глобальних FAB (вирівнювання по правому краю, згори донизу):
 *   1. «Підтримка» (найвища, велика кругла);
 *   2. Велика кнопка «Taverna AI» (посередині, з бейджем непрочитаних);
 *   3. Рядок з ДВОХ малих круглих гудзиків на одній лінії (найнижчі):
 *      зліва «Інвентар бонусів», справа «Дзвоник» сповіщень.
 * Ховається повністю, коли відкрита стрічка товарів.
 */
export function FloatingToolsContainer() {
  const { isFeedActive } = useFloatingTools();

  if (isFeedActive) return null;

  return (
    <div className="fixed bottom-24 right-4 z-[90] flex flex-col items-end gap-2">
      {/* 1. Підтримка (найвища) */}
      <FloatingSupportWidget />

      {/* 2. Велика кнопка Taverna AI (посередині) */}
      <AIChatAssistant />

      {/* 3. Два малі круглі гудзики на одній горизонтальній лінії (найнижчі):
          зліва — Інвентар бонусів, справа — Дзвоник */}
      <div className="flex items-center justify-end gap-2">
        <BonusFab className="w-10 h-10 shadow-[0_5px_10px_rgba(234,88,12,0.35),inset_0_1px_2px_rgba(255,255,255,0.3),inset_0_-2px_3px_rgba(0,0,0,0.4)]" />
        <NotificationBell size="sm" />
      </div>

      {/* Модалки інвентаря/персонального бонусу */}
      <BonusInventorySheets />
    </div>
  );
}
