import { useState } from "react";
import { Bell } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { useFloatingToolsOptional } from "@/components/floating/FloatingToolsContext";
import { fetchMyNotifications } from "@/lib/backendApi";
import { hapticImpact } from "@/lib/haptics";
import { NotificationsModal } from "@/components/NotificationsModal";

/** Періодичне опитування дзвоника: досить рідко, щоб не грузити бекенд. */
const NOTIFICATIONS_POLL_MS = 30000;

/** Класичний червоний бейдж з цифрою (не «9+», а повний лічильник до 99+). */
function UnreadBadge({ count, small }: { count: number; small?: boolean }) {
  if (count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <span
      className={`absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold leading-none rounded-full bg-red-500 text-white border-2 border-white dark:border-[#1c1c1e] shadow-md pointer-events-none ${
        small ? "min-w-[16px] h-[16px] text-[9px]" : ""
      }`}
    >
      {label}
    </span>
  );
}

/**
 * Глобальний «Дзвоник»: маленька кругла кнопка у спільному стовпчику FAB
 * (справа від кнопки бонусів, ПІД «Taverna AI»). Бейдж — червоне кружечко
 * з цифрою непрочитаних (99+ для великих значень). Не перекриває контент.
 */
export function NotificationBell({ size = "md" }: { size?: "sm" | "md" }) {
  const { isAuthenticated } = useTelegramAuthContext();
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const floating = useFloatingToolsOptional();

  const enabled = isAuthenticated && !floating?.chatOpen;

  const { data } = useQuery({
    queryKey: ["notifications", "bell"],
    queryFn: () => fetchMyNotifications(50),
    enabled,
    refetchInterval: NOTIFICATIONS_POLL_MS,
    // Дзвоник — фоновий віджет: помилки не показуємо користувачу
    retry: false,
  });

  const unreadCount = Math.max(0, Number(data?.unread_count ?? 0));

  if (!enabled) return null;

  const isSmall = size === "sm";

  return (
    <>
      <button
        type="button"
        aria-label="Сповіщення"
        onClick={() => {
          hapticImpact("light");
          setIsOpen(true);
        }}
        className={`relative flex items-center justify-center rounded-full text-white bg-gradient-to-b from-sky-500 to-blue-700 shadow-[0_8px_15px_rgba(29,78,216,0.4),inset_0_2px_3px_rgba(255,255,255,0.3),inset_0_-3px_4px_rgba(0,0,0,0.4)] hover:scale-105 transition-transform duration-300 ${
          isSmall ? "w-10 h-10" : "w-12 h-12"
        }`}
      >
        <Bell className={isSmall ? "h-4 w-4 drop-shadow-md" : "h-5 w-5 drop-shadow-md"} />

        <UnreadBadge count={unreadCount} small={isSmall} />
      </button>

      <NotificationsModal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        onMarkedAllRead={() => {
          // Бейдж зникає одразу: оновлюємо кеш дзвоника
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
        }}
      />
    </>
  );
}
