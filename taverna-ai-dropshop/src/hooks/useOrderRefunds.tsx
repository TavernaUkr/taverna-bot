import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { isPreviewDevEnvironment } from "@/lib/dev-preview";

export type RefundStatus = "requested" | "approved" | "paid" | "rejected";

export interface OrderRefund {
  id: string;
  order_id: string;
  amount: number;
  bonus_amount: number;
  reason: string;
  comment: string | null;
  status: RefundStatus;
  rejection_reason: string | null;
  refund_target: string | null;
  transaction_id: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at?: string;
  items?: { id: string; name: string; quantity: number; total: number }[];
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

/** Демо-заявки для preview: усі можливі стани повернення. */
export const DEMO_REFUNDS: OrderRefund[] = [
  {
    id: "demo-refund-1", order_id: "mock-order-001", amount: 55074, bonus_amount: 250,
    reason: "Не підійшов розмір", comment: null, status: "requested", rejection_reason: null,
    refund_target: "**** 4242 · IVAN PETRENKO", transaction_id: null, paid_at: null,
    created_at: daysAgo(1),
  },
  {
    id: "demo-refund-2", order_id: "mock-order-006", amount: 12500, bonus_amount: 0,
    reason: "Товар не відповідає опису", comment: "Інший колір", status: "approved", rejection_reason: null,
    refund_target: "**** 4242 · IVAN PETRENKO", transaction_id: null, paid_at: null,
    created_at: daysAgo(3),
  },
  {
    id: "demo-refund-3", order_id: "mock-order-005", amount: 6074, bonus_amount: 120,
    reason: "Замовлення скасовано", comment: null, status: "paid", rejection_reason: null,
    refund_target: "**** 4242 · IVAN PETRENKO", transaction_id: "RFND-DEMO01", paid_at: daysAgo(2),
    created_at: daysAgo(5),
  },
  {
    id: "demo-refund-4", order_id: "mock-order-002", amount: 899, bonus_amount: 0,
    reason: "Пошкоджено при доставці", comment: null, status: "rejected",
    rejection_reason: "Товар використовувався, слідів пошкодження при доставці не виявлено",
    refund_target: "**** 4242 · IVAN PETRENKO", transaction_id: null, paid_at: null,
    created_at: daysAgo(8),
  },
];

/** Заявки на повернення поточного клієнта (з демо-даними в preview). */
export function useOrderRefunds() {
  const { sessionToken } = useTelegramAuthContext() as any;
  const [refunds, setRefunds] = useState<OrderRefund[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const call = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("order-refunds", {
      body: { action, session_token: sessionToken, ...payload },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }, [sessionToken]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!sessionToken) {
        setRefunds(isPreviewDevEnvironment() ? DEMO_REFUNDS : []);
        return;
      }
      const data = await call("list_my_refunds");
      const list: OrderRefund[] = (data?.refunds || []).map((r: any) => ({
        ...r, amount: Number(r.amount), bonus_amount: Number(r.bonus_amount || 0),
      }));
      setRefunds(list.length === 0 && isPreviewDevEnvironment() ? DEMO_REFUNDS : list);
    } catch {
      setRefunds(isPreviewDevEnvironment() ? DEMO_REFUNDS : []);
    } finally {
      setIsLoading(false);
    }
  }, [sessionToken, call]);

  useEffect(() => { refresh(); }, [refresh]);

  const getForOrder = useCallback(
    (orderId: string) => refunds.find((r) => r.order_id === orderId) || null,
    [refunds],
  );

  const createRequest = useCallback(async (payload: {
    order_id: string; item_ids: string[]; reason: string; comment?: string;
  }) => {
    if (!sessionToken && isPreviewDevEnvironment()) {
      const demo: OrderRefund = {
        id: `demo-${Date.now()}`, order_id: payload.order_id, amount: 0, bonus_amount: 0,
        reason: payload.reason, comment: payload.comment || null, status: "requested",
        rejection_reason: null, refund_target: "**** 4242 · IVAN PETRENKO",
        transaction_id: null, paid_at: null, created_at: new Date().toISOString(),
      };
      setRefunds((prev) => [demo, ...prev]);
      return demo;
    }
    const data = await call("create_request", payload);
    await refresh();
    return data?.refund as OrderRefund;
  }, [sessionToken, call, refresh]);

  return { refunds, isLoading, refresh, getForOrder, createRequest };
}
