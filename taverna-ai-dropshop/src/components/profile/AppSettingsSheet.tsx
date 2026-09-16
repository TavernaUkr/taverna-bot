import { useEffect } from "react";
import { Bell, Monitor, Moon, Palette, Sun, Vibrate } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { useModalHistory } from "@/hooks/useModalHistory";
import { useTelegramUIContext, vibrate, type AppTheme } from "@/hooks/useTelegramUI";
import { updateMyUserSettings } from "@/lib/backendApi";
import { toast } from "sonner";

interface AppSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const THEME_OPTIONS: { id: AppTheme; label: string; icon: typeof Monitor }[] = [
  { id: "auto", label: "Авто (Telegram)", icon: Monitor },
  { id: "dark", label: "Темна", icon: Moon },
  { id: "light", label: "Світла", icon: Sun },
];

/** Шторка теми, вібрації та сповіщень. Системна «Назад» закриває її через useModalHistory. */
export function AppSettingsSheet({ open, onOpenChange }: AppSettingsSheetProps) {
  useModalHistory(open, () => onOpenChange(false));

  const { isAuthenticated, profile, applyProfileSettings } = useTelegramAuthContext();
  const { appTheme, setAppTheme, setHapticEnabled } = useTelegramUIContext();

  const hapticEnabled = profile?.haptic_enabled ?? true;
  const notificationsEnabled = profile?.notifications_enabled ?? true;

  useEffect(() => {
    if (typeof profile?.haptic_enabled === "boolean") {
      setHapticEnabled(profile.haptic_enabled);
    }
  }, [profile?.haptic_enabled, setHapticEnabled]);

  const persistSettings = async (next: {
    haptic_enabled: boolean;
    notifications_enabled: boolean;
  }) => {
    const previous = {
      haptic_enabled: hapticEnabled,
      notifications_enabled: notificationsEnabled,
    };
    applyProfileSettings(next);
    try {
      const updated = await updateMyUserSettings(next);
      applyProfileSettings({
        haptic_enabled:
          typeof updated.haptic_enabled === "boolean" ? updated.haptic_enabled : next.haptic_enabled,
        notifications_enabled:
          typeof updated.notifications_enabled === "boolean"
            ? updated.notifications_enabled
            : next.notifications_enabled,
      });
    } catch (err) {
      applyProfileSettings(previous);
      toast.error(err instanceof Error ? err.message : "Не вдалося зберегти налаштування");
    }
  };

  const handleThemeChange = (theme: AppTheme) => {
    setAppTheme(theme);
    vibrate("light");
  };

  const handleHapticChange = (checked: boolean) => {
    setHapticEnabled(checked);
    void persistSettings({
      haptic_enabled: checked,
      notifications_enabled: notificationsEnabled,
    });
  };

  const handleNotificationsChange = (checked: boolean) => {
    void persistSettings({
      haptic_enabled: hapticEnabled,
      notifications_enabled: checked,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[88vh] overflow-y-auto pb-8">
        <SheetHeader className="text-left pr-8">
          <SheetTitle>⚙️ Налаштування додатку</SheetTitle>
          <SheetDescription>Тема, вібрація та сповіщення</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3 pb-2">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-3 mb-3">
              <Palette className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium text-foreground">Тема оформлення</p>
                <p className="text-sm text-muted-foreground">
                  Авто бере тему з Telegram
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = appTheme === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleThemeChange(option.id)}
                    className={`flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium transition-all ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-muted/40 text-muted-foreground hover:border-muted-foreground/50"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="leading-tight text-center">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <Vibrate className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium text-foreground">Вібрація</p>
                  <p className="text-sm text-muted-foreground">
                    Тактильний відгук при натисканнях
                  </p>
                </div>
              </div>
              <Switch
                checked={hapticEnabled}
                disabled={!isAuthenticated}
                onCheckedChange={handleHapticChange}
              />
            </div>

            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium text-foreground">Сповіщення</p>
                  <p className="text-sm text-muted-foreground">
                    Отримувати сповіщення про замовлення
                  </p>
                </div>
              </div>
              <Switch
                checked={notificationsEnabled}
                disabled={!isAuthenticated}
                onCheckedChange={handleNotificationsChange}
              />
            </div>
          </div>

          {!isAuthenticated && (
            <p className="text-xs text-muted-foreground text-center px-2">
              Вібрація та сповіщення збережуться після входу через Telegram
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
