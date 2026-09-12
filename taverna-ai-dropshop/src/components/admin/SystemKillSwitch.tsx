import { useState } from "react";
import { AlertTriangle, ShieldAlert, PauseCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function SystemKillSwitch() {
  const [maintenance, setMaintenance] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [flags, setFlags] = useState({ payments: true, payouts: true, orders: false });

  const enable = () => {
    setMaintenance(true);
    setConfirmOpen(false);
    toast({
      title: "Режим технічних робіт увімкнено",
      description: "Демо-режим: реальні платежі не змінено.",
      variant: "destructive",
    });
  };

  const disable = () => {
    setMaintenance(false);
    toast({ title: "Платформа знову працює у звичайному режимі" });
  };

  return (
    <>
      {maintenance && (
        <div className="fixed top-0 left-0 right-0 z-[70] bg-destructive text-destructive-foreground px-3 py-2 text-[11px] font-medium flex items-center gap-2 shadow-lg">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 leading-snug">
            Увага: Платформу переведено в режим технічних робіт. Платежі призупинено
          </span>
          <button onClick={disable} className="underline shrink-0">
            Вимкнути
          </button>
        </div>
      )}

      <Card
        className={cn(
          "border-destructive/40 bg-destructive/5 backdrop-blur-md transition-colors",
          maintenance && "border-destructive bg-destructive/10",
        )}
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            <p className="text-sm font-semibold text-foreground">Небезпечна зона</p>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-card/70 p-3">
            <PauseCircle className="h-5 w-5 text-destructive shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground">
                Технічні роботи / Зупинка платежів
              </p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Миттєво зупиняє транзакції на всій платформі
              </p>
            </div>
            <Switch
              checked={maintenance}
              onCheckedChange={(v) => (v ? setConfirmOpen(true) : disable())}
            />
          </div>

          <div className="space-y-1.5">
            {[
              { key: "payments" as const, label: "Оплати клієнтів" },
              { key: "payouts" as const, label: "Виплати магазинам" },
              { key: "orders" as const, label: "Створення нових замовлень" },
            ].map((f) => (
              <div
                key={f.key}
                className="flex items-center justify-between rounded-lg border border-border/60 bg-card/60 px-3 py-2"
              >
                <span className="text-[11px] text-foreground">{f.label}</span>
                <Switch
                  checked={flags[f.key]}
                  onCheckedChange={(v) => setFlags((p) => ({ ...p, [f.key]: v }))}
                />
              </div>
            ))}
          </div>

          <p className="text-[10px] text-muted-foreground">
            Демонстраційний перемикач — стан зберігається лише в цьому вікні.
          </p>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Перевести платформу в технічні роботи?</AlertDialogTitle>
            <AlertDialogDescription>
              Клієнти не зможуть оплачувати замовлення, а магазини — отримувати виплати,
              доки режим не вимкнено.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Скасувати</AlertDialogCancel>
            <AlertDialogAction onClick={enable}>Так, зупинити</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
