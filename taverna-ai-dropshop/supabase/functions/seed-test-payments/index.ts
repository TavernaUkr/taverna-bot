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

const DAY = 24 * 3600 * 1000;
const round = (n: number) => Math.round(n * 100) / 100;

async function clearTestPayments(supabase: any) {
  const { data: testOrders } = await supabase
    .from("orders")
    .select("id")
    .like("order_number", "TEST-%");
  const orderIds = (testOrders || []).map((o: any) => o.id);

  let splitIds: string[] = [];
  if (orderIds.length) {
    const { data: testSplits } = await supabase
      .from("order_splits")
      .select("id")
      .in("order_id", orderIds);
    splitIds = (testSplits || []).map((s: any) => s.id);
  }

  if (splitIds.length) {
    await supabase.from("balance_movements").delete().in("order_split_id", splitIds);
    await supabase.from("order_splits").delete().in("id", splitIds);
  }
  await supabase.from("balance_movements").delete().like("description", "%[TEST]%");
  await supabase.from("supplier_payouts").delete().like("transaction_id", "TEST-WD-%");
  await supabase.from("supplier_payouts").delete().like("transaction_id", "%SBX%");
  if (orderIds.length) await supabase.from("orders").delete().in("id", orderIds);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const { session_token, mode = "seed" } = body;

    // admin only
    if (!session_token) return json({ error: "session_token required" }, 401);
    const { data: session } = await supabase
      .from("sessions").select("*, profile:profiles(*)")
      .eq("token_hash", await hashToken(session_token)).gt("expires_at", new Date().toISOString()).single();
    if (!session) return json({ error: "Invalid session" }, 401);
    const adminProfileId = session.profile.id;
    const { data: rolesData } = await supabase.from("user_roles").select("role").eq("user_id", adminProfileId);
    const roles = (rolesData || []).map((r: any) => r.role);
    if (!roles.includes("admin")) return json({ error: "Forbidden: admin required" }, 403);

    if (mode === "clear") {
      await clearTestPayments(supabase);
      return json({ success: true, cleared: true });
    }

    await clearTestPayments(supabase);

    const { data: suppliers } = await supabase.from("suppliers").select("id, shop_name").eq("is_active", true).order("created_at", { ascending: true });
    if (!suppliers?.length) return json({ error: "Немає магазинів для генерації" }, 400);

    // spread orders across periods: today, this week, this month, months ago, last year
    const offsetsDays = [0, 1, 3, 6, 12, 20, 45, 90, 200, 400];
    const now = Date.now();
    const created: any[] = [];
    const movementsInserted: any[] = [];

    // running balance per supplier (so balance_after is coherent)
    const running: Record<string, number> = {};
    const pending: Record<string, number> = {};

    for (let i = 0; i < suppliers.length; i++) {
      const sup = suppliers[i];
      running[sup.id] = 0;
      pending[sup.id] = 0;
      const isCod = i % 2 === 1;

      for (let j = 0; j < offsetsDays.length; j++) {
        const daysAgo = offsetsDays[j];
        const ts = new Date(now - daysAgo * DAY).toISOString();
        const retail = 800 + ((i * 3 + j) % 6) * 350;
        const supplierAmount = round(retail / 1.33);
        const commission = round(retail - supplierAmount);

        // 3 stages depending on age: recent -> created, mid -> processing, old -> paid
        const stage = daysAgo <= 2 ? "created" : daysAgo <= 12 ? "processing" : "paid";

        const { data: order } = await supabase.from("orders").insert({
          order_number: `TEST-${now}-${i}-${j}`,
          status: "delivered",
          subtotal: retail, total: retail,
          payment_method: isCod ? "cash_on_delivery" : "card",
          payment_status: isCod ? "pending" : "paid",
          received_at: ts, tracking_status: "received",
          notes: "[TEST] balance seed",
          created_at: ts,
        }).select().single();
        if (!order) continue;

        const { data: split } = await supabase.from("order_splits").insert({
          order_id: order.id, supplier_id: sup.id,
          product_total: retail, supplier_amount: supplierAmount, platform_commission: commission,
          markup_percentage: 33, payment_method: isCod ? "cash_on_delivery" : "card",
          split_status: "test", payout_stage: stage,
          payout_type: isCod ? "partial_markup" : "full_prepaid",
          eligible_payout_at: new Date(now - Math.max(0, daysAgo - 3) * DAY).toISOString(),
          is_returnable: true, created_at: ts,
          paid_at: stage === "paid" ? ts : null,
        }).select().single();

        if (stage === "processing") {
          pending[sup.id] += supplierAmount;
        }

        // For paid stage, record ledger movements so history & balances populate
        if (stage === "paid" && split) {
          running[sup.id] += supplierAmount;
          const { data: mv1 } = await supabase.from("balance_movements").insert({
            supplier_id: sup.id, order_split_id: split.id, type: "payout_accrual",
            amount: supplierAmount, balance_after: round(running[sup.id]), status: "settled",
            provider: "internal", description: `[TEST] Нарахування ${order.order_number}`, created_at: ts,
          }).select().single();
          if (mv1) movementsInserted.push(mv1.id);

          if (isCod && commission > 0) {
            running[sup.id] -= commission;
            const { data: mv2 } = await supabase.from("balance_movements").insert({
              supplier_id: sup.id, order_split_id: split.id, type: "markup_debit",
              amount: -commission, balance_after: round(running[sup.id]), status: "settled",
              provider: "internal", description: `[TEST] Наша націнка ${order.order_number}`,
              created_at: new Date(now - daysAgo * DAY + 3600000).toISOString(),
            }).select().single();
            if (mv2) movementsInserted.push(mv2.id);
          }
        }

        // One older paid order gets a test return adjustment to show reliability/edge cases.
        if (stage === "paid" && split && j === offsetsDays.length - 2) {
          const adjust = round(supplierAmount * 0.08);
          running[sup.id] -= adjust;
          const { data: mvr } = await supabase.from("balance_movements").insert({
            supplier_id: sup.id, order_split_id: split.id, type: "refund_adjust",
            amount: -adjust, balance_after: round(running[sup.id]), status: "settled",
            provider: "internal", description: `[TEST] Коригування повернення ${order.order_number}`,
            created_at: new Date(now - daysAgo * DAY + 7200000).toISOString(),
          }).select().single();
          if (mvr) movementsInserted.push(mvr.id);
        }

        created.push({ shop: sup.shop_name, order: order.order_number, stage, supplierAmount, commission });
      }

      // For the two oldest, simulate a withdrawal (paid out) to fill lifetime_paid
      const withdrawAmt = round(running[sup.id] * 0.4);
      let lifetimePaid = 0;
      if (withdrawAmt > 0) {
        running[sup.id] -= withdrawAmt;
        lifetimePaid = withdrawAmt;
        const txId = `TEST-WD-${sup.id.slice(0, 6)}`;
        const { data: mvw } = await supabase.from("balance_movements").insert({
          supplier_id: sup.id, type: "withdrawal", amount: -withdrawAmt,
          balance_after: round(running[sup.id]), status: "settled", provider: "monobank",
          external_tx_id: txId, description: "[TEST] Вивід коштів",
          created_at: new Date(now - 30 * DAY).toISOString(),
        }).select().single();
        if (mvw) movementsInserted.push(mvw.id);
        await supabase.from("supplier_payouts").insert({
          supplier_id: sup.id,
          amount: withdrawAmt,
          payout_method: "monobank_sandbox",
          payout_status: "completed",
          iban: `UA90305299299000414912345678${i}`,
          transaction_id: txId,
          processed_at: new Date(now - 30 * DAY).toISOString(),
          created_at: new Date(now - 30 * DAY).toISOString(),
        });
      }

      // upsert shop_balances with coherent totals
      const { data: existingBal } = await supabase.from("shop_balances").select("id").eq("supplier_id", sup.id).maybeSingle();
      const balPayload = {
        supplier_id: sup.id,
        available: round(running[sup.id]),
        pending: round(pending[sup.id]),
        lifetime_paid: lifetimePaid,
        currency: "UAH",
      };
      if (existingBal) await supabase.from("shop_balances").update(balPayload).eq("id", existingBal.id);
      else await supabase.from("shop_balances").insert(balPayload);

      // payout method with demo card + IBAN (owner sees withdraw/auto controls)
      const { data: existingMethod } = await supabase.from("payout_methods")
        .select("id").eq("supplier_id", sup.id).eq("is_default", true).maybeSingle();
      const methodPayload = {
        supplier_id: sup.id, is_default: true, provider: "monobank", type: "iban",
        masked_pan: `**** **** **** ${1000 + i}`.slice(-19),
        card_token: `tok_sbx_${sup.id.slice(0, 6)}`,
        iban: `UA90305299299000414912345678${i}`,
        holder: `TEST SHOP ${i + 1}`,
        // auto_withdraw defaults OFF so seeded balances remain visible for demo;
        // owner/admin enables via the "Автооплати" dialog when they want to test it.
        auto_withdraw: false, auto_charge: isCod, min_withdraw: 100,
      };
      if (existingMethod) await supabase.from("payout_methods").update(methodPayload).eq("id", existingMethod.id);
      else await supabase.from("payout_methods").insert(methodPayload);
    }

    // Link the admin as a MANAGER of the last shop so manager (read-only) view can be demoed
    const managerShop = suppliers[suppliers.length - 1];
    if (managerShop) {
      const { data: link } = await supabase.from("shop_manager_links")
        .select("id").eq("supplier_id", managerShop.id).eq("profile_id", adminProfileId).maybeSingle();
      if (!link) {
        await supabase.from("shop_manager_links").insert({
          supplier_id: managerShop.id, profile_id: adminProfileId, assigned_by: adminProfileId,
        });
      }
    }

    return json({
      success: true,
      created: created.length,
      movements: movementsInserted.length,
      shops: suppliers.length,
      managerDemoShop: managerShop?.shop_name || null,
    });
  } catch (err: any) {
    console.error("seed-test-payments error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
