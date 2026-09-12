// Telegram WebApp Haptic Feedback utility

type ImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
type NotificationType = "error" | "success" | "warning";

/**
 * Trigger haptic feedback for Telegram WebApp
 * Falls back silently if not in Telegram context
 */
export function triggerHapticFeedback(
  type: "impact" | "notification" | "selection",
  style?: ImpactStyle | NotificationType
) {
  try {
    // @ts-ignore - Telegram WebApp types
    const haptic = window.Telegram?.WebApp?.HapticFeedback;
    
    if (!haptic) return;

    switch (type) {
      case "impact":
        haptic.impactOccurred?.((style as ImpactStyle) || "medium");
        break;
      case "notification":
        haptic.notificationOccurred?.((style as NotificationType) || "success");
        break;
      case "selection":
        haptic.selectionChanged?.();
        break;
    }
  } catch {
    // Silently fail if not in Telegram context
  }
}

/**
 * Trigger impact feedback (for button presses, interactions)
 */
export const hapticImpact = (style: ImpactStyle = "medium") => 
  triggerHapticFeedback("impact", style);

/**
 * Trigger notification feedback (for success, error, warning states)
 */
export const hapticNotification = (type: NotificationType = "success") =>
  triggerHapticFeedback("notification", type);

/**
 * Trigger selection feedback (for selection changes)
 */
export const hapticSelection = () => 
  triggerHapticFeedback("selection");
