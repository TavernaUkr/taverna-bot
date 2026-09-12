import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const RETURN_WINDOW_DAYS = 14;
const FREE_RETURN_MIN = 1500;

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

async function isStaff(supabase: any, profileId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", profileId);
  return (data || []).some((r: any) => r.role === "admin" || r.role === "moderator");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const { action, session_token } = body || {};
    if (!action) return json({ error: "action required" }, 400);
    if (!session_token) return json({ error: "Invalid session" }, 401);

    const session = await validateSession(supabase, session_token);
    if (!session) return json({ error: "Invalid session" }, 401);
    const profile = session.profile;

    // ---------------- список повернень клієнта ----------------
    if (action === "list_my_refunds") {
      const { data } = await supabase
        .from("order_refunds")
        .select("*")
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return json({ success: true, refunds: data || [] });
    }

    // ---------------- створення заявки ----------------
    if (action === "create_request") {
      const orderId = String(body.order_id || "");
      const reason = String(body.reason || "").trim();
      const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 1000) : null;
      const itemIds: string[] = Array.isArray(body.item_ids) ? body.item_ids.map(String) : [];
      if (!orderId || !reason) return json({ error: "Вкажіть замовлення та причину" }, 400);

      const { data: order } = await supabase
        .from("orders")
        .select("id, order_number, profile_id, status, total, subtotal, delivery_cost, updated_at, received_at")
        .eq("id", orderId)
        .maybeSingle();
      if (!order || order.profile_id !== profile.id) return json({ error: "Замовлення не знайдено" }, 404);

      if (!["delivered", "received"].includes(String(order.status))) {
        return json({ error: "Повернення доступне лише для отриманих замовлень" }, 400);
      }
      const deliveredAt = new Date(order.received_at || order.updated_at).getTime();
      const days = Math.floor((Date.now() - deliveredAt) / 86400000);
      if (days > RETURN_WINDOW_DAYS) return json({ error: "Минув 14-денний термін повернення" }, 400);

      const { data: existing } = await supabase
        .from("order_refunds").select("id, status").eq("order_id", orderId)
        .in("status", ["requested", "approved"]).maybeSingle();
      if (existing) return json({ error: "Заявка на повернення вже створена" }, 400);

      const { data: refundMethod } = await supabase
        .from("refund_methods")
        .select("id, method_type, masked_value, holder, bank_name")
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!refundMethod) return json({ error: "Додайте «Картку для повернень» у налаштуваннях профілю" }, 400);

      const { data: allItems } = await supabase
        .from("order_items")
        .select("id, product_id, product_name, quantity, price, total")
        .eq("order_id", orderId);
      const items = (allItems || []).filter((i: any) => itemIds.length === 0 || itemIds.includes(i.id));
      if (items.length === 0) return json({ error: "Оберіть товари для повернення" }, 400);

      // Сума рахується ТІЛЬКИ на сервері.
      const isFullOrder = items.length === (allItems || []).length;
      let amount = items.reduce((s: number, i: any) => s + Number(i.total || 0), 0);
      if (isFullOrder && Number(order.total) >= FREE_RETURN_MIN) amount += Number(order.delivery_cost || 0);
      amount = Math.round(amount * 100) / 100;

      // Бонуси, витрачені на це замовлення, повертаються пропорційно.
      const { data: bonusTx } = await supabase
        .from("wallet_transactions")
        .select("bonus_amount, amount, type")
        .eq("order_id", orderId)
        .eq("type", "bonus_spend");
      const bonusSpent = (bonusTx || []).reduce(
        (s: number, t: any) => s + Math.abs(Number(t.bonus_amount || t.amount || 0)), 0);
      const share = Number(order.subtotal) > 0
        ? Math.min(1, items.reduce((s: number, i: any) => s + Number(i.total || 0), 0) / Number(order.subtotal))
        : 1;
      const bonusAmount = Math.round(bonusSpent * share);

      // Постачальник за першим товаром
      let supplierId: string | null = null;
      const productIds = items.map((i: any) => i.product_id).filter(Boolean);
      if (productIds.length) {
        const { data: products } = await supabase.from("products").select("supplier_id").in("id", productIds).limit(1);
        supplierId = products?.[0]?.supplier_id || null;
      }

      const { data: created, error } = await supabase.from("order_refunds").insert({
        order_id: orderId,
        profile_id: profile.id,
        supplier_id: supplierId,
        refund_method_id: refundMethod.id,
        refund_target: `${refundMethod.masked_value}${refundMethod.holder ? ` · ${refundMethod.holder}` : ""}`,
        items: items.map((i: any) => ({ id: i.id, name: i.product_name, quantity: i.quantity, total: Number(i.total) })),
        amount,
        bonus_amount: bonusAmount,
        reason,
        comment,
        status: "requested",
      }).select("*").single();
      if (error) return json({ error: error.message }, 400);

      await supabase.from("orders").update({ status: "return" }).eq("id", orderId);

      return json({ success: true, refund: created });
    }

    // ---------------- черга модератора ----------------
    const staff = await isStaff(supabase, profile.id);

    if (action === "list_pending") {
      if (!staff) return json({ error: "Forbidden" }, 403);
      const { data } = await supabase
        .from("order_refunds")
        .select("*, order:orders(order_number, total), supplier:suppliers(shop_name)")
        .order("created_at", { ascending: false })
        .limit(100);
      return json({ success: true, refunds: data || [] });
    }

    if (action === "set_status") {
      if (!staff) return json({ error: "Forbidden" }, 403);
      const refundId = String(body.refund_id || "");
      const status = String(body.status || "");
      if (!["approved", "paid", "rejected"].includes(status)) return json({ error: "Невірний статус" }, 400);

      const { data: refund } = await supabase.from("order_refunds").select("*").eq("id", refundId).maybeSingle();
      if (!refund) return json({ error: "Заявку не знайдено" }, 404);

      const patch: Record<string, unknown> = { status, processed_by: profile.id };
      if (status === "rejected") patch.rejection_reason = String(body.rejection_reason || "Без пояснення");

      if (status === "paid") {
        patch.paid_at = new Date().toISOString();
        patch.transaction_id = `RFND-${Date.now().toString(36).toUpperCase()}`;

        // Рух коштів: повернення клієнту + списання з балансу магазину
        const { data: wallet } = await supabase.from("wallets")
          .select("id, bonus_balance").eq("owner_type", "profile").eq("owner_id", refund.profile_id).maybeSingle();
        if (wallet) {
          await supabase.from("wallet_transactions").insert({
            wallet_id: wallet.id,
            type: "refund",
            amount: Number(refund.amount),
            bonus_amount: Number(refund.bonus_amount || 0),
            provider: "bank",
            status: "completed",
            order_id: refund.order_id,
            external_id: patch.transaction_id as string,
            description: `Повернення коштів на ${refund.refund_target || "картку"}`,
          });
          if (Number(refund.bonus_amount) > 0) {
            await supabase.from("wallets")
              .update({ bonus_balance: Number(wallet.bonus_balance || 0) + Number(refund.bonus_amount) })
              .eq("id", wallet.id);
          }
        }

        if (refund.supplier_id) {
          const { data: sb } = await supabase.from("shop_balances")
            .select("id, available").eq("supplier_id", refund.supplier_id).maybeSingle();
          const balanceAfter = Number(sb?.available || 0) - Number(refund.amount);
          if (sb) await supabase.from("shop_balances").update({ available: balanceAfter }).eq("id", sb.id);
          await supabase.from("balance_movements").insert({
            supplier_id: refund.supplier_id,
            type: "refund",
            amount: -Number(refund.amount),
            balance_after: balanceAfter,
            status: "completed",
            provider: "internal",
            external_tx_id: patch.transaction_id as string,
            description: `Повернення за замовленням`,
          });
        }
      }

      const { data: updated, error } = await supabase.from("order_refunds")
        .update(patch).eq("id", refundId).select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ success: true, refund: updated });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
