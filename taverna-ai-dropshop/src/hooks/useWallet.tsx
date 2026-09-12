import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { isPreviewDevEnvironment } from "@/lib/dev-preview";

export interface WalletTransaction {
  id: string;
  type: "topup" | "payment" | "payout" | "bonus_earn" | "bonus_spend" | "refund" | "hold";
  amount: number;
  bonus_amount: number;
  provider: string;
  status: string;
  order_id: string | null;
  description: string | null;
  receipt: Record<string, unknown> | null;
  created_at: string;
}

export interface WalletLimit {
  provider: string;
  min_payout: number;
  max_payout: number;
  daily_limit: number;
  fee_percent: number;
  fee_fixed: number;
  is_active: boolean;
  eta_text: string | null;
}

export interface WalletState {
  id: string;
  balance: number;
  bonus_balance: number;
  pending: number;
  total: number;
  currency: string;
  is_connected: boolean;
  tg_wallet_address: string | null;
  tg_wallet_currency: string | null;
  payout_provider: string;
  auto_withdraw: boolean;
  auto_withdraw_min: number;
  /** Заборгованість перед платформою (націнка з післяплат). UI-поле, сервер може не повертати. */
  platform_debt?: number;
}

const demoWallet = (bonusOnly = false): WalletState => ({
  id: "preview-wallet",
  platform_debt: bonusOnly ? 0 : 4820,
  balance: bonusOnly ? 0 : 3420,
  bonus_balance: 1250,
  pending: bonusOnly ? 0 : 780,
  total: bonusOnly ? 1250 : 4670,
  currency: "UAH",
  is_connected: false,
  tg_wallet_address: null,
  tg_wallet_currency: "USDT",
  payout_provider: "telegram_wallet",
  auto_withdraw: false,
  auto_withdraw_min: 500,
});

const demoTransactions = (bonusOnly = false): WalletTransaction[] => {
  const now = Date.now();
  const mk = (i: number, t: WalletTransaction["type"], amount: number, provider: string, description: string, bonus = 0): WalletTransaction => ({
    id: `demo-${i}`,
    type: t,
    amount,
    bonus_amount: bonus,
    provider,
    status: "completed",
    order_id: null,
    description,
    receipt: { amount, provider, at: new Date(now - i * 36e5).toISOString(), mode: "sandbox" },
    created_at: new Date(now - i * 36e5).toISOString(),
  });
  if (bonusOnly) {
    return [
      mk(2, "bonus_earn", 0, "internal", "Бонуси за замовлення TAV-000131", 120),
      mk(9, "bonus_earn", 0, "internal", "Бонуси за відгук", 50),
      mk(30, "bonus_spend", 0, "internal", "Оплата бонусами TAV-000128", 90),
      mk(72, "refund", 0, "internal", "Повернення бонусів за скасоване замовлення", 60),
    ];
  }
  return [
    mk(1, "topup", 1500, "telegram_wallet", "Поповнення через Telegram Wallet"),
    mk(3, "payment", 1290, "internal", "Оплата замовлення TAV-000128", 90),
    mk(9, "bonus_earn", 0, "internal", "Бонуси за відгук", 50),
    mk(26, "payout", 800, "telegram_wallet", "Вивід на Telegram Wallet"),
    mk(48, "topup", 2000, "mono", "Поповнення Mono Pay"),
  ];
};

const demoLimits = (): WalletLimit[] => [
  { provider: "telegram_wallet", min_payout: 50, max_payout: 100000, daily_limit: 200000, fee_percent: 0, fee_fixed: 0, is_active: true, eta_text: "Миттєво" },
  { provider: "card", min_payout: 200, max_payout: 29999, daily_limit: 50000, fee_percent: 1, fee_fixed: 5, is_active: true, eta_text: "До 1 години" },
  { provider: "iban", min_payout: 500, max_payout: 400000, daily_limit: 400000, fee_percent: 0, fee_fixed: 0, is_active: true, eta_text: "1-2 банківські дні" },
];

export interface ShopSummary {
  id: string;
  shop_name: string;
  logo_url: string | null;
  role: "owner" | "manager";
  available: number;
  pending: number;
  lifetime_paid: number;
  orders: number;
  awaiting_payout: number;
  turnover: number;
  commission: number;
  auto_withdraw?: boolean;
  auto_withdraw_min?: number;
  payout_provider?: string;
  /** Борг магазину перед платформою (націнка, отримана готівкою на післяплатах) */
  debt?: number;
}

export interface ShopsTotals {
  available: number;
  pending: number;
  lifetime_paid: number;
  orders: number;
  turnover: number;
}

const demoShops = (): ShopSummary[] => [
  { id: "demo-shop-1", shop_name: "TechStore UA", logo_url: null, role: "owner", available: 18450, pending: 4200, lifetime_paid: 132400, orders: 86, awaiting_payout: 4, turnover: 168900, commission: 24300, auto_withdraw: true, auto_withdraw_min: 1000, payout_provider: "telegram_wallet", debt: 0 },
  { id: "demo-shop-2", shop_name: "TacGear Pro", logo_url: null, role: "owner", available: 9120, pending: 1500, lifetime_paid: 64800, orders: 41, awaiting_payout: 2, turnover: 78400, commission: 11200, auto_withdraw: false, auto_withdraw_min: 500, payout_provider: "card", debt: 1480 },
  { id: "demo-shop-3", shop_name: "Home Comfort", logo_url: null, role: "manager", available: 3300, pending: 900, lifetime_paid: 21500, orders: 19, awaiting_payout: 1, turnover: 27600, commission: 3900, auto_withdraw: false, auto_withdraw_min: 500, payout_provider: "iban", debt: 320 },
];


interface UseWalletOptions {
  /** Рахунок магазину замість особистого */
  supplierId?: string;
  /** Підвантажити зведення по всіх магазинах користувача */
  withShops?: boolean;
}

/** Грошовий рахунок мають постачальники/адміни (менеджер — лише перегляд). Клієнт — тільки бонуси. */
const CASH_ROLES = ["supplier", "shop_manager", "admin", "moderator"];
/** Ролі, для яких грошовий рахунок недоступний у будь-якому разі. */
const BONUS_ONLY_ROLES = ["customer", "guest", "", null, undefined];

export function useWallet({ supplierId, withShops }: UseWalletOptions = {}) {
  const { profile, isAuthenticated, sessionToken, effectiveRole, devRoleOverride } = useTelegramAuthContext() as any;
  const forcedBonusOnly = BONUS_ONLY_ROLES.includes(effectiveRole);
  const hasCashRole = !forcedBonusOnly && (CASH_ROLES.includes(effectiveRole) || Boolean(supplierId));
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [limits, setLimits] = useState<WalletLimit[]>([]);
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [shopsTotals, setShopsTotals] = useState<ShopsTotals | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [bonusOnly, setBonusOnly] = useState(!hasCashRole);
  const [mode, setMode] = useState<"sandbox" | "live">("sandbox");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBonusOnly(!hasCashRole);
  }, [hasCashRole]);

  const applyDemoShops = useCallback(() => {
    const list = demoShops();
    setShops(list);
    setShopsTotals(
      list.reduce(
        (a, s) => ({
          available: a.available + s.available,
          pending: a.pending + s.pending,
          lifetime_paid: a.lifetime_paid + s.lifetime_paid,
          orders: a.orders + s.orders,
          turnover: a.turnover + s.turnover,
        }),
        { available: 0, pending: 0, lifetime_paid: 0, orders: 0, turnover: 0 },
      ),
    );
  }, []);

  const applyDemo = useCallback(() => {
    setWallet(demoWallet(!hasCashRole));
    setTransactions(demoTransactions(!hasCashRole));
    setLimits(hasCashRole ? demoLimits() : []);
    setBonusOnly(!hasCashRole);
    setMode("sandbox");
    setError(null);
    if (hasCashRole) applyDemoShops();
    else { setShops([]); setShopsTotals(null); }
  }, [applyDemoShops, hasCashRole]);



  const call = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      if (!sessionToken) {
        if (isPreviewDevEnvironment()) {
          applyDemo();
          return { demo: true } as any;
        }
        throw new Error("Потрібна авторизація");
      }
      const { data, error: fnError } = await supabase.functions.invoke("wallet-account", {
        body: {
          action,
          session_token: sessionToken,
          supplier_id: supplierId,
          preview_role: devRoleOverride || undefined,
          ...payload,
        },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      if (data?.wallet) {
        // Клієнтська роль ніколи не бачить грошей, навіть якщо сервер повернув інше.
        const bo = forcedBonusOnly || !!data.bonus_only;
        setWallet(bo
          ? { ...data.wallet, balance: 0, pending: 0, total: Number(data.wallet.bonus_balance || 0) }
          : data.wallet);
        setTransactions(
          bo
            ? (data.transactions || []).filter((t: WalletTransaction) =>
                ["bonus_earn", "bonus_spend", "refund"].includes(t.type))
            : data.transactions || [],
        );
        setLimits(bo ? [] : data.limits || []);
        setReadOnly(!!data.read_only);
        setBonusOnly(bo);
        setMode(data.mode || "sandbox");
      }
      return data;
    },
    [sessionToken, supplierId, applyDemo, devRoleOverride, forcedBonusOnly],
  );

  const fetchShops = useCallback(async () => {
    try {
      if (!sessionToken) {
        if (isPreviewDevEnvironment()) { applyDemoShops(); return; }
        return;
      }
      const { data, error: fnError } = await supabase.functions.invoke("wallet-account", {
        body: { action: "get_shops_summary", session_token: sessionToken, preview_role: devRoleOverride || undefined },
      });
      if (fnError || data?.error) throw new Error(data?.error || "shops error");
      const list: ShopSummary[] = data?.shops || [];
      if (list.length === 0 && isPreviewDevEnvironment()) { applyDemoShops(); return; }
      setShops(list);
      setShopsTotals(data?.totals || null);
    } catch {
      if (isPreviewDevEnvironment()) applyDemoShops();
    }
  }, [sessionToken, applyDemoShops, devRoleOverride]);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await call("get_account");
    } catch (e: unknown) {
      if (isPreviewDevEnvironment()) applyDemo();
      else setError(e instanceof Error ? e.message : "Помилка рахунку");
    } finally {
      setIsLoading(false);
    }
    if (withShops) await fetchShops();
  }, [call, applyDemo, withShops, fetchShops]);

  useEffect(() => {
    if (!isAuthenticated && !isPreviewDevEnvironment()) {
      setIsLoading(false);
      return;
    }
    refetch();
  }, [isAuthenticated, profile?.id, refetch]);

  const safe = async (fn: () => Promise<any>, demoPatch?: Partial<WalletState>) => {
    try {
      return await fn();
    } catch (e) {
      if (isPreviewDevEnvironment()) {
        setWallet((prev) => (prev ? { ...prev, ...demoPatch } : prev));
        return { demo: true };
      }
      throw e;
    }
  };

  return {
    wallet,
    transactions,
    limits,
    shops,
    shopsTotals,
    readOnly,
    /** Клієнтський режим: лише бонуси, без реальних коштів */
    bonusOnly,
    mode,
    isLoading,
    error,
    refetch,
    fetchShops,

    connectWallet: (address?: string, currency: "TON" | "USDT" = "USDT") =>
      safe(() => call("connect_wallet", { address, currency }), { is_connected: true, tg_wallet_currency: currency }),
    topUp: (amount: number, provider: string) =>
      safe(() => call("create_topup", { amount, provider })),
    /** Перевірка статусу поповнення (після оплати в Telegram Wallet) */
    checkTopUp: (transactionId: string) => call("check_topup", { transaction_id: transactionId }),

    payWithBalance: (orderId: string, useBonus = true) =>
      call("pay_with_balance", { order_id: orderId, use_bonus: useBonus }),
    requestPayout: (amount: number, provider: string, destination?: string, sourceShopId?: string) =>
      safe(() => call("request_payout", { amount, provider, destination, supplier_id: sourceShopId })),
    savePayoutSettings: (patch: Record<string, unknown>) =>
      safe(() => call("set_payout_settings", patch), patch as Partial<WalletState>),

    /** Автовивід для конкретного магазину */
    saveShopPayoutSettings: async (shopId: string, patch: Record<string, unknown>) => {
      setShops((prev) => prev.map((s) => (s.id === shopId ? { ...s, ...patch } as ShopSummary : s)));
      try {
        await call("set_payout_settings", { ...patch, supplier_id: shopId });
        await refetch();
      } catch {
        if (!isPreviewDevEnvironment()) throw new Error("Не вдалося зберегти автовивід");
      }
    },
  };
}
