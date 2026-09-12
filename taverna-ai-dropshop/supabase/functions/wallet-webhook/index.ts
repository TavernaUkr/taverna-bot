import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, walletpay-timestamp, walletpay-signature",
};

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WALLET_API_KEY = Deno.env.get("WALLET_PAY_API_KEY") || "";
const WEBHOOK_SECRET = Deno.env.get("WALLET_PAY_WEBHOOK_SECRET") || WALLET_API_KEY;

// Wallet Pay signs: base64(HMAC_SHA256(secret, `${method}.${uri}.${timestamp}.${base64(body)}`))
async function verifySignature(req: Request, rawBody: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false;
  const signature = req.headers.get("walletpay-signature");
  const timestamp = req.headers.get("walletpay-timestamp");
  if (!signature || !timestamp) return false;
  const uri = new URL(req.url).pathname;
  const base64Body = btoa(String.fromCharCode(...new TextEncoder().encode(rawBody)));
  const msg = `${req.method}.${uri}.${timestamp}.${base64Body}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const rawBody = await req.text();
    if (!(await verifySignature(req, rawBody))) {
      console.error("wallet-webhook: invalid signature");
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);
    const events = JSON.parse(rawBody);
    const list = Array.isArray(events) ? events : [events];

    for (const ev of list) {
      const type = ev?.type; // ORDER_PAID | ORDER_FAILED | ORDER_EXPIRED
      const payload = ev?.payload || {};
      const walletId = payload.id != null ? String(payload.id) : null;
      const externalId = payload.externalId ? String(payload.externalId) : null;
      if (!walletId && !externalId) continue;

      // 1) Поповнення балансу гаманця (wallet_transactions.type = 'topup')
      let txQ = supabase.from("wallet_transactions").select("*").eq("type", "topup");
      txQ = walletId ? txQ.eq("external_id", walletId) : txQ.eq("id", externalId!);
      const { data: topupTx } = await txQ.limit(1).maybeSingle();
      if (topupTx) {
        if (type === "ORDER_PAID") {
          const { data: claimed } = await supabase.from("wallet_transactions")
            .update({ status: "completed", receipt: { ...(topupTx.receipt || {}), payload } })
            .eq("id", topupTx.id).eq("status", "pending").select("id").maybeSingle();
          if (claimed) {
            const { data: w } = await supabase.from("wallets").select("balance").eq("id", topupTx.wallet_id).maybeSingle();
            await supabase.from("wallets")
              .update({ balance: Number(w?.balance || 0) + Number(topupTx.amount) }).eq("id", topupTx.wallet_id);
          }
        } else if (type === "ORDER_FAILED" || type === "ORDER_EXPIRED") {
          await supabase.from("wallet_transactions")
            .update({ status: type === "ORDER_EXPIRED" ? "expired" : "failed" })
            .eq("id", topupTx.id).eq("status", "pending");
        }
        continue;
      }

      let q = supabase.from("wallet_invoices").select("*");
      q = walletId ? q.eq("wallet_invoice_id", walletId) : q.eq("order_id", externalId);
      const { data: inv } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!inv) { console.error("wallet-webhook: invoice not found", walletId, externalId); continue; }


      if (type === "ORDER_PAID") {
        if (inv.status === "paid") continue; // idempotent
        await supabase.from("wallet_invoices").update({
          status: "paid", paid_at: new Date().toISOString(), raw_payload: payload,
        }).eq("id", inv.id);
        if (inv.order_id) {
          await supabase.from("orders").update({
            payment_status: "paid", payment_method: "telegram_wallet",
          }).eq("id", inv.order_id);
          await supabase.from("order_splits").update({
            payment_method: "prepaid", payout_type: "full_amount",
          }).eq("order_id", inv.order_id);
        }
      } else if (type === "ORDER_FAILED" || type === "ORDER_EXPIRED") {
        await supabase.from("wallet_invoices").update({
          status: type === "ORDER_EXPIRED" ? "expired" : "failed", raw_payload: payload,
        }).eq("id", inv.id);
      }
    }

    return json({ ok: true });
  } catch (e: any) {
    console.error("wallet-webhook error", e);
    return json({ error: e.message || "Internal error" }, 500);
  }
});
