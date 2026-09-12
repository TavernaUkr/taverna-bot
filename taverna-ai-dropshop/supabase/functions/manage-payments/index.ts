import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  const { data: session, error } = await supabase
    .from("sessions")
    .select("*, profile:profiles(*)")
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .single();
  if (error || !session) return null;
  return session;
}

async function getRoles(supabase: any, profileId: string): Promise<string[]> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", profileId);
  return (data || []).map((r: any) => r.role);
}

const STAGE_LABELS: Record<string, string> = {
  created: "Створено",
  processing: "В обробці",
  paid: "Оплачено",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { action, session_token } = body;

    if (!session_token) {
      return new Response(JSON.stringify({ error: "session_token required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = await validateSession(supabase, session_token);
    if (!session) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const roles = await getRoles(supabase, session.profile.id);
    const isAdmin = roles.includes("admin");
    const isModerator = roles.includes("moderator");
    const isStaff = isAdmin || isModerator;

    // ---------------- list (admin + moderator) ----------------
    if (action === "list") {
      if (!isStaff) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { supplier_id, stage } = body;

      let q = supabase
        .from("order_splits")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (supplier_id) q = q.eq("supplier_id", supplier_id);
      if (stage) q = q.eq("payout_stage", stage);

      const { data: splits, error } = await q;
      if (error) throw error;

      const orderIds = [...new Set((splits || []).map((s: any) => s.order_id).filter(Boolean))];
      const supplierIds = [...new Set((splits || []).map((s: any) => s.supplier_id).filter(Boolean))];

      const [ordersRes, suppliersRes] = await Promise.all([
        orderIds.length
          ? supabase.from("orders").select("id, order_number, status, payment_method, payment_status, received_at, tracking_status, delivery_tracking, created_at").in("id", orderIds)
          : Promise.resolve({ data: [] }),
        supplierIds.length
          ? supabase.from("suppliers").select("id, shop_name, payment_iban, payment_card_holder, payment_bank_name").in("id", supplierIds)
          : Promise.resolve({ data: [] }),
      ]);

      const orderMap: Record<string, any> = {};
      (ordersRes.data || []).forEach((o: any) => { orderMap[o.id] = o; });
      const supplierMap: Record<string, any> = {};
      (suppliersRes.data || []).forEach((s: any) => { supplierMap[s.id] = s; });

      const enriched = (splits || []).map((s: any) => {
        const sup = supplierMap[s.supplier_id] || {};
        const hasRequisites = !!(sup.payment_iban || sup.payment_card_holder);
        return {
          ...s,
          stage_label: STAGE_LABELS[s.payout_stage] || s.payout_stage,
          order: orderMap[s.order_id] || null,
          shop_name: sup.shop_name || "—",
          has_requisites: hasRequisites,
          // moderators never see payout requisites
          requisites: isAdmin
            ? { iban: sup.payment_iban, card_holder: sup.payment_card_holder, bank: sup.payment_bank_name }
            : null,
        };
      });

      return new Response(JSON.stringify({ splits: enriched, role: isAdmin ? "admin" : "moderator" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------------- mark_received (admin + moderator) — manual fallback ----------------
    if (action === "mark_received") {
      if (!isStaff) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { order_id } = body;
      if (!order_id) {
        return new Response(JSON.stringify({ error: "order_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await supabase.from("orders")
        .update({ received_at: new Date().toISOString(), tracking_status: "received", status: "received" })
        .eq("id", order_id);

      // recalc eligibility for splits of this order
      await recalcEligibilityForOrder(supabase, order_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------------- mark_paid (admin only) — manual payout + optional receipt ----------------
    if (action === "mark_paid") {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden: admin required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { split_id, receipt_url } = body;
      if (!split_id) {
        return new Response(JSON.stringify({ error: "split_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const now = new Date().toISOString();
      const { data: split } = await supabase.from("order_splits").select("*").eq("id", split_id).single();
      if (!split) {
        return new Response(JSON.stringify({ error: "Split not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("order_splits").update({
        payout_stage: "paid",
        split_status: "paid",
        paid_at: now,
        receipt_url: receipt_url || split.receipt_url || null,
        receipt_uploaded_at: receipt_url ? now : split.receipt_uploaded_at,
      }).eq("id", split_id);

      // log a payout record
      const { data: sup } = await supabase.from("suppliers").select("payment_iban").eq("id", split.supplier_id).single();
      await supabase.from("supplier_payouts").insert({
        supplier_id: split.supplier_id,
        order_split_id: split_id,
        amount: split.supplier_amount,
        payout_method: "manual_fop",
        payout_status: "completed",
        iban: sup?.payment_iban || null,
        transaction_id: `MANUAL-${Date.now()}`,
        processed_at: now,
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------------- attach_receipt (admin only) ----------------
    if (action === "attach_receipt") {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden: admin required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { split_id, receipt_url } = body;
      if (!split_id || !receipt_url) {
        return new Response(JSON.stringify({ error: "split_id and receipt_url required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await supabase.from("order_splits").update({
        receipt_url, receipt_uploaded_at: new Date().toISOString(),
      }).eq("id", split_id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------------- supplier_payouts (supplier own view) ----------------
    if (action === "supplier_list") {
      const { supplier_id } = body;
      if (!supplier_id) {
        return new Response(JSON.stringify({ error: "supplier_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // ensure the caller owns/manages this supplier OR is staff
      let allowed = isStaff;
      if (!allowed) {
        const { data: sup } = await supabase.from("suppliers").select("profile_id").eq("id", supplier_id).single();
        if (sup?.profile_id === session.profile.id) allowed = true;
        if (!allowed) {
          const { data: link } = await supabase
            .from("shop_manager_links")
            .select("id").eq("supplier_id", supplier_id).eq("manager_profile_id", session.profile.id).maybeSingle();
          if (link) allowed = true;
        }
      }
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: splits } = await supabase
        .from("order_splits")
        .select("id, order_id, supplier_amount, platform_commission, payout_stage, payout_type, eligible_payout_at, paid_at, receipt_url, created_at")
        .eq("supplier_id", supplier_id)
        .order("created_at", { ascending: false })
        .limit(300);

      const orderIds = [...new Set((splits || []).map((s: any) => s.order_id).filter(Boolean))];
      const { data: orders } = orderIds.length
        ? await supabase.from("orders").select("id, order_number").in("id", orderIds)
        : { data: [] };
      const orderMap: Record<string, any> = {};
      (orders || []).forEach((o: any) => { orderMap[o.id] = o; });

      const enriched = (splits || []).map((s: any) => ({
        ...s,
        stage_label: STAGE_LABELS[s.payout_stage] || s.payout_stage,
        order_number: orderMap[s.order_id]?.order_number || s.order_id?.slice(0, 8),
      }));

      return new Response(JSON.stringify({ splits: enriched }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("manage-payments error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function recalcEligibilityForOrder(supabase: any, orderId: string) {
  const { data: order } = await supabase.from("orders").select("id, received_at").eq("id", orderId).single();
  if (!order?.received_at) return;

  const { data: splits } = await supabase.from("order_splits").select("id, supplier_id").eq("order_id", orderId);
  for (const split of splits || []) {
    // determine returnability across this supplier's items in the order
    const { data: items } = await supabase
      .from("order_items")
      .select("product_id, products(supplier_id, is_returnable, return_window_days)")
      .eq("order_id", orderId);

    const supplierItems = (items || []).filter((it: any) => it.products?.supplier_id === split.supplier_id);
    let maxWindow = 0;
    let anyReturnable = false;
    for (const it of supplierItems) {
      if (it.products?.is_returnable) {
        anyReturnable = true;
        maxWindow = Math.max(maxWindow, it.products?.return_window_days ?? 14);
      }
    }
    const eligible = new Date(order.received_at);
    eligible.setDate(eligible.getDate() + (anyReturnable ? maxWindow : 0));

    await supabase.from("order_splits").update({
      eligible_payout_at: eligible.toISOString(),
      is_returnable: anyReturnable,
    }).eq("id", split.id);
  }
}
