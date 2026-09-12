import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key",
};

// ---- provider availability (sandbox if secrets are missing) ----
const MONOBANK_TOKEN = Deno.env.get("MONOBANK_TOKEN") || "";
const LIQPAY_PUBLIC = Deno.env.get("LIQPAY_PUBLIC_KEY") || "";
const LIQPAY_PRIVATE = Deno.env.get("LIQPAY_PRIVATE_KEY") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WALLET_MODE: "live" | "sandbox" = Deno.env.get("WALLET_PAY_API_KEY") ? "live" : "sandbox";

function providerMode(provider: string): "live" | "sandbox" {
  if (provider === "monobank") return MONOBANK_TOKEN ? "live" : "sandbox";
  if (provider === "liqpay") return LIQPAY_PUBLIC && LIQPAY_PRIVATE ? "live" : "sandbox";
  return "sandbox";
}

function fakeTx(prefix: string): string {
  return `${prefix}-SBX-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- session / role helpers ----
async function hashToken(token: string): Promise<string> {
  const secret = Deno.env.get("SESSION_HMAC_SECRET") || "";
  const encoder = new TextEncoder();
  if (secret) {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(token));
    return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function validateSession(supabase: any, sessionToken: string) {
  const tokenHash = await hashToken(sessionToken);
  const { data } = await supabase
    .from("sessions")
    .select("*, profile:profiles(*)")
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .single();
  return data || null;
}
async function getRoles(supabase: any, profileId: string): Promise<string[]> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", profileId);
  return (data || []).map((r: any) => r.role);
}
async function canManageSupplier(
  supabase: any,
  profileId: string,
  supplierId: string,
  telegramId: number | null,
): Promise<boolean> {
  // Suppliers are linked to their owner via telegram_id (no profile_id column).
  if (telegramId != null) {
    const { data: sup } = await supabase
      .from("suppliers").select("telegram_id").eq("id", supplierId).maybeSingle();
    if (sup && Number(sup.telegram_id) === Number(telegramId)) return true;
  }
  // Managers are linked via shop_manager_links.
  const { data: link } = await supabase
    .from("shop_manager_links").select("id")
    .eq("supplier_id", supplierId).eq("profile_id", profileId).maybeSingle();
  return !!link;
}

// Resolve the caller's access level for a shop.
// "staff" = admin/moderator, "owner" = shop owner (full control),
// "manager" = linked manager (read-only), null = no access.
async function getShopAccess(
  supabase: any,
  profileId: string | null,
  supplierId: string,
  telegramId: number | null,
  isStaff: boolean,
  previewRole?: string | null,
): Promise<"staff" | "owner" | "manager" | null> {
  // Dev preview downgrade (only ever set for real admins) — never elevates.
  if (previewRole) {
      if (previewRole === "admin") return "staff";
    if (previewRole === "supplier") return "owner";
    if (previewRole === "shop_manager") return "manager";
    if (previewRole === "moderator") return "staff";
    return null; // customer / guest have no financial access
  }
  if (isStaff) return "staff";
  if (telegramId != null) {
    const { data: sup } = await supabase
      .from("suppliers").select("telegram_id").eq("id", supplierId).maybeSingle();
    if (sup && Number(sup.telegram_id) === Number(telegramId)) return "owner";
  }
  if (profileId) {
    const { data: link } = await supabase
      .from("shop_manager_links").select("id")
      .eq("supplier_id", supplierId).eq("profile_id", profileId).maybeSingle();
    if (link) return "manager";
  }
  return null;
}

// Returns all supplier (shop) ids the caller owns (by telegram_id) or manages.
async function getCallerShopIds(
  supabase: any,
  profileId: string | null,
  telegramId: number | null,
): Promise<string[]> {
  const ids = new Set<string>();
  if (telegramId != null) {
    const { data } = await supabase.from("suppliers").select("id").eq("telegram_id", telegramId);
    (data || []).forEach((s: any) => ids.add(s.id));
  }
  if (profileId) {
    const { data } = await supabase.from("shop_manager_links").select("supplier_id").eq("profile_id", profileId);
    (data || []).forEach((l: any) => ids.add(l.supplier_id));
  }
  return [...ids];
}

// ---- stats helpers (earnings breakdown by period + products sold) ----
type StatPeriod = "day" | "week" | "month" | "year";
const pad2 = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const yearKey = (d: Date) => `${d.getFullYear()}`;
function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((((t.getTime() - firstThu.getTime()) / 86400000) - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${pad2(week)}`;
}
function keyForPeriod(period: StatPeriod, dateStr: string): string {
  const d = new Date(dateStr);
  return period === "day" ? dayKey(d) : period === "week" ? weekKey(d) : period === "month" ? monthKey(d) : yearKey(d);
}
function makeBuckets(period: StatPeriod): { key: string; label: string }[] {
  const now = new Date();
  const arr: { key: string; label: string }[] = [];
  if (period === "day") {
    for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); arr.push({ key: dayKey(d), label: `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}` }); }
  } else if (period === "week") {
    for (let i = 11; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i * 7); const k = weekKey(d); arr.push({ key: k, label: `${k.split("-W")[1]} тиж` }); }
  } else if (period === "month") {
    const names = ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"];
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); arr.push({ key: monthKey(d), label: `${names[d.getMonth()]} ${d.getFullYear()}` }); }
  } else {
    for (let i = 4; i >= 0; i--) { const y = now.getFullYear() - i; arr.push({ key: String(y), label: String(y) }); }
  }
  return arr;
}
function buildStats(splits: any[], items: any[]) {
  const periods: StatPeriod[] = ["day", "week", "month", "year"];
  const series: Record<string, any[]> = {};
  for (const period of periods) {
    const buckets = makeBuckets(period);
    const map: Record<string, any> = {};
    buckets.forEach((b) => { map[b.key] = { label: b.label, turnover: 0, earned: 0, productsSold: 0, amount: 0 }; });
    for (const s of splits) {
      const k = keyForPeriod(period, s.created_at);
      if (map[k]) { map[k].turnover += Number(s.product_total || 0); map[k].earned += Number(s.supplier_amount || 0); }
    }
    for (const it of items) {
      const k = keyForPeriod(period, it.created_at);
      if (map[k]) { map[k].productsSold += Number(it.quantity || 0); map[k].amount += Number(it.total || 0); }
    }
    series[period] = buckets.map((b) => ({ ...map[b.key] }));
  }
  return series;
}

// ---- ledger core ----
async function applyMovement(
  supabase: any,
  supplierId: string,
  m: { type: string; amount: number; status?: string; provider?: string; external_tx_id?: string; description?: string; order_split_id?: string | null },
) {
  // ensure balance row exists
  let { data: bal } = await supabase.from("shop_balances").select("*").eq("supplier_id", supplierId).maybeSingle();
  if (!bal) {
    const { data: created } = await supabase.from("shop_balances")
      .insert({ supplier_id: supplierId }).select().single();
    bal = created;
  }
  const status = m.status || "settled";
  let available = Number(bal.available);
  let lifetimePaid = Number(bal.lifetime_paid);
  if (status === "settled") {
    available += m.amount;
    if (m.type === "withdrawal") lifetimePaid += Math.abs(m.amount);
  }
  await supabase.from("shop_balances").update({
    available: Math.round(available * 100) / 100,
    lifetime_paid: Math.round(lifetimePaid * 100) / 100,
  }).eq("supplier_id", supplierId);

  const { data: mv } = await supabase.from("balance_movements").insert({
    supplier_id: supplierId,
    order_split_id: m.order_split_id || null,
    type: m.type,
    amount: m.amount,
    balance_after: Math.round(available * 100) / 100,
    status,
    provider: m.provider || "internal",
    external_tx_id: m.external_tx_id || null,
    description: m.description || null,
  }).select().single();
  return { balance_after: available, movement: mv };
}

// ---- provider: Telegram Wallet payout (delegated to the wallet-pay function) ----
async function walletPayout(
  amount: number,
  dest: { wallet_address?: string; wallet_currency?: string; supplier_id?: string },
) {
  if (!dest.wallet_address) return { ok: false, error: "Не вказано адресу Telegram Wallet", mode: "sandbox" as const };
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wallet-pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        action: "create_payout",
        amount,
        wallet_address: dest.wallet_address,
        currency: dest.wallet_currency || "USDT",
        supplier_id: dest.supplier_id,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out?.ok) return { ok: false, error: out?.error || `HTTP ${res.status}`, mode: out?.mode || "sandbox" };
    return { ok: true, tx_id: out.tx_id, mode: out.mode };
  } catch (e: any) {
    return { ok: false, error: e.message, mode: "sandbox" as const };
  }
}

// ---- provider: outgoing payout to supplier ----
async function providerPayout(
  provider: string,
  amount: number,
  dest: { iban?: string; card_token?: string; holder?: string; wallet_address?: string; wallet_currency?: string; supplier_id?: string },
) {
  if (provider === "telegram_wallet") return await walletPayout(amount, dest);
  const mode = providerMode(provider);
  if (mode === "sandbox") {
    return { ok: true, tx_id: fakeTx(provider.toUpperCase() + "-PAYOUT"), mode };
  }

  // LIVE: real outgoing transfer (FOP business / payout API)
  try {
    if (provider === "liqpay" && dest.card_token) {
      // LiqPay p2pcredit to a tokenized card
      const payload = btoa(JSON.stringify({
        public_key: LIQPAY_PUBLIC, version: 3, action: "p2pcredit",
        amount, currency: "UAH", card_token: dest.card_token,
        description: "Taverna payout", order_id: fakeTx("ord"),
      }));
      const sig = await liqpaySignature(payload);
      const res = await fetch("https://www.liqpay.ua/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(payload)}&signature=${encodeURIComponent(sig)}`,
      });
      const json = await res.json();
      return { ok: json.status === "success" || json.result === "ok", tx_id: json.transaction_id || json.payment_id || fakeTx("LP"), mode, raw: json };
    }
    // monobank business payouts require statement/payment API — placeholder live path
    return { ok: true, tx_id: fakeTx("MONO-PAYOUT"), mode: "sandbox" as const };
  } catch (e: any) {
    return { ok: false, error: e.message, mode };
  }
}

// ---- provider: charge our markup from supplier's bound card (COD) ----
async function providerCharge(provider: string, amount: number, cardToken: string) {
  const mode = providerMode(provider);
  if (mode === "sandbox" || !cardToken) {
    return { ok: true, tx_id: fakeTx(provider.toUpperCase() + "-CHARGE"), mode };
  }
  try {
    const payload = btoa(JSON.stringify({
      public_key: LIQPAY_PUBLIC, version: 3, action: "paytoken",
      amount, currency: "UAH", card_token: cardToken,
      description: "Taverna markup", order_id: fakeTx("chg"),
    }));
    const sig = await liqpaySignature(payload);
    const res = await fetch("https://www.liqpay.ua/api/request", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(payload)}&signature=${encodeURIComponent(sig)}`,
    });
    const json = await res.json();
    return { ok: json.status === "success", tx_id: json.transaction_id || fakeTx("LP"), mode, raw: json };
  } catch (e: any) {
    return { ok: false, error: e.message, mode };
  }
}

async function liqpaySignature(data: string): Promise<string> {
  const str = LIQPAY_PRIVATE + data + LIQPAY_PRIVATE;
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);
    const body = await req.json();
    const { action } = body;

    // internal calls (cron / other functions) authenticate with the service key
    const internalKey = req.headers.get("x-internal-key");
    const isInternal = internalKey === SERVICE_KEY;

    // resolve caller for user actions
    let profileId: string | null = null;
    let telegramId: number | null = null;
    let roles: string[] = [];
    if (!isInternal) {
      if (!body.session_token) return json({ error: "session_token required" }, 401);
      const session = await validateSession(supabase, body.session_token);
      if (!session) return json({ error: "Invalid session" }, 401);
      profileId = session.profile.id;
      telegramId = session.profile.telegram_id ?? null;
      roles = await getRoles(supabase, profileId);
    }
    const isAdmin = roles.includes("admin");
    const isModerator = roles.includes("moderator");
    const isStaff = isAdmin || isModerator;
    // Dev role preview: only honored for real admins (never based on a hardcoded profile/telegram id).
    const previewRole = (isAdmin && typeof body.preview_role === "string"
      && ["guest", "customer", "supplier", "shop_manager", "moderator", "admin"].includes(body.preview_role))
      ? body.preview_role : null;

    if (previewRole === "guest" || previewRole === "customer") {
      if (["get_balance", "list_movements", "list_payouts", "set_payout_method", "bind_card", "request_withdrawal", "list_my_shops", "list_shop_payments", "get_stats"].includes(action)) {
        if (action === "list_my_shops") return json({ rows: [], providers: { monobank: providerMode("monobank"), liqpay: providerMode("liqpay"), telegram_wallet: WALLET_MODE } });
        if (action === "get_stats") return json({ totals: { turnover: 0, earned: 0, processing: 0, productsSold: 0, productsAmount: 0, ordersCount: 0 }, series: buildStats([], []) });
        return json({ error: "Forbidden" }, 403);
      }
    }
    // Effective "can see everything" flag for list/stats when previewing supplier/manager/mod.
    const seesAll = isStaff || !!(previewRole && previewRole !== "guest" && previewRole !== "customer");

    // ---------------- get_balance ----------------
    if (action === "get_balance") {
      const { supplier_id } = body;
      if (!supplier_id) return json({ error: "supplier_id required" }, 400);
      const access = await getShopAccess(supabase, profileId, supplier_id, telegramId, isStaff, previewRole);
      if (!access) return json({ error: "Forbidden" }, 403);
      if (access === "manager") return json({ error: "Forbidden: manager payment-status view only" }, 403);

      let { data: bal } = await supabase.from("shop_balances").select("*").eq("supplier_id", supplier_id).maybeSingle();
      if (!bal) {
        const { data: created } = await supabase.from("shop_balances").insert({ supplier_id }).select().single();
        bal = created;
      }
      const { data: method } = await supabase.from("payout_methods")
        .select("id, provider, type, masked_pan, holder, iban, is_default, auto_withdraw, auto_charge, min_withdraw")
        .eq("supplier_id", supplier_id).eq("is_default", true).maybeSingle();
      // managers get read-only view (owner controls payouts/cards)
      const canManage = access === "owner" || (access === "staff" && (isAdmin || previewRole === "admin") && previewRole !== "moderator");
      return json({ balance: bal, method: method || null, access, canManage, providers: { monobank: providerMode("monobank"), liqpay: providerMode("liqpay"), telegram_wallet: WALLET_MODE } });
    }


    // ---------------- list_balances (staff: all shops) ----------------
    if (action === "list_balances") {
      if (!isStaff && previewRole !== "admin" && previewRole !== "moderator") return json({ error: "Forbidden" }, 403);
      const { data: suppliers } = await supabase.from("suppliers")
        .select("id, shop_name, is_active").order("shop_name");
      const { data: balances } = await supabase.from("shop_balances").select("*");
      const { data: methods } = await supabase.from("payout_methods").select("*").eq("is_default", true);
      const balMap: Record<string, any> = {};
      (balances || []).forEach((b: any) => { balMap[b.supplier_id] = b; });
      const methodMap: Record<string, any> = {};
      (methods || []).forEach((m: any) => { methodMap[m.supplier_id] = m; });
      const rows = (suppliers || []).map((s: any) => ({
        supplier_id: s.id,
        shop_name: s.shop_name,
        is_active: s.is_active,
        available: Number(balMap[s.id]?.available || 0),
        lifetime_paid: Number(balMap[s.id]?.lifetime_paid || 0),
        currency: balMap[s.id]?.currency || "UAH",
        method: methodMap[s.id]
          ? {
              type: methodMap[s.id].type, provider: methodMap[s.id].provider,
              masked_pan: methodMap[s.id].masked_pan, iban: isAdmin ? methodMap[s.id].iban : null,
              auto_withdraw: methodMap[s.id].auto_withdraw, auto_charge: methodMap[s.id].auto_charge,
              min_withdraw: methodMap[s.id].min_withdraw,
            }
          : null,
      }));
      return json({ rows, role: (isAdmin || previewRole === "admin") ? "admin" : "moderator", providers: { monobank: providerMode("monobank"), liqpay: providerMode("liqpay"), telegram_wallet: WALLET_MODE } });
    }

    // ---------------- list_movements ----------------
    if (action === "list_movements") {
      const { supplier_id } = body;
      if (!supplier_id) return json({ error: "supplier_id required" }, 400);
      const access = await getShopAccess(supabase, profileId, supplier_id, telegramId, isStaff, previewRole);
      if (!access) return json({ error: "Forbidden" }, 403);
      if (access === "manager") return json({ error: "Forbidden: manager payment-status view only" }, 403);
      const { data } = await supabase.from("balance_movements")
        .select("*").eq("supplier_id", supplier_id).order("created_at", { ascending: false }).limit(200);
      return json({ movements: data || [] });
    }

    // ---------------- list_payouts ----------------
    if (action === "list_payouts") {
      const { supplier_id } = body;
      if (!supplier_id) return json({ error: "supplier_id required" }, 400);
      const access = await getShopAccess(supabase, profileId, supplier_id, telegramId, isStaff, previewRole);
      if (!access) return json({ error: "Forbidden" }, 403);
      if (access === "manager") return json({ error: "Forbidden: manager payment-status view only" }, 403);
      const { data } = await supabase.from("supplier_payouts")
        .select("id, amount, payout_method, payout_status, transaction_id, scheduled_at, processed_at, created_at")
        .eq("supplier_id", supplier_id)
        .order("created_at", { ascending: false })
        .limit(100);
      return json({ payouts: data || [] });
    }

    // ---------------- set_payout_method (supplier/staff) ----------------
    if (action === "set_payout_method") {
      const { supplier_id, auto_withdraw, auto_charge, min_withdraw, iban, holder, provider, wallet_address, wallet_currency } = body;
      if (!supplier_id) return json({ error: "supplier_id required" }, 400);
      {
        const access = await getShopAccess(supabase, profileId, supplier_id, telegramId, isStaff, previewRole);
        if (access !== "owner" && !(access === "staff" && (isAdmin || previewRole === "admin")))
          return json({ error: "Forbidden: read-only (керує власник магазину)" }, 403);
        if (previewRole === "moderator")
          return json({ error: "Forbidden: moderator view-only" }, 403);
      }

      const { data: existing } = await supabase.from("payout_methods")
        .select("id").eq("supplier_id", supplier_id).eq("is_default", true).maybeSingle();
      const patch: any = {};
      if (auto_withdraw !== undefined) patch.auto_withdraw = auto_withdraw;
      if (auto_charge !== undefined) patch.auto_charge = auto_charge;
      if (min_withdraw !== undefined) patch.min_withdraw = min_withdraw;
      if (iban !== undefined) { patch.iban = iban; patch.type = "iban"; }
      if (holder !== undefined) patch.holder = holder;
      if (wallet_address !== undefined) {
        patch.wallet_address = wallet_address;
        patch.provider = "telegram_wallet";
        patch.type = "wallet";
      }
      if (wallet_currency !== undefined) patch.wallet_currency = wallet_currency;
      if (provider !== undefined && ["liqpay", "monobank", "telegram_wallet"].includes(provider)) {
        patch.provider = provider;
        if (provider === "telegram_wallet") patch.type = "wallet";
      }


      if (existing) {
        await supabase.from("payout_methods").update(patch).eq("id", existing.id);
      } else {
        await supabase.from("payout_methods").insert({ supplier_id, is_default: true, ...patch });
      }
      return json({ success: true });
    }

    // ---------------- bind_card (supplier/staff) ----------------
    // Stores only masked PAN + provider token (never raw PAN/CVV in DB).
    if (action === "bind_card") {
      const { supplier_id, card_number, holder, provider = "liqpay" } = body;
      if (!supplier_id || !card_number) return json({ error: "supplier_id and card_number required" }, 400);
      {
        const access = await getShopAccess(supabase, profileId, supplier_id, telegramId, isStaff, previewRole);
        if (access !== "owner" && !(access === "staff" && (isAdmin || previewRole === "admin")))
          return json({ error: "Forbidden: read-only (керує власник магазину)" }, 403);
        if (previewRole === "moderator")
          return json({ error: "Forbidden: moderator view-only" }, 403);
      }

      const digits = String(card_number).replace(/\D/g, "");
      if (digits.length < 12) return json({ error: "Invalid card number" }, 400);
      const masked = `**** **** **** ${digits.slice(-4)}`;
      // sandbox/live tokenization — store provider token reference, not the PAN
      const token = providerMode(provider) === "live"
        ? `tok_${provider}_${digits.slice(-4)}_${Date.now()}` // real flow returns token from provider widget
        : `tok_sbx_${digits.slice(-4)}_${Date.now()}`;

      const { data: existing } = await supabase.from("payout_methods")
        .select("id").eq("supplier_id", supplier_id).eq("is_default", true).maybeSingle();
      const payload = { provider, type: "card", masked_pan: masked, card_token: token, holder: holder || null };
      if (existing) await supabase.from("payout_methods").update(payload).eq("id", existing.id);
      else await supabase.from("payout_methods").insert({ supplier_id, is_default: true, ...payload });

      return json({ success: true, masked_pan: masked, mode: providerMode(provider) });
    }

    // ---------------- run_accruals (internal) ----------------
    // Convert eligible paid splits into +drop accruals and -markup debits on the balance.
    if (action === "run_accruals") {
      if (!isInternal && !isAdmin) return json({ error: "Forbidden" }, 403);
      const nowIso = new Date().toISOString();
      const { data: due } = await supabase.from("order_splits")
        .select("*").eq("payout_stage", "created")
        .not("eligible_payout_at", "is", null).lte("eligible_payout_at", nowIso)
        .is("balance_movement_id", null).limit(100);

      const processed: string[] = [];
      for (const s of due || []) {
        // +supplier_amount (we owe supplier for the drop cost)
        const accrual = await applyMovement(supabase, s.supplier_id, {
          type: "payout_accrual", amount: Number(s.supplier_amount), provider: "internal",
          order_split_id: s.id, description: `Нарахування за замовлення ${s.order_id?.slice(0, 8)}`,
        });
        // COD: supplier received full cash at delivery, owes us the markup → -commission
        const isCod = s.payout_type === "partial_markup" || s.payment_method === "cod" || s.payment_method === "cash_on_delivery";
        if (isCod && Number(s.platform_commission) > 0) {
          await applyMovement(supabase, s.supplier_id, {
            type: "markup_debit", amount: -Number(s.platform_commission), provider: "internal",
            order_split_id: s.id, description: `Наша націнка (наложений) ${s.order_id?.slice(0, 8)}`,
          });
        }
        await supabase.from("order_splits").update({
          payout_stage: "paid", split_status: "accrued", paid_at: nowIso, balance_movement_id: accrual.movement.id,
        }).eq("id", s.id);
        processed.push(s.id);
      }
      return json({ success: true, accrued: processed.length });
    }

    // ---------------- request_withdrawal (supplier manual) / admin_payout ----------------
    if (action === "request_withdrawal" || action === "admin_payout") {
      const { supplier_id } = body;
      if (!supplier_id) return json({ error: "supplier_id required" }, 400);
      if (action === "admin_payout" && !isAdmin && !isInternal) return json({ error: "Forbidden: admin required" }, 403);
      if (action === "request_withdrawal") {
        const access = await getShopAccess(supabase, profileId, supplier_id, telegramId, isStaff, previewRole);
        if (access !== "owner" && !(access === "staff" && (isAdmin || previewRole === "admin")))
          return json({ error: "Forbidden: read-only (керує власник магазину)" }, 403);
        if (previewRole === "moderator")
          return json({ error: "Forbidden: moderator view-only" }, 403);
      }

      const { data: bal } = await supabase.from("shop_balances").select("*").eq("supplier_id", supplier_id).maybeSingle();
      const { data: method } = await supabase.from("payout_methods")
        .select("*").eq("supplier_id", supplier_id).eq("is_default", true).maybeSingle();
      const { data: sup } = await supabase.from("suppliers")
        .select("payment_iban, payment_card_holder").eq("id", supplier_id).single();

      const available = Number(bal?.available || 0);
      const min = Number(method?.min_withdraw || 0);
      const amount = Number(body.amount || available);
      if (available <= 0 || amount <= 0) return json({ error: "Недостатньо коштів на балансі" }, 400);
      if (amount > available) return json({ error: "Сума перевищує доступний баланс" }, 400);
      if (action === "request_withdrawal" && amount < min) return json({ error: `Мінімальна сума виводу ${min}₴` }, 400);

      const provider = method?.provider || "liqpay";
      const dest = {
        iban: method?.iban || sup?.payment_iban,
        card_token: method?.card_token,
        holder: method?.holder || sup?.payment_card_holder,
        wallet_address: method?.wallet_address,
        wallet_currency: method?.wallet_currency,
        supplier_id,
      };
      const result = await providerPayout(provider, amount, dest);

      if (!result.ok) {
        await applyMovement(supabase, supplier_id, {
          type: "withdrawal", amount: -amount, status: "failed", provider,
          description: `Помилка виводу: ${result.error || "невідомо"}`,
        });
        return json({ error: "Переказ не вдався", detail: result.error }, 502);
      }
      const mv = await applyMovement(supabase, supplier_id, {
        type: "withdrawal", amount: -amount, status: "settled", provider, external_tx_id: result.tx_id,
        description: `Вивід коштів (${result.mode})`,
      });
      // record in supplier_payouts for history compatibility
      await supabase.from("supplier_payouts").insert({
        supplier_id, amount, payout_method: `${provider}_${result.mode}`,
        payout_status: "completed", iban: dest.iban || null, transaction_id: result.tx_id, processed_at: new Date().toISOString(),
      });
      return json({ success: true, tx_id: result.tx_id, mode: result.mode, balance_after: mv.balance_after });
    }

    // ---------------- run_auto_withdrawals (internal cron) ----------------
    if (action === "run_auto_withdrawals") {
      if (!isInternal && !isAdmin) return json({ error: "Forbidden" }, 403);
      const { data: methods } = await supabase.from("payout_methods").select("*").eq("auto_withdraw", true);
      const results: any[] = [];
      for (const method of methods || []) {
        const { data: bal } = await supabase.from("shop_balances").select("*").eq("supplier_id", method.supplier_id).maybeSingle();
        const available = Number(bal?.available || 0);
        if (available < Number(method.min_withdraw || 0) || available <= 0) continue;
        const provider = method.provider || "liqpay";
        const result = await providerPayout(provider, available, {
          iban: method.iban, card_token: method.card_token, holder: method.holder,
          wallet_address: method.wallet_address, wallet_currency: method.wallet_currency,
          supplier_id: method.supplier_id,
        });

        if (!result.ok) continue;
        const mv = await applyMovement(supabase, method.supplier_id, {
          type: "withdrawal", amount: -available, provider, external_tx_id: result.tx_id, description: `Авто-вивід (${result.mode})`,
        });
        await supabase.from("supplier_payouts").insert({
          supplier_id: method.supplier_id, amount: available, payout_method: `${provider}_auto`,
          payout_status: "completed", iban: method.iban || null, transaction_id: result.tx_id, processed_at: new Date().toISOString(),
        });
        results.push({ supplier_id: method.supplier_id, amount: available, tx_id: result.tx_id, balance_after: mv.balance_after });
      }
      return json({ success: true, withdrawals: results.length, results });
    }

    // ---------------- charge_markup (admin/internal) ----------------
    // Auto-debit our markup from the supplier's bound card (COD), if allowed.
    if (action === "charge_markup") {
      if (!isAdmin && !isInternal) return json({ error: "Forbidden" }, 403);
      const { supplier_id, amount } = body;
      if (!supplier_id || !amount) return json({ error: "supplier_id and amount required" }, 400);
      const { data: method } = await supabase.from("payout_methods")
        .select("*").eq("supplier_id", supplier_id).eq("is_default", true).maybeSingle();
      if (!method?.card_token || !method?.auto_charge)
        return json({ error: "Авто-списання не дозволено постачальником" }, 400);
      const result = await providerCharge(method.provider || "liqpay", Number(amount), method.card_token);
      if (!result.ok) return json({ error: "Списання не вдалося", detail: result.error }, 502);
      const mv = await applyMovement(supabase, supplier_id, {
        type: "card_charge", amount: Number(amount), provider: method.provider || "liqpay",
        external_tx_id: result.tx_id, description: `Списання націнки з картки (${result.mode})`,
      });
      return json({ success: true, tx_id: result.tx_id, mode: result.mode, balance_after: mv.balance_after });
    }

    // ---------------- list_my_shops (supplier/manager: own shops + balances) ----------------
    if (action === "list_my_shops") {
      if (!profileId) return json({ error: "Forbidden" }, 403);
      let ids = await getCallerShopIds(supabase, profileId, telegramId);
      // staff and admin role previews oversee all shops, so admin panel links always open any registered shop.
      if (seesAll) {
        const { data } = await supabase.from("suppliers").select("id").eq("is_active", true);
        ids = (data || []).map((s: any) => s.id);
      }
      if (ids.length === 0) return json({ rows: [], providers: { monobank: providerMode("monobank"), liqpay: providerMode("liqpay"), telegram_wallet: WALLET_MODE } });

      // determine owner vs manager per shop
      const ownedSet = new Set<string>();
      if (telegramId != null) {
        const { data: owned } = await supabase.from("suppliers").select("id").eq("telegram_id", telegramId);
        (owned || []).forEach((s: any) => ownedSet.add(s.id));
      }

      const { data: suppliers } = await supabase.from("suppliers").select("id, shop_name, logo_url, is_active").in("id", ids);
      const { data: balances } = await supabase.from("shop_balances").select("*").in("supplier_id", ids);
      const { data: methods } = await supabase.from("payout_methods").select("supplier_id, masked_pan, auto_withdraw, auto_charge").eq("is_default", true).in("supplier_id", ids);
      const balMap: Record<string, any> = {};
      (balances || []).forEach((b: any) => { balMap[b.supplier_id] = b; });
      const methodMap: Record<string, any> = {};
      (methods || []).forEach((m: any) => { methodMap[m.supplier_id] = m; });
      const rows = (suppliers || []).map((s: any) => {
        const role = previewRole === "shop_manager" ? "manager" : previewRole === "supplier" ? "owner" : (previewRole === "moderator" || previewRole === "admin") ? "staff" : isStaff ? "staff" : ownedSet.has(s.id) ? "owner" : "manager";
        return {
          supplier_id: s.id,
          shop_name: s.shop_name,
          logo_url: s.logo_url,
          is_active: s.is_active,
          role,
          canManage: role === "owner" || (role === "staff" && isAdmin && previewRole !== "moderator"),
          available: Number(balMap[s.id]?.available || 0),
          pending: Number(balMap[s.id]?.pending || 0),
          lifetime_paid: Number(balMap[s.id]?.lifetime_paid || 0),
          method: methodMap[s.id] || null,
        };
      });
      return json({ rows, providers: { monobank: providerMode("monobank"), liqpay: providerMode("liqpay"), telegram_wallet: WALLET_MODE } });
    }

    // ---------------- list_shop_payments (manager read-only: order payment statuses, no funds) ----------------
    if (action === "list_shop_payments") {
      const { supplier_id } = body;
      if (!supplier_id) return json({ error: "supplier_id required" }, 400);
      const access = await getShopAccess(supabase, profileId, supplier_id, telegramId, isStaff, previewRole);
      if (!access) return json({ error: "Forbidden" }, 403);

      const { data: splits } = await supabase.from("order_splits")
        .select("id, order_id, product_total, payout_stage, split_status, payment_method, payout_type, created_at, paid_at")
        .eq("supplier_id", supplier_id).order("created_at", { ascending: false }).limit(100);
      const orderIds = [...new Set((splits || []).map((s: any) => s.order_id).filter(Boolean))];
      const orderMap: Record<string, any> = {};
      if (orderIds.length) {
        const { data: ords } = await supabase.from("orders")
          .select("id, order_number, payment_status, total").in("id", orderIds);
        (ords || []).forEach((o: any) => { orderMap[o.id] = o; });
      }
      const payments = (splits || []).map((s: any) => {
        const isCod = s.payment_method === "cash_on_delivery" || s.payout_type === "partial_markup";
        // Payment status the manager sees: created / partial / paid, without balance/settlement sums.
        let status: "created" | "partial" | "paid" = "created";
        if (s.payout_stage === "paid") status = "paid";
        else if (isCod) status = "partial";
        return {
          id: s.id,
          order_number: orderMap[s.order_id]?.order_number || (s.order_id ? String(s.order_id).slice(0, 8) : "—"),
          payment_method: s.payment_method,
          status,
          amount: access === "manager" ? null : Number(s.product_total || 0),
          created_at: s.created_at,
          paid_at: s.paid_at,
        };
      });
      return json({ payments });
    }

    if (action === "get_stats") {
      if (!profileId) return json({ error: "Forbidden" }, 403);
      const emptyTotals = { turnover: 0, earned: 0, processing: 0, productsSold: 0, productsAmount: 0, ordersCount: 0 };
      if (previewRole === "shop_manager") {
        return json({ totals: emptyTotals, series: buildStats([], []) });
      }
      let supplierIds: string[] = [];
      if (body.supplier_id) {
        const access = await getShopAccess(supabase, profileId, body.supplier_id, telegramId, isStaff, previewRole);
        if (!access) return json({ error: "Forbidden" }, 403);
        if (access === "manager") return json({ totals: emptyTotals, series: buildStats([], []) });
        if (!seesAll && !(await canManageSupplier(supabase, profileId, body.supplier_id, telegramId)))
          return json({ error: "Forbidden" }, 403);
        supplierIds = [body.supplier_id];
      } else {
        supplierIds = [];
        if (telegramId != null) {
          const { data: owned } = await supabase.from("suppliers").select("id").eq("telegram_id", telegramId);
          supplierIds = (owned || []).map((s: any) => s.id);
        }
        if (supplierIds.length === 0 && seesAll) {
          const { data } = await supabase.from("suppliers").select("id").eq("is_active", true);
          supplierIds = (data || []).map((s: any) => s.id);
        }
      }

      if (supplierIds.length === 0) {
        return json({ totals: emptyTotals, series: buildStats([], []) });
      }

      const { data: splits } = await supabase.from("order_splits")
        .select("supplier_id, order_id, product_total, supplier_amount, platform_commission, payout_stage, split_status, payment_method, created_at")
        .in("supplier_id", supplierIds);
      const { data: prods } = await supabase.from("products").select("id").in("supplier_id", supplierIds);
      const prodIds = (prods || []).map((p: any) => p.id);
      let items: any[] = [];
      if (prodIds.length) {
        const { data } = await supabase.from("order_items")
          .select("product_id, quantity, total, created_at").in("product_id", prodIds);
        items = data || [];
      }

      const allSplits = splits || [];
      const totals = { ...emptyTotals };
      const orderSet = new Set<string>();
      for (const s of allSplits) {
        totals.turnover += Number(s.product_total || 0);
        if (s.payout_stage === "paid") totals.earned += Number(s.supplier_amount || 0);
        else totals.processing += Number(s.supplier_amount || 0);
        if (s.order_id) orderSet.add(s.order_id);
      }
      totals.ordersCount = orderSet.size;
      for (const it of items) {
        totals.productsSold += Number(it.quantity || 0);
        totals.productsAmount += Number(it.total || 0);
      }
      const round = (n: number) => Math.round(n * 100) / 100;
      totals.turnover = round(totals.turnover);
      totals.earned = round(totals.earned);
      totals.processing = round(totals.processing);
      totals.productsAmount = round(totals.productsAmount);

      return json({ totals, series: buildStats(allSplits, items) });
    }

    // ---------------- group_earnings (admin-only: Taverna Group treasury) ----------------
    if (action === "group_earnings") {
      if (!isAdmin && !isInternal) return json({ error: "Forbidden: admin required" }, 403);

      // all shops
      const { data: suppliers } = await supabase.from("suppliers")
        .select("id, shop_name, logo_url, is_active, telegram_id").order("shop_name");
      const supIds = (suppliers || []).map((s: any) => s.id);

      // which shops does the admin own/manage
      const adminOwned = new Set<string>();
      if (telegramId != null) {
        (suppliers || []).forEach((s: any) => { if (Number(s.telegram_id) === Number(telegramId)) adminOwned.add(s.id); });
      }
      if (profileId) {
        const { data: links } = await supabase.from("shop_manager_links").select("supplier_id").eq("profile_id", profileId);
        (links || []).forEach((l: any) => adminOwned.add(l.supplier_id));
      }

      // splits across all shops
      const { data: splits } = supIds.length
        ? await supabase.from("order_splits")
            .select("supplier_id, order_id, product_total, supplier_amount, platform_commission, payout_stage, split_status, payment_method, created_at")
            .in("supplier_id", supIds)
        : { data: [] };
      const allSplits = splits || [];

      // per-shop aggregation
      const perShop: Record<string, any> = {};
      (suppliers || []).forEach((s: any) => {
        perShop[s.id] = {
          supplier_id: s.id, shop_name: s.shop_name, logo_url: s.logo_url, is_active: s.is_active,
          is_mine: adminOwned.has(s.id),
          orders: new Set<string>(), turnover: 0, earned: 0,
          created: 0, processing: 0, paid: 0,
        };
      });
      const group = { turnover: 0, earned: 0, created: 0, processing: 0, paidToSuppliers: 0, orders: new Set<string>(), splitCount: allSplits.length };
      for (const s of allSplits) {
        const p = perShop[s.supplier_id];
        if (!p) continue;
        const turnover = Number(s.product_total || 0);
        const commission = Number(s.platform_commission || 0);
        const supplierAmt = Number(s.supplier_amount || 0);
        p.turnover += turnover; p.earned += commission;
        group.turnover += turnover; group.earned += commission;
        if (s.order_id) { p.orders.add(s.order_id); group.orders.add(s.order_id); }
        const stage = s.payout_stage || "created";
        if (stage === "paid") { p.paid += supplierAmt; group.paidToSuppliers += supplierAmt; }
        else if (stage === "processing") { p.processing += supplierAmt; group.processing += supplierAmt; }
        else { p.created += supplierAmt; group.created += supplierAmt; }
      }
      const round = (n: number) => Math.round(n * 100) / 100;
      const shops = Object.values(perShop).map((p: any) => ({
        supplier_id: p.supplier_id, shop_name: p.shop_name, logo_url: p.logo_url,
        is_active: p.is_active, is_mine: p.is_mine,
        ordersCount: p.orders.size,
        turnover: round(p.turnover), earned: round(p.earned),
        created: round(p.created), processing: round(p.processing), paid: round(p.paid),
      })).sort((a: any, b: any) => b.turnover - a.turnover);

      // treasury ledger (last movements across all shops)
      const shopNameMap: Record<string, string> = {};
      (suppliers || []).forEach((s: any) => { shopNameMap[s.id] = s.shop_name; });
      const { data: moves } = await supabase.from("balance_movements")
        .select("id, supplier_id, type, amount, status, provider, external_tx_id, description, created_at")
        .order("created_at", { ascending: false }).limit(100);
      const ledger = (moves || []).map((m: any) => ({ ...m, shop_name: shopNameMap[m.supplier_id] || "—" }));

      // MonoBank ФОП sub-accounts (sandbox demo until MONOBANK_TOKEN is set)
      const monoMode = providerMode("monobank");
      const subAccounts = monoMode === "live"
        ? [] // real accounts fetched from MonoBank API when integrated
        : [
            { id: "fop-main", name: "ФОП — основний рахунок", iban: "UA••••0001", balance: round(group.earned - group.paidToSuppliers), currency: "UAH", type: "Основний" },
            { id: "fop-markup", name: "Націнка Taverna", iban: "UA••••0002", balance: round(group.earned), currency: "UAH", type: "Дохід" },
            { id: "fop-payouts", name: "Виплати постачальникам", iban: "UA••••0003", balance: round(group.paidToSuppliers), currency: "UAH", type: "Витрати" },
            { id: "fop-reserve", name: "Резерв / податки", iban: "UA••••0004", balance: round(group.earned * 0.05), currency: "UAH", type: "Резерв" },
          ];

      return json({
        group: {
          turnover: round(group.turnover),
          earned: round(group.earned),
          created: round(group.created),
          processing: round(group.processing),
          paidToSuppliers: round(group.paidToSuppliers),
          ordersCount: group.orders.size,
          shopsCount: (suppliers || []).length,
          myShopsCount: adminOwned.size,
        },
        shops,
        ledger,
        subAccounts,
        providers: { monobank: monoMode, liqpay: providerMode("liqpay") },
        series: buildStats(allSplits, []),
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err: any) {
    console.error("bank-gateway error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
