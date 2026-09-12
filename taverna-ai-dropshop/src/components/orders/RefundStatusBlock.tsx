import { CheckCircle2, Clock, CreditCard, RotateCcw, XCircle, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderRefund } from "@/hooks/useOrderRefunds";

const STEPS: { key: string; label: string }[] = [
  { key: "requested", label: "Заявка створена" },
  { key: "approved", label: "Схвалено" },
  { key: "paid", label: "Виплачено" },
];

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("uk-UA", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";

/** Блок статусу повернення коштів у деталях замовлення. */
export function RefundStatusBlock({ refund }: { refund: OrderRefund }) {
  const isRejected = refund.status === "rejected";
  const activeIndex = isRejected ? 0 : STEPS.findIndex((s) => s.key === refund.status);

  return (
    <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-rose-500" />
          <span className="font-medium text-sm text-foreground">Повернення коштів</span>
        </div>
        <span className="font-bold text-foreground">{refund.amount.toLocaleString()} ₴</span>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CreditCard className="h-3.5 w-3.5" />
        <span>{refund.refund_target || "Картка для повернень"}</span>
      </div>

      {refund.bonus_amount > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-600">
          <Star className="h-3.5 w-3.5" />
          <span>Бонуси до повернення: {refund.bonus_amount.toLocaleString()} ★</span>
        </div>
      )}

      {isRejected ? (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Заявку відхилено</p>
            <p className="text-xs text-muted-foreground">{refund.rejection_reason || "Без пояснення"}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2 pt-1">
          {STEPS.map((step, i) => {
            const done = i <= activeIndex;
            const current = i === activeIndex;
            return (
              <div key={step.key} className="flex items-center gap-2">
                {done ? (
                  <CheckCircle2 className={cn("h-4 w-4", current ? "text-rose-500" : "text-emerald-500")} />
                ) : (
                  <Clock className="h-4 w-4 text-muted-foreground/50" />
                )}
                <span className={cn("text-xs", done ? "text-foreground font-medium" : "text-muted-foreground")}>
                  {step.label}
                </span>
                {step.key === "requested" && (
                  <span className="ml-auto text-[11px] text-muted-foreground">{fmtDate(refund.created_at)}</span>
                )}
                {step.key === "paid" && refund.paid_at && (
                  <span className="ml-auto text-[11px] text-muted-foreground">{fmtDate(refund.paid_at)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="pt-1 border-t border-rose-500/10 space-y-0.5">
        <p className="text-[11px] text-muted-foreground">Причина: {refund.reason}</p>
        {refund.transaction_id && (
          <p className="text-[11px] text-muted-foreground">Транзакція: {refund.transaction_id}</p>
        )}
      </div>
    </div>
  );
}
