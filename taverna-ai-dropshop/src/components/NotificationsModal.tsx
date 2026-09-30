import { useState } from "react";
import { Bell, CheckCheck, Loader2, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useModalHistory } from "@/hooks/useModalHistory";
import {
  clearAllNotifications,
  fetchMyNotifications,
  markAllNotificationsRead,
  type BackendNotification,
} from "@/lib/backendApi";
import { hapticImpact } from "@/lib/haptics";
import { cn } from "@/lib/utils";

interface NotificationsModalProps {
  open: boolean;
  onClose: () => void;
  /** Колбек після успішного «Прочитати всі» (щоб дзвоник скинув бедж). */
  onMarkedAllRead?: () => void;
}

/** Дата сповіщення у людському форматі (uk-UA). */
function formatNotificationDate(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function NotificationCard({ item }: { item: BackendNotification }) {
  const createdAt = formatNotificationDate(item.created_at);
  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-colors",
        item.is_read
          ? "border-border bg-card"
          : "border-primary/30 bg-primary/5"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Кольорова точка непрочитаного */}
        <span
          className={cn(
            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
            item.is_read ? "bg-transparent" : "bg-red-500"
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-semibold text-foreground leading-tight">
              {item.title}
            </h4>
            {!item.is_read && (
              <span className="shrink-0 text-[10px] font-medium text-primary">
                Нове
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words leading-snug">
            {item.message}
          </p>
          {item.image_url && (
            <img
              src={item.image_url}
              alt="Доказ"
              className="mt-2 max-h-40 w-full rounded-lg object-cover"
              loading="lazy"
            />
          )}
          {createdAt && (
            <p className="mt-2 text-[10px] text-muted-foreground/70">
              {createdAt}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Вікно сповіщень (модалка «Дзвоника»): список карток із заголовком,
 * текстом, датою та картинкою (якщо є image_url — фото-докази).
 * У шапці — «Прочитати всі» (POST /read-all → оновлення кешу).
 */
export function NotificationsModal({ open, onClose, onMarkedAllRead }: NotificationsModalProps) {
  useModalHistory(open, onClose);
  const queryClient = useQueryClient();
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => fetchMyNotifications(50),
    enabled: open,
  });

  const items = data?.items ?? [];
  const unreadCount = Math.max(0, Number(data?.unread_count ?? 0));

  const handleReadAll = async () => {
    hapticImpact("light");
    setIsMarkingAll(true);
    try {
      await markAllNotificationsRead();
      await refetch();
      onMarkedAllRead?.();
    } finally {
      setIsMarkingAll(false);
    }
  };

  const handleClearAll = async () => {
    hapticImpact("light");
    setIsClearing(true);
    try {
      await clearAllNotifications();
      await refetch();
      onMarkedAllRead?.();
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
        {/* Шапка: дзвоник + лічильник + «Прочитати всі» */}
        <DialogHeader className="p-4 pb-3 border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2">
              <span className="relative flex items-center justify-center w-9 h-9 rounded-full bg-sky-500/15">
                <Bell className="h-4 w-4 text-sky-500" />
                {unreadCount > 0 && (
                  <span className="absolute top-0 right-0 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-bold rounded-full bg-red-500 text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </span>
              <div className="flex flex-col">
                <span>Сповіщення</span>
                <span className="text-[10px] font-normal text-muted-foreground">
                  {unreadCount > 0 ? `${unreadCount} непрочитаних` : "Усі прочитано"}
                </span>
              </div>
            </DialogTitle>

            {items.length > 0 && (
              <div className="flex items-center gap-1">
                {/* «Прочитати всі»: is_read = true для всіх (POST /read-all) */}
                <button
                  type="button"
                  disabled={isMarkingAll || unreadCount === 0}
                  onClick={handleReadAll}
                  className={cn(
                    "flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium transition-colors",
                    unreadCount === 0
                      ? "text-muted-foreground/50 cursor-default"
                      : "text-sky-500 hover:bg-sky-500/10"
                  )}
                >
                  {isMarkingAll ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCheck className="h-3.5 w-3.5" />
                  )}
                  Прочитати всі
                </button>

                {/* «Очистити всі»: DELETE /me/notifications */}
                <button
                  type="button"
                  disabled={isClearing}
                  onClick={handleClearAll}
                  className={cn(
                    "flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium transition-colors",
                    isClearing
                      ? "text-muted-foreground/50 cursor-default"
                      : "text-red-500 hover:bg-red-500/10"
                  )}
                >
                  {isClearing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Очистити всі
                </button>
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Список сповіщень */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
              <Bell className="h-10 w-10 opacity-30" />
              <p className="text-sm">Сповіщень поки немає</p>
            </div>
          ) : (
            items.map((item) => <NotificationCard key={item.id} item={item} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
