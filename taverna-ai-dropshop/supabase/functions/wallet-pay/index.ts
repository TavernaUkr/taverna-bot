import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key",
};

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WALLET_API_KEY = Deno.env.get("WALLET_PAY_API_KEY") || "";
const WALLET_API = "https://pay.wallet.tg/wpay/store-api/v1";
// Sandbox invoices auto-settle after this delay so the whole flow is testable in preview.
const SANDBOX_SETTLE_MS = 4000;

const mode = (): "live" | "sandbox" => (WALLET_API_KEY ? "live" : "sandbox");
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

// Settle a paid invoice: mark order paid + flag splits as prepaid. Idempotent.
export async function settleInvoice(supabase: any, invoice: any, payload: any = {}) {
  if (invoice.status === "paid") return invoice;
  const paidAt = new Date().toISOString();
  const { data: updated } = await supabase
    .from("wallet_invoices")
    .update({ status: "paid", paid_at: paidAt, raw_payload: payload })
    .eq("id", invoice.id)
    .select()
    .single();

  if (invoice.order_id) {
    await supabase.from("orders")
      .update({ payment_status: "paid", payment_method: "telegram_wallet" })
      .eq("id", invoice.order_id);
    await supabase.from("order_splits")
      .update({ payment_method: "prepaid", payout_type: "full_amount" })
      .eq("order_id", invoice.order_id);
  }
  return updated || invoice;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);
    const body = await req.json();
    const { action } = body;
    const isInternal = req.headers.get("x-internal-key") === SERVICE_KEY;

    // ---------------- create_invoice (customer) ----------------
    if (action === "create_invoice") {
      const { order_id, session_token } = body;
      if (!order_id) return json({ error: "order_id required" }, 400);

      let profileId: string | null = null;
      let telegramId: number | null = null;
      if (session_token) {
        const session = await validateSession(supabase, session_token);
        if (!session) return json({ error: "Invalid session" }, 401);
        profileId = session.profile.id;
        telegramId = session.profile.telegram_id ?? null;
      }

      const { data: order } = await supabase
        .from("orders").select("id, order_number, total, profile_id, payment_status")
        .eq("id", order_id).maybeSingle();
      if (!order) return json({ error: "Order not found" }, 404);
      if (order.profile_id && profileId && order.profile_id !== profileId)
        return json({ error: "Forbidden" }, 403);
      if (order.payment_status === "paid") return json({ error: "Замовлення вже оплачено" }, 400);

      // reuse an active invoice for this order
      const { data: active } = await supabase.from("wallet_invoices")
        .select("*").eq("order_id", order_id).eq("status", "active")
        .order("created_at", { ascending: false }).maybeSingle();
      if (active) return json({ success: true, invoice: active, mode: active.mode });

      // Amount is always recomputed server-side from the stored order total.
      const amount = Number(order.total);
      const currency = "UAH";

      if (mode() === "live") {
        const res = await fetch(`${WALLET_API}/order`, {
          method: "POST",
          headers: { "Wpay-Store-Api-Key": WALLET_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: { currencyCode: currency, amount: amount.toFixed(2) },
            description: `Замовлення ${order.order_number || order.id.slice(0, 8)} — Taverna Group`,
            externalId: order.id,
            timeoutSeconds: 3600,
            customerTelegramUserId: telegramId ?? undefined,
            autoConversionCurrency: "USDT",
          }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || out?.status !== "SUCCESS") {
          console.error("wallet-pay create order failed", res.status, JSON.stringify(out));
          return json({ error: "Wallet Pay недоступний", status: res.status, details: out }, 502);
        }
        const d = out.data;
        const { data: inv } = await supabase.from("wallet_invoices").insert({
          order_id: order.id, profile_id: order.profile_id, wallet_invoice_id: String(d.id),
          amount, currency, status: "active", pay_link: d.payLink,
          direct_pay_link: d.directPayLink, mode: "live", raw_payload: d,
        }).select().single();
        return json({ success: true, invoice: inv, mode: "live" });
      }

      // sandbox
      const { data: inv } = await supabase.from("wallet_invoices").insert({
        order_id: order.id, profile_id: order.profile_id, wallet_invoice_id: fakeId("WPAY"),
        amount, currency, status: "active", pay_link: null, direct_pay_link: null, mode: "sandbox",
      }).select().single();
      return json({ success: true, invoice: inv, mode: "sandbox" });
    }

    // ---------------- get_invoice_status (customer polling) ----------------
    if (action === "get_invoice_status") {
      const { invoice_id, order_id } = body;
      let q = supabase.from("wallet_invoices").select("*").order("created_at", { ascending: false });
      q = invoice_id ? q.eq("id", invoice_id) : q.eq("order_id", order_id);
      const { data: inv } = await q.limit(1).maybeSingle();
      if (!inv) return json({ error: "Invoice not found" }, 404);

      if (inv.status === "active" && inv.mode === "sandbox") {
        // sandbox auto-settlement so the full flow (чек, нарахування, вивід) is visible in preview
        if (Date.now() - new Date(inv.created_at).getTime() > SANDBOX_SETTLE_MS) {
          const settled = await settleInvoice(supabase, inv, { sandbox: true, tx_id: fakeId("TX") });
          return json({ invoice: settled });
        }
      }

      if (inv.status === "active" && inv.mode === "live" && inv.wallet_invoice_id) {
        const res = await fetch(`${WALLET_API}/order/preview?id=${encodeURIComponent(inv.wallet_invoice_id)}`, {
          headers: { "Wpay-Store-Api-Key": WALLET_API_KEY },
        });
        const out = await res.json().catch(() => ({}));
        const st = out?.data?.status;
        if (st === "PAID") {
          const settled = await settleInvoice(supabase, inv, out.data);
          return json({ invoice: settled });
        }
        if (st === "EXPIRED" || st === "CANCELLED") {
          const { data: upd } = await supabase.from("wallet_invoices")
            .update({ status: st.toLowerCase(), raw_payload: out.data }).eq("id", inv.id).select().single();
          return json({ invoice: upd });
        }
      }

      return json({ invoice: inv });
    }

    // ---------------- create_payout (supplier withdrawal, called by bank-gateway) ----------------
    if (action === "create_payout") {
      if (!isInternal) return json({ error: "Forbidden" }, 403);
      const { amount, wallet_address, currency = "USDT", supplier_id } = body;
      if (!amount || !wallet_address) return json({ error: "amount and wallet_address required" }, 400);

      if (mode() === "sandbox") {
        return json({ ok: true, tx_id: fakeId("WPAY-PAYOUT"), mode: "sandbox" });
      }
      const res = await fetch(`${WALLET_API}/payout`, {
        method: "POST",
        headers: { "Wpay-Store-Api-Key": WALLET_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: { currencyCode: currency, amount: Number(amount).toFixed(2) },
          externalId: `${supplier_id}-${Date.now()}`,
          recipientWalletAddress: wallet_address,
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out?.status !== "SUCCESS") {
        console.error("wallet-pay payout failed", res.status, JSON.stringify(out));
        return json({ ok: false, error: out?.message || `HTTP ${res.status}`, mode: "live" }, 200);
      }
      return json({ ok: true, tx_id: String(out.data?.id || fakeId("WPAY")), mode: "live" });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e: any) {
    console.error("wallet-pay error", e);
    return json({ error: e.message || "Internal error" }, 500);
  }
});
