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

/**
 * Глобальний «Дзвоник»: маленька кругла кнопка у спільному стовпчику FAB
 * (зверху, праворуч від кнопки Taverna AI). Пульсація/бедж — лише коли
 * є непрочитані сповіщення. Не перекриває основний контент.
 */
export function NotificationBell() {
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

  return (
    <>
      <button
        type="button"
        aria-label="Сповіщення"
        onClick={() => {
          hapticImpact("light");
          setIsOpen(true);
        }}
        className="relative flex items-center justify-center w-12 h-12 rounded-full text-white bg-gradient-to-b from-sky-500 to-blue-700 shadow-[0_8px_15px_rgba(29,78,216,0.4),inset_0_2px_3px_rgba(255,255,255,0.3),inset_0_-3px_4px_rgba(0,0,0,0.4)] hover:scale-105 transition-transform duration-300"
      >
        <Bell className="h-5 w-5 drop-shadow-md" />

        {unreadCount > 0 ? (
          unreadCount > 9 ? (
            <span
              className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1 flex items-center justify-center text-[10px] font-bold rounded-full bg-red-500 text-white border-2 border-white dark:border-[#1c1c1e] shadow-md"
            >
              9+
            </span>
          ) : (
            <span
              className="absolute top-0 right-0 w-3.5 h-3.5 bg-red-500 border-2 border-white dark:border-[#1c1c1e] rounded-full"
              style={{ animation: "heartbeat 2s infinite ease-in-out" }}
            />
          )
        ) : null}
      </button>

      <NotificationsModal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        onMarkedAllRead={() => {
          // Пульсація зникає одразу: оновлюємо кеш дзвоника
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
        }}
      />
    </>
  );
}
