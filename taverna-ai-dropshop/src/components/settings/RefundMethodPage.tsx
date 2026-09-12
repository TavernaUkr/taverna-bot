import { useEffect, useState } from "react";
import { ArrowLeft, CreditCard, Landmark, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { isPreviewDevEnvironment } from "@/lib/dev-preview";
import { hapticNotification, hapticSelection } from "@/lib/haptics";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface RefundMethod {
  id: string;
  method_type: "card" | "iban";
  masked_value: string;
  holder: string | null;
  bank_name: string | null;
}

interface RefundMethodPageProps {
  onBack: () => void;
}

const formatCard = (v: string) =>
  v.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim();

/** Реквізити клієнта для повернення коштів (не рахунок, лише куди повертати гроші). */
export function RefundMethodPage({ onBack }: RefundMethodPageProps) {
  const { sessionToken } = useTelegramAuthContext() as any;
  const [method, setMethod] = useState<RefundMethod | null>(null);
  const [type, setType] = useState<"card" | "iban">("card");
  const [value, setValue] = useState("");
  const [holder, setHolder] = useState("");
  const [bank, setBank] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const call = async (action: string, payload: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("wallet-account", {
      body: { action, session_token: sessionToken, ...payload },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  useEffect(() => {
    (async () => {
      try {
        if (!sessionToken) {
          if (isPreviewDevEnvironment()) {
            setMethod({ id: "demo", method_type: "card", masked_value: "**** 4242", holder: "IVAN PETRENKO", bank_name: "monobank" });
          }
          return;
        }
        const data = await call("get_refund_method");
        setMethod(data?.methods?.[0] || null);
      } catch {
        /* нічого не збережено */
      } finally {
        setIsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  const save = async () => {
    const clean = value.replace(/\s+/g, "");
    if (type === "card" && !/^\d{12,19}$/.test(clean)) {
      toast.error("Введіть коректний номер картки");
      return;
    }
    if (type === "iban" && !/^UA\d{27}$/i.test(clean)) {
      toast.error("Введіть коректний IBAN (UA + 27 цифр)");
      return;
    }
    setIsSaving(true);
    try {
      if (!sessionToken && isPreviewDevEnvironment()) {
        setMethod({ id: "demo", method_type: type, masked_value: `**** ${clean.slice(-4)}`, holder, bank_name: bank });
      } else {
        const data = await call("save_refund_method", { method_type: type, value: clean, holder, bank_name: bank });
        setMethod(data?.methods?.[0] || null);
      }
      setValue("");
      hapticNotification("success");
      toast.success("Реквізити для повернення збережено");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    try {
      if (sessionToken) await call("delete_refund_method");
      setMethod(null);
      toast.success("Реквізити видалено");
    } catch {
      toast.error("Не вдалося видалити");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-background animate-fade-in overflow-auto">
      <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center gap-3 z-10">
        <button
          onClick={onBack}
          className="w-11 h-11 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="font-bold text-lg text-foreground">Картка для повернень</h2>
      </div>

      <div className="p-4 space-y-4">
        <div className="rounded-xl border border-border bg-muted/40 p-4 flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-success shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Ці реквізити використовуються лише для повернення коштів, якщо ви оформили повернення
            замовлення або із замовленням щось пішло не так. Оплата з них не списується.
          </p>
        </div>

        {isLoading ? (
          <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {method && (
              <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  {method.method_type === "iban"
                    ? <Landmark className="h-5 w-5 text-primary" />
                    : <CreditCard className="h-5 w-5 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground">{method.masked_value}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {method.holder || "Без імені"}{method.bank_name ? ` · ${method.bank_name}` : ""}
                  </p>
                </div>
                <button onClick={remove} className="p-2 rounded-lg text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <p className="text-sm font-medium text-foreground">
                {method ? "Замінити реквізити" : "Додати реквізити"}
              </p>

              <div className="grid grid-cols-2 gap-2">
                {(["card", "iban"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => { hapticSelection(); setType(t); setValue(""); }}
                    className={cn(
                      "rounded-lg border p-2.5 text-sm font-medium transition-colors",
                      type === t ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground",
                    )}
                  >
                    {t === "card" ? "Картка" : "IBAN"}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{type === "card" ? "Номер картки" : "IBAN"}</Label>
                <Input
                  inputMode={type === "card" ? "numeric" : "text"}
                  placeholder={type === "card" ? "0000 0000 0000 0000" : "UA000000000000000000000000000"}
                  value={value}
                  onChange={(e) =>
                    setValue(type === "card" ? formatCard(e.target.value) : e.target.value.toUpperCase().slice(0, 29))
                  }
                  className="h-11"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">ПІБ отримувача</Label>
                <Input value={holder} onChange={(e) => setHolder(e.target.value)} className="h-11" placeholder="Іван Петренко" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Банк (необов'язково)</Label>
                <Input value={bank} onChange={(e) => setBank(e.target.value)} className="h-11" placeholder="monobank" />
              </div>

              <Button className="w-full h-11" onClick={save} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Зберегти"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
