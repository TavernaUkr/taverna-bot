import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Bug, X, Shield, RotateCcw } from "lucide-react";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";

type TestRole = "guest" | "customer" | "supplier" | "shop_manager" | "moderator" | "admin";

interface DevRoleSwitcherProps {
  currentRole: TestRole;
  onRoleChange: (role: TestRole) => void;
  profileId?: string | null;
}

export const DevRoleSwitcher = ({ currentRole, onRoleChange }: DevRoleSwitcherProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const { canUseDevRoleSwitcher, setDevRoleOverride } = useTelegramAuthContext();
  const isAdmin = canUseDevRoleSwitcher;
  const isChecking = false;

  const roleLabels: Record<TestRole, { label: string; color: string; description: string }> = {

    guest: { 
      label: "👤 Гість", 
      color: "bg-muted text-muted-foreground",
      description: "Неавторизований користувач"
    },
    customer: { 
      label: "🛒 Клієнт", 
      color: "bg-blue-500/10 text-blue-500",
      description: "Авторизований покупець"
    },
    supplier: { 
      label: "📦 Постачальник", 
      color: "bg-primary/10 text-primary",
      description: "Партнер з товарами"
    },
    shop_manager: { 
      label: "👔 Менеджер магазину", 
      color: "bg-teal-500/10 text-teal-500",
      description: "Замовлення та чат з клієнтами"
    },
    moderator: { 
      label: "🛡️ Модератор", 
      color: "bg-orange-500/10 text-orange-500",
      description: "Скарги, чати, відгуки"
    },
    admin: { 
      label: "⚙️ Адмін", 
      color: "bg-destructive/10 text-destructive",
      description: "Повний доступ"
    },
  };

  // Only show to real admins (verified from database) or in DEV_MODE
  if (isChecking || !isAdmin) {
    return null;
  }

  // Compact inline button (shown next to Profile header)
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="p-1.5 bg-destructive/20 rounded-full hover:bg-destructive/30 transition-colors"
        title="DEV: Role Switcher"
      >
        <Bug className="h-4 w-4 text-destructive" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-24 right-4 z-50 bg-card/95 backdrop-blur-sm rounded-xl shadow-xl border border-destructive/30 p-4 min-w-[240px]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-destructive" />
          <span className="text-xs font-medium text-destructive">🔧 ADMIN TESTER</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 hover:bg-muted rounded-md transition-colors"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Симуляція ролі:</p>
          <Badge className={roleLabels[currentRole].color}>
            {roleLabels[currentRole].label}
          </Badge>
          <p className="text-[10px] text-muted-foreground mt-1">
            {roleLabels[currentRole].description}
          </p>
        </div>

        <Select value={currentRole} onValueChange={(v) => onRoleChange(v as TestRole)}>
          <SelectTrigger className="w-full h-9 text-sm">
            <SelectValue placeholder="Обрати роль" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="guest">
              <div className="flex flex-col">
                <span>👤 Гість</span>
                <span className="text-[10px] text-muted-foreground">Неавторизований</span>
              </div>
            </SelectItem>
            <SelectItem value="customer">
              <div className="flex flex-col">
                <span>🛒 Клієнт</span>
                <span className="text-[10px] text-muted-foreground">Авторизований покупець</span>
              </div>
            </SelectItem>
            <SelectItem value="supplier">
              <div className="flex flex-col">
                <span>📦 Постачальник</span>
                <span className="text-[10px] text-muted-foreground">Партнер з товарами</span>
              </div>
            </SelectItem>
            <SelectItem value="shop_manager">
              <div className="flex flex-col">
                <span>👔 Менеджер магазину</span>
                <span className="text-[10px] text-muted-foreground">Замовлення та чат</span>
              </div>
            </SelectItem>
            <SelectItem value="moderator">
              <div className="flex flex-col">
                <span>🛡️ Модератор</span>
                <span className="text-[10px] text-muted-foreground">Скарги, чати, відгуки</span>
              </div>
            </SelectItem>
            <SelectItem value="admin">
              <div className="flex flex-col">
                <span>⚙️ Адмін</span>
                <span className="text-[10px] text-muted-foreground">Повний доступ</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>

        <button
          onClick={() => setDevRoleOverride(null)}
          className="w-full flex items-center justify-center gap-2 h-8 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Скинути до реальної ролі
        </button>

        <div className="p-2 bg-destructive/10 rounded-lg border border-destructive/20">
          <p className="text-[10px] text-destructive leading-tight">
            ⚠️ Тестовий режим прев'ю: змінює UI і тестовий доступ до рахунків/оплат.
          </p>
        </div>

      </div>
    </div>
  );
};
