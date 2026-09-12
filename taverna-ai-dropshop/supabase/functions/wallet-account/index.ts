import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const WALLET_API_KEY = Deno.env.get("WALLET_PAY_API_KEY") || "";
const SANDBOX = !WALLET_API_KEY;
const BONUS_CART_SHARE = 0.07; // бонусами можна покрити максимум 7% замовлення

const fakeId = (p: string) => `${p}-SBX-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function hashToken(token: string): Promise<string> {
  const secret = Deno.env.get("SESSION_HMAC_SECRET") || "";
  const encoder = new TextEncoder();
  if (secret) {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(token));
    return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function validateSession(supabase: any, sessionToken: string) {
  const tokenHash = await hashToken(sessionToken);
  const { data } = await supabase
    .from("sessions")
    .select("*, profile:profiles(*)")
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return data || null;
}

async function getOrCreateWallet(supabase: any, ownerType: "profile" | "supplier", ownerId: string) {
  const { data: existing } = await supabase
    .from("wallets").select("*")
    .eq("owner_type", ownerType).eq("owner_id", ownerId).maybeSingle();
  if (existing) return existing;

  let bonus = 0;
  let balance = 0;
  let pending = 0;
  if (ownerType === "profile") {
    const { data: b } = await supabase.from("user_bonuses").select("balance").eq("profile_id", ownerId).maybeSingle();
    bonus = Number(b?.balance || 0);
  } else {
    const { data: sb } = await supabase.from("shop_balances").select("available, pending").eq("supplier_id", ownerId).maybeSingle();
    balance = Number(sb?.available || 0);
    pending = Number(sb?.pending || 0);
  }
  const { data: created } = await supabase
    .from("wallets")
    .insert({ owner_type: ownerType, owner_id: ownerId, bonus_balance: bonus, balance, pending })
    .select().single();
  return created;
}

// Чи має профіль доступ до магазину: власник (telegram_id) або менеджер (лише перегляд).
async function supplierAccess(supabase: any, profile: any, supplierId: string) {
  const { data: supplier } = await supabase.from("suppliers").select("id, telegram_id, shop_name").eq("id", supplierId).maybeSingle();
  if (!supplier) return { access: false as const };
  if (profile?.telegram_id && supplier.telegram_id && Number(supplier.telegram_id) === Number(profile.telegram_id)) {
    return { access: true as const, role: "owner" as const, supplier };
  }
  const { data: link } = await supabase.from("shop_manager_links")
    .select("id").eq("supplier_id", supplierId).eq("profile_id", profile.id).maybeSingle();
  if (link) return { access: true as const, role: "manager" as const, supplier };
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", profile.id);
  const isAdmin = (roles || []).some((r: any) => r.role === "admin" || r.role === "moderator");
  if (isAdmin) return { access: true as const, role: "owner" as const, supplier };
  return { access: false as const };
}

// Клієнт має ЛИШЕ бонусний рахунок. Реальні кошти — тільки для постачальників/менеджерів/адмінів.
async function hasCashAccount(supabase: any, profile: any) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", profile.id);
  if ((roles || []).some((r: any) => ["admin", "moderator", "supplier", "shop_manager"].includes(r.role))) return true;
  if (profile?.telegram_id) {
    const { data: owned } = await supabase.from("suppliers").select("id").eq("telegram_id", profile.telegram_id).limit(1);
    if ((owned || []).length) return true;
  }
  const { data: link } = await supabase.from("shop_manager_links").select("id").eq("profile_id", profile.id).limit(1);
  return (link || []).length > 0;
}

const maskValue = (v: string) => {
  const digits = v.replace(/\s+/g, "");
  return digits.length <= 4 ? `**** ${digits}` : `**** ${digits.slice(-4)}`;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();
    const { action, session_token, supplier_id } = body || {};
    if (!action) return json({ error: "action required" }, 400);
    if (!session_token) return json({ error: "Invalid session" }, 401);

    const session = await validateSession(supabase, session_token);
    if (!session) return json({ error: "Invalid session" }, 401);
    const profile = session.profile;

    // Визначаємо, з яким рахунком працюємо: особистим чи магазину.
    let ownerType: "profile" | "supplier" = "profile";
    let ownerId: string = profile.id;
    let viewerRole: "owner" | "manager" = "owner";
    if (supplier_id) {
      const acc = await supplierAccess(supabase, profile, supplier_id);
      if (!acc.access) return json({ error: "Forbidden" }, 403);
      ownerType = "supplier";
      ownerId = supplier_id;
      viewerRole = acc.role;
    }

    const wallet = await getOrCreateWallet(supabase, ownerType, ownerId);

    // Тестова роль (лише для адміна/модератора) — щоб у прев'ю бачити рахунок очима іншої ролі.
    const { data: viewerRoles } = await supabase.from("user_roles").select("role").eq("user_id", profile.id);
    const viewerIsAdmin = (viewerRoles || []).some((r: any) => r.role === "admin" || r.role === "moderator");
    const previewRole = (viewerIsAdmin && typeof body.preview_role === "string"
      && ["guest", "customer", "supplier", "shop_manager", "moderator", "admin"].includes(body.preview_role))
      ? body.preview_role as string : null;

    const readOnly = viewerRole === "manager" || previewRole === "shop_manager";
    const mutating = ["connect_wallet", "create_topup", "pay_with_balance", "request_payout", "set_payout_settings"];
    if (readOnly && mutating.includes(action)) return json({ error: "Менеджеру доступний лише перегляд" }, 403);

    // Режим клієнта: лише бонуси, без реальних коштів, поповнень і виводів.
    const bonusOnly = previewRole
      ? (ownerType === "profile" && ["customer", "guest"].includes(previewRole))
      : ownerType === "profile" && !(await hasCashAccount(supabase, profile));
    const cashActions = ["connect_wallet", "create_topup", "request_payout", "set_payout_settings"];
    if (bonusOnly && cashActions.includes(action)) {
      return json({ error: "Для клієнтського рахунку доступні лише бонуси" }, 403);
    }

    const loadAccount = async () => {
      const bonusTypes = ["bonus_earn", "bonus_spend", "refund"];
      let txQuery = supabase.from("wallet_transactions").select("*").eq("wallet_id", wallet.id)
        .order("created_at", { ascending: false }).limit(60);
      if (bonusOnly) txQuery = txQuery.in("type", bonusTypes);

      const [{ data: fresh }, { data: txs }, limitsRes] = await Promise.all([
        supabase.from("wallets").select("*").eq("id", wallet.id).maybeSingle(),
        txQuery,
        bonusOnly ? Promise.resolve({ data: [] }) : supabase.from("wallet_limits").select("*").order("provider"),
      ]);
      const w = fresh || wallet;
      return {
        success: true,
        mode: SANDBOX ? "sandbox" : "live",
        read_only: readOnly,
        bonus_only: bonusOnly,
        wallet: {
          ...w,
          balance: bonusOnly ? 0 : Number(w.balance),
          pending: bonusOnly ? 0 : Number(w.pending),
          total: bonusOnly ? Number(w.bonus_balance) : Number(w.balance) + Number(w.bonus_balance),
        },
        transactions: txs || [],
        limits: (limitsRes as any)?.data || [],
      };
    };

    // ---------------- реквізити для повернення коштів (клієнт) ----------------
    if (action === "get_refund_method") {
      const { data } = await supabase.from("refund_methods")
        .select("id, method_type, masked_value, holder, bank_name, is_default, created_at")
        .eq("profile_id", profile.id).order("created_at", { ascending: false });
      return json({ success: true, methods: data || [] });
    }

    if (action === "save_refund_method") {
      const value = String(body.value || "").replace(/\s+/g, "");
      const methodType = body.method_type === "iban" ? "iban" : "card";
      const holder = typeof body.holder === "string" ? body.holder.trim() : null;
      if (methodType === "card" && !/^\d{12,19}$/.test(value)) return json({ error: "Некоректний номер картки" }, 400);
      if (methodType === "iban" && !/^UA\d{27}$/i.test(value)) return json({ error: "Некоректний IBAN" }, 400);

      await supabase.from("refund_methods").delete().eq("profile_id", profile.id);
      const { data, error } = await supabase.from("refund_methods").insert({
        profile_id: profile.id,
        method_type: methodType,
        masked_value: maskValue(value),
        full_value: value,
        holder,
        bank_name: typeof body.bank_name === "string" ? body.bank_name.trim() : null,
        is_default: true,
      }).select("id, method_type, masked_value, holder, bank_name, is_default, created_at").single();
      if (error) return json({ error: error.message }, 400);
      return json({ success: true, methods: [data] });
    }

    if (action === "delete_refund_method") {
      await supabase.from("refund_methods").delete().eq("profile_id", profile.id);
      return json({ success: true, methods: [] });
    }


    // ---------------- get_account ----------------
    if (action === "get_account") return json(await loadAccount());

    // ---------------- get_shops_summary ----------------
    // Агрегований баланс і статистика по всіх магазинах користувача (власник / менеджер / адмін).
    if (action === "get_shops_summary") {
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", profile.id);
      const isAdmin = (roles || []).some((r: any) => r.role === "admin" || r.role === "moderator");

      const shopMap = new Map<string, { id: string; shop_name: string; logo_url: string | null; role: "owner" | "manager" }>();

      if (isAdmin) {
        const { data: all } = await supabase.from("suppliers").select("id, shop_name, logo_url").limit(50);
        (all || []).forEach((s: any) => shopMap.set(s.id, { ...s, role: "owner" }));
      }
      if (profile.telegram_id) {
        const { data: owned } = await supabase.from("suppliers")
          .select("id, shop_name, logo_url").eq("telegram_id", profile.telegram_id);
        (owned || []).forEach((s: any) => shopMap.set(s.id, { ...s, role: "owner" }));
      }
      const { data: links } = await supabase.from("shop_manager_links")
        .select("supplier_id").eq("profile_id", profile.id);
      for (const l of links || []) {
        if (shopMap.has(l.supplier_id)) continue;
        const { data: s } = await supabase.from("suppliers")
          .select("id, shop_name, logo_url").eq("id", l.supplier_id).maybeSingle();
        if (s) shopMap.set(s.id, { ...s, role: "manager" });
      }

      const ids = [...shopMap.keys()];
      if (ids.length === 0) return json({ success: true, shops: [], totals: { available: 0, pending: 0, lifetime_paid: 0, orders: 0 } });

      const [{ data: balances }, { data: splits }, { data: shopWallets }] = await Promise.all([
        supabase.from("shop_balances").select("supplier_id, available, pending, lifetime_paid").in("supplier_id", ids),
        supabase.from("order_splits").select("supplier_id, supplier_amount, platform_commission, split_status, payout_stage").in("supplier_id", ids),
        supabase.from("wallets")
          .select("owner_id, balance, pending, bonus_balance, auto_withdraw, auto_withdraw_min, payout_provider")
          .eq("owner_type", "supplier").in("owner_id", ids),
      ]);

      const shops = ids.map((id) => {
        const meta = shopMap.get(id)!;
        const b = (balances || []).find((x: any) => x.supplier_id === id);
        const w = (shopWallets || []).find((x: any) => x.owner_id === id);
        const rows = (splits || []).filter((x: any) => x.supplier_id === id);
        const turnover = rows.reduce((s: number, r: any) => s + Number(r.supplier_amount || 0), 0);
        const commission = rows.reduce((s: number, r: any) => s + Number(r.platform_commission || 0), 0);
        const awaiting = rows.filter((r: any) => r.payout_stage && r.payout_stage !== "paid").length;
        return {
          id,
          shop_name: meta.shop_name,
          logo_url: meta.logo_url,
          role: meta.role,
          available: Number(w?.balance ?? b?.available ?? 0),
          pending: Number(w?.pending ?? b?.pending ?? 0),
          lifetime_paid: Number(b?.lifetime_paid || 0),
          orders: rows.length,
          awaiting_payout: awaiting,
          turnover: Math.round(turnover * 100) / 100,
          commission: Math.round(commission * 100) / 100,
          auto_withdraw: !!w?.auto_withdraw,
          auto_withdraw_min: Number(w?.auto_withdraw_min ?? 500),
          payout_provider: String(w?.payout_provider || "telegram_wallet"),
        };
      }).sort((a, b) => b.available - a.available);

      const totals = shops.reduce(
        (acc, s) => ({
          available: acc.available + s.available,
          pending: acc.pending + s.pending,
          lifetime_paid: acc.lifetime_paid + s.lifetime_paid,
          orders: acc.orders + s.orders,
          turnover: acc.turnover + s.turnover,
        }),
        { available: 0, pending: 0, lifetime_paid: 0, orders: 0, turnover: 0 },
      );

      return json({ success: true, mode: SANDBOX ? "sandbox" : "live", shops, totals });
    }


    // ---------------- connect_wallet ----------------
    if (action === "connect_wallet") {
      const address = typeof body.address === "string" ? body.address.trim() : "";
      const currency = body.currency === "TON" ? "TON" : "USDT";
      await supabase.from("wallets").update({
        is_connected: true,
        tg_wallet_address: address || wallet.tg_wallet_address || (SANDBOX ? fakeId("UQ") : null),
        tg_wallet_currency: currency,
        payout_provider: "telegram_wallet",
      }).eq("id", wallet.id);
      return json(await loadAccount());
    }

    // ---------------- create_topup ----------------
    if (action === "create_topup") {
      const amount = Number(body.amount);
      const provider = String(body.provider || "telegram_wallet");
      if (!amount || amount <= 0) return json({ error: "Некоректна сума" }, 400);

      const { data: limit } = await supabase.from("wallet_limits").select("*").eq("provider", provider).maybeSingle();
      if (limit && !limit.is_active && !SANDBOX) return json({ error: "Метод тимчасово недоступний" }, 400);

      const { data: tx } = await supabase.from("wallet_transactions").insert({
        wallet_id: wallet.id, type: "topup", amount, provider,
        status: SANDBOX ? "completed" : "pending",
        external_id: fakeId("TOPUP"),
        description: "Поповнення рахунку",
        receipt: { provider, amount, at: new Date().toISOString(), mode: SANDBOX ? "sandbox" : "live" },
      }).select().single();

      let payLink: string | null = null;
      if (!SANDBOX && provider === "telegram_wallet") {
        const res = await fetch("https://pay.wallet.tg/wpay/store-api/v1/order", {
          method: "POST",
          headers: { "Wpay-Store-Api-Key": WALLET_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: { currencyCode: "UAH", amount: amount.toFixed(2) },
            description: "Поповнення рахунку Taverna",
            externalId: tx.id,
            timeoutSeconds: 3600,
            customerTelegramUserId: profile.telegram_id ?? undefined,
            autoConversionCurrency: "USDT",
          }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || out?.status !== "SUCCESS") {
          console.error("wallet-account topup failed", res.status, JSON.stringify(out));
          return json({ error: "Wallet Pay недоступний", details: out }, 502);
        }
        payLink = out.data?.directPayLink || out.data?.payLink || null;
        await supabase.from("wallet_transactions")
          .update({ external_id: String(out.data?.id), receipt: out.data }).eq("id", tx.id);
      } else {
        // sandbox: зараховуємо одразу, щоб потік був повністю видимий у прев'ю
        await supabase.from("wallets")
          .update({ balance: Number(wallet.balance) + amount }).eq("id", wallet.id);
      }

      const account = await loadAccount();
      return json({ ...account, transaction_id: tx.id, pay_link: payLink });
    }

    // ---------------- check_topup: миттєве зарахування після оплати в Telegram Wallet ----------------
    if (action === "check_topup") {
      const txId = String(body.transaction_id || "");
      if (!txId) return json({ error: "transaction_id required" }, 400);

      const { data: tx } = await supabase.from("wallet_transactions")
        .select("*").eq("id", txId).eq("wallet_id", wallet.id).maybeSingle();
      if (!tx) return json({ error: "Транзакцію не знайдено" }, 404);

      if (tx.status === "completed") {
        return json({ ...(await loadAccount()), topup_status: "completed" });
      }

      let paid = false;
      if (!SANDBOX && tx.provider === "telegram_wallet" && tx.external_id) {
        const res = await fetch(
          `https://pay.wallet.tg/wpay/store-api/v1/order/preview?id=${encodeURIComponent(tx.external_id)}`,
          { headers: { "Wpay-Store-Api-Key": WALLET_API_KEY } },
        );
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error("wallet-account check_topup failed", res.status, JSON.stringify(out));
          return json({ error: "Wallet Pay недоступний", details: out }, 502);
        }
        const status = String(out?.data?.status || "");
        paid = status === "PAID";
        if (["EXPIRED", "CANCELLED"].includes(status)) {
          await supabase.from("wallet_transactions").update({ status: "failed" }).eq("id", tx.id);
          return json({ ...(await loadAccount()), topup_status: "failed" });
        }
      }

      if (!paid) return json({ ...(await loadAccount()), topup_status: tx.status });

      // Атомарно: зараховуємо лише якщо транзакція ще pending
      const { data: claimed } = await supabase.from("wallet_transactions")
        .update({ status: "completed" }).eq("id", tx.id).eq("status", "pending").select("id").maybeSingle();
      if (claimed) {
        const { data: fresh } = await supabase.from("wallets").select("balance").eq("id", wallet.id).maybeSingle();
        await supabase.from("wallets")
          .update({ balance: Number(fresh?.balance || 0) + Number(tx.amount) }).eq("id", wallet.id);
      }
      return json({ ...(await loadAccount()), topup_status: "completed" });
    }


    // ---------------- pay_with_balance ----------------
    if (action === "pay_with_balance") {
      const { order_id, use_bonus = true } = body;
      if (!order_id) return json({ error: "order_id required" }, 400);
      const { data: order } = await supabase.from("orders")
        .select("id, order_number, total, profile_id, payment_status").eq("id", order_id).maybeSingle();
      if (!order) return json({ error: "Замовлення не знайдено" }, 404);
      if (order.profile_id && order.profile_id !== profile.id) return json({ error: "Forbidden" }, 403);
      if (order.payment_status === "paid") return json({ error: "Замовлення вже оплачено" }, 400);

      const total = Number(order.total); // сума завжди береться з бази, не з клієнта
      const { data: w } = await supabase.from("wallets").select("*").eq("id", wallet.id).maybeSingle();
      const bonusCap = use_bonus ? Math.min(Number(w.bonus_balance), Math.floor(total * BONUS_CART_SHARE)) : 0;
      const cashNeeded = total - bonusCap;
      if (Number(w.balance) < cashNeeded) {
        return json({
          success: false,
          error: "Недостатньо коштів",
          shortfall: Math.round((cashNeeded - Number(w.balance)) * 100) / 100,
          bonus_applied: bonusCap,
        }, 200);
      }

      await supabase.from("wallets").update({
        balance: Number(w.balance) - cashNeeded,
        bonus_balance: Number(w.bonus_balance) - bonusCap,
      }).eq("id", wallet.id);

      const receipt = {
        order_number: order.order_number, total, paid_with_balance: cashNeeded,
        bonus_used: bonusCap, at: new Date().toISOString(), method: "Рахунок Taverna",
      };
      await supabase.from("wallet_transactions").insert({
        wallet_id: wallet.id, type: "payment", amount: cashNeeded, bonus_amount: bonusCap,
        provider: "internal", status: "completed", order_id: order.id,
        external_id: fakeId("PAY"),
        description: `Оплата замовлення ${order.order_number || order.id.slice(0, 8)}`,
        receipt,
      });
      if (bonusCap > 0) {
        const { data: ub } = await supabase.from("user_bonuses").select("*").eq("profile_id", profile.id).maybeSingle();
        if (ub) {
          await supabase.from("user_bonuses").update({
            balance: Math.max(0, Number(ub.balance || 0) - bonusCap),
            total_spent: Number(ub.total_spent || 0) + bonusCap,
          }).eq("id", ub.id);
        }
      }

      await supabase.from("orders").update({ payment_status: "paid", payment_method: "taverna_balance" }).eq("id", order.id);
      await supabase.from("order_splits").update({ payment_method: "prepaid", payout_type: "full_amount" }).eq("order_id", order.id);

      const account = await loadAccount();
      return json({ ...account, paid: true, receipt });
    }

    // ---------------- request_payout ----------------
    if (action === "request_payout") {
      const amount = Number(body.amount);
      const provider = String(body.provider || "telegram_wallet");
      const destination = typeof body.destination === "string" ? body.destination.trim() : "";
      if (!amount || amount <= 0) return json({ error: "Некоректна сума" }, 400);

      const { data: w } = await supabase.from("wallets").select("*").eq("id", wallet.id).maybeSingle();
      if (Number(w.balance) < amount) return json({ error: "Недостатньо коштів для виводу" }, 400);

      const { data: limit } = await supabase.from("wallet_limits").select("*").eq("provider", provider).maybeSingle();
      if (limit) {
        if (!limit.is_active && !SANDBOX) return json({ error: "Метод виводу недоступний" }, 400);
        if (amount < Number(limit.min_payout)) return json({ error: `Мінімальна сума виводу — ${limit.min_payout}₴` }, 400);
        if (amount > Number(limit.max_payout)) return json({ error: `Максимальна сума виводу — ${limit.max_payout}₴` }, 400);
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { data: recent } = await supabase.from("wallet_transactions")
          .select("amount").eq("wallet_id", wallet.id).eq("type", "payout").gte("created_at", since);
        const used = (recent || []).reduce((s: number, r: any) => s + Number(r.amount), 0);
        if (used + amount > Number(limit.daily_limit))
          return json({ error: `Добовий ліміт ${limit.daily_limit}₴ вичерпано` }, 400);
      }
      // Комісія платформи + комісія платіжного методу
      const PLATFORM_FEE_PERCENT = 1.5;
      const PLATFORM_FEE_MIN = 5;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const platformFee = r2(Math.max(PLATFORM_FEE_MIN, amount * PLATFORM_FEE_PERCENT / 100));
      const providerFee = limit ? r2(amount * Number(limit.fee_percent) / 100 + Number(limit.fee_fixed)) : 0;
      const fee = r2(platformFee + providerFee);
      const net = r2(amount - fee);
      if (net <= 0) return json({ error: "Сума виводу менша за комісію" }, 400);

      let txId = fakeId("PAYOUT");
      let status = "pending";
      if (SANDBOX) {
        status = "completed";
      } else if (provider === "telegram_wallet") {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/wallet-pay`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-key": SERVICE_KEY },
          body: JSON.stringify({
            action: "create_payout", amount: net, supplier_id: ownerType === "supplier" ? ownerId : profile.id,
            wallet_address: destination || w.tg_wallet_address, currency: w.tg_wallet_currency || "USDT",
          }),
        });
        const out = await res.json().catch(() => ({}));
        if (!out?.ok) return json({ error: out?.error || "Вивід не вдався" }, 502);
        txId = out.tx_id;
        status = "completed";
      }

      await supabase.from("wallets").update({ balance: Number(w.balance) - amount }).eq("id", wallet.id);
      await supabase.from("wallet_transactions").insert({
        wallet_id: wallet.id, type: "payout", amount, provider, status, external_id: txId,
        description: `Вивід коштів (${provider})`,
        receipt: { amount, fee, platform_fee: platformFee, provider_fee: providerFee, net, provider, destination: destination || w.tg_wallet_address, at: new Date().toISOString() },
      });

      return json(await loadAccount());
    }

    // ---------------- set_payout_settings ----------------
    if (action === "set_payout_settings") {
      const patch: Record<string, unknown> = {};
      if (body.payout_provider) patch.payout_provider = String(body.payout_provider);
      if (typeof body.auto_withdraw === "boolean") patch.auto_withdraw = body.auto_withdraw;
      if (body.auto_withdraw_min != null) patch.auto_withdraw_min = Number(body.auto_withdraw_min);
      if (typeof body.address === "string") patch.tg_wallet_address = body.address.trim();
      if (body.currency) patch.tg_wallet_currency = body.currency === "TON" ? "TON" : "USDT";
      await supabase.from("wallets").update(patch).eq("id", wallet.id);
      return json(await loadAccount());
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e: any) {
    console.error("wallet-account error", e);
    return json({ error: e?.message || "Internal error" }, 500);
  }
});
