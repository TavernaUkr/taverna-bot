import { useState } from 'react';
import { 
  ArrowLeft, 
  Shield, 
  Smartphone, 
  Key, 
  LogOut, 
  Check, 
  AlertTriangle,
  ChevronRight,
  Globe,
  Clock
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Session {
  id: string;
  device: string;
  browser: string;
  location: string;
  lastActive: Date;
  isCurrent: boolean;
}

interface SecuritySettingsProps {
  onBack: () => void;
  is2FAEnabled: boolean;
  onToggle2FA: (enabled: boolean) => Promise<void>;
  sessions: Session[];
  onRevokeSession: (sessionId: string) => Promise<void>;
  onRevokeAllSessions: () => Promise<void>;
}

export function SecuritySettings({
  onBack,
  is2FAEnabled,
  onToggle2FA,
  sessions,
  onRevokeSession,
  onRevokeAllSessions,
}: SecuritySettingsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);

  const handleToggle2FA = async (enabled: boolean) => {
    setIsLoading(true);
    try {
      await onToggle2FA(enabled);
      toast.success(enabled ? '2FA увімкнено' : '2FA вимкнено');
    } catch (error) {
      toast.error('Помилка зміни налаштувань');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setLoadingSessionId(sessionId);
    try {
      await onRevokeSession(sessionId);
      toast.success('Сесію завершено');
    } catch (error) {
      toast.error('Помилка завершення сесії');
    } finally {
      setLoadingSessionId(null);
    }
  };

  const handleRevokeAll = async () => {
    setIsLoading(true);
    try {
      await onRevokeAllSessions();
      toast.success('Усі сесії завершено');
    } catch (error) {
      toast.error('Помилка завершення сесій');
    } finally {
      setIsLoading(false);
    }
  };

  const getTimeAgo = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Щойно';
    if (minutes < 60) return `${minutes} хв тому`;
    if (hours < 24) return `${hours} год тому`;
    return `${days} дн тому`;
  };

  return (
    <div className="fixed inset-0 z-[60] bg-background animate-fade-in overflow-auto">
      {/* Header */}
      <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center gap-3 z-10">
        <button
          onClick={onBack}
          className="w-11 h-11 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="font-bold text-lg text-foreground">Безпека</h2>
          <p className="text-xs text-muted-foreground">Захист вашого акаунту</p>
        </div>
      </div>

      <div className="p-4 pb-24 space-y-4">
        {/* 2FA Section */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-4 flex items-center gap-4">
            <div className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center",
              is2FAEnabled ? "bg-success/20" : "bg-muted"
            )}>
              <Shield className={cn(
                "h-6 w-6",
                is2FAEnabled ? "text-success" : "text-muted-foreground"
              )} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">Двофакторна автентифікація</span>
                {is2FAEnabled && (
                  <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                    <Check className="h-3 w-3 mr-1" />
                    Активно
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Додатковий захист через Telegram
              </p>
            </div>
            <Switch 
              checked={is2FAEnabled} 
              onCheckedChange={handleToggle2FA}
              disabled={isLoading}
            />
          </div>
          
          {is2FAEnabled && (
            <div className="px-4 pb-4">
              <div className="p-3 bg-success/10 rounded-xl border border-success/20">
                <div className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-success mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Захист активовано</p>
                    <p className="text-xs text-muted-foreground">
                      При вході ви отримаєте код підтвердження в Telegram
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {!is2FAEnabled && (
            <div className="px-4 pb-4">
              <div className="p-3 bg-warning/10 rounded-xl border border-warning/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Рекомендуємо увімкнути</p>
                    <p className="text-xs text-muted-foreground">
                      2FA значно підвищує безпеку вашого акаунту
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Active Sessions */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Smartphone className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <span className="font-medium text-foreground">Активні сесії</span>
                  <p className="text-xs text-muted-foreground">{sessions.length} пристро(їв)</p>
                </div>
              </div>
              {sessions.length > 1 && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleRevokeAll}
                  disabled={isLoading}
                  className="text-destructive hover:text-destructive"
                >
                  <LogOut className="h-4 w-4 mr-1" />
                  Завершити всі
                </Button>
              )}
            </div>
          </div>

          <div className="divide-y divide-border">
            {sessions.map((session) => (
              <div key={session.id} className="p-4 flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  session.isCurrent ? "bg-success/20" : "bg-muted"
                )}>
                  <Smartphone className={cn(
                    "h-5 w-5",
                    session.isCurrent ? "text-success" : "text-muted-foreground"
                  )} />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground truncate">
                      {session.device}
                    </span>
                    {session.isCurrent && (
                      <Badge variant="secondary" className="text-xs bg-success/10 text-success">
                        Поточна
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{session.browser}</span>
                    <span>•</span>
                    <Globe className="h-3 w-3" />
                    <span>{session.location}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <Clock className="h-3 w-3" />
                    <span>{getTimeAgo(session.lastActive)}</span>
                  </div>
                </div>

                {!session.isCurrent && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRevokeSession(session.id)}
                    disabled={loadingSessionId === session.id}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Security Tips */}
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Key className="h-5 w-5 text-primary" />
            </div>
            <span className="font-medium text-foreground">Поради з безпеки</span>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-success shrink-0" />
              <span>Увімкніть двофакторну автентифікацію</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-success shrink-0" />
              <span>Регулярно перевіряйте активні сесії</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-success shrink-0" />
              <span>Не діліться даними входу з іншими</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}