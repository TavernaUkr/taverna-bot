import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const { action, order_id, session_token, deadline_id } = await req.json();

    // AuthN: require internal key OR admin session
    const internalKey = req.headers.get("x-internal-key");
    const isInternal = internalKey === Deno.env.get("INTERNAL_FUNCTION_KEY");
    if (!isInternal) {
      if (!session_token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const tokenHash = await hashToken(session_token);
      const { data: session } = await supabase.from("sessions").select("profile_id").eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle();
      if (!session) {
        return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", session.profile_id);
      const roleList = (roles || []).map((r: any) => r.role);
      if (!roleList.includes("admin")) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Restrict cron-only actions to internal callers
      if (["run_auto_payouts", "recalc_eligibility", "check_deadlines", "legacy_auto_payouts"].includes(action)) {
        return new Response(JSON.stringify({ error: "Forbidden: cron-only action" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }


    // Action: split_order — calculate and create order splits when order is placed
    if (action === 'split_order') {
      if (!order_id) throw new Error('order_id required');

      // Get order with items
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('*, order_items(*, products(supplier_id, original_price, price))')
        .eq('id', order_id)
        .single();

      if (orderErr || !order) throw new Error('Order not found');

      // Group items by supplier
      const supplierTotals: Record<string, { productTotal: number; supplierAmount: number; commission: number }> = {};

      for (const item of (order as any).order_items || []) {
        const product = item.products;
        if (!product?.supplier_id) continue;

        const supplierId = product.supplier_id;
        // original_price = drop price (supplier cost), price = retail price with markup
        const dropPrice = product.original_price || (product.price / 1.33); // fallback calc
        const supplierItemTotal = dropPrice * item.quantity;
        const retailItemTotal = item.total || (item.price * item.quantity);
        const commission = retailItemTotal - supplierItemTotal;

        if (!supplierTotals[supplierId]) {
          supplierTotals[supplierId] = { productTotal: 0, supplierAmount: 0, commission: 0 };
        }
        supplierTotals[supplierId].productTotal += retailItemTotal;
        supplierTotals[supplierId].supplierAmount += supplierItemTotal;
        supplierTotals[supplierId].commission += commission;
      }

      const paymentMethod = order.payment_method || 'cod';
      const splits = [];

      for (const [supplierId, totals] of Object.entries(supplierTotals)) {
        const isPrepaid = paymentMethod === 'prepaid' || paymentMethod === 'card';
        const splitData = {
          order_id,
          supplier_id: supplierId,
          product_total: Math.round(totals.productTotal * 100) / 100,
          supplier_amount: Math.round(totals.supplierAmount * 100) / 100,
          platform_commission: Math.round(totals.commission * 100) / 100,
          markup_percentage: 33,
          payment_method: paymentMethod,
          split_status: 'pending',
          payout_stage: 'created',
          payout_type: isPrepaid ? 'full_prepaid' : 'partial_markup',
        };

        const { data: split, error: splitErr } = await supabase
          .from('order_splits')
          .insert(splitData)
          .select()
          .single();

        if (splitErr) {
          console.error('Split insert error:', splitErr);
          continue;
        }
        splits.push(split);

        // For prepaid orders: auto-create payout to supplier
        if (paymentMethod === 'prepaid' || paymentMethod === 'card') {
          // Get supplier IBAN
          const { data: supplier } = await supabase
            .from('suppliers')
            .select('payment_iban, payment_card_holder, payment_bank_name')
            .eq('id', supplierId)
            .single();

          if (supplier?.payment_iban) {
            await supabase.from('supplier_payouts').insert({
              supplier_id: supplierId,
              order_split_id: split.id,
              amount: totals.supplierAmount,
              payout_method: 'monobank_api',
              payout_status: 'scheduled',
              iban: supplier.payment_iban,
              scheduled_at: new Date().toISOString(),
            });

            // Update split status
            await supabase.from('order_splits')
              .update({ split_status: 'payout_scheduled' })
              .eq('id', split.id);
          }
        }

        // For COD orders: create payment deadline (14 days after delivery)
        if (paymentMethod === 'cod' || paymentMethod === 'cash_on_delivery') {
          const deadlineDate = new Date();
          deadlineDate.setDate(deadlineDate.getDate() + 14);

          await supabase.from('supplier_payment_deadlines').insert({
            supplier_id: supplierId,
            order_id,
            amount_due: totals.commission, // Supplier owes us the commission
            deadline_at: deadlineDate.toISOString(),
          });
        }
      }

      return new Response(JSON.stringify({ success: true, splits }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: check_deadlines — check for overdue supplier payments, auto-ban
    if (action === 'check_deadlines') {
      const now = new Date().toISOString();

      // Find overdue unpaid deadlines
      const { data: overdue } = await supabase
        .from('supplier_payment_deadlines')
        .select('*, suppliers(shop_name, id, is_active)')
        .eq('is_paid', false)
        .eq('auto_ban_triggered', false)
        .lt('deadline_at', now);

      const bannedSuppliers: string[] = [];

      for (const deadline of overdue || []) {
        // Mark as ban triggered
        await supabase
          .from('supplier_payment_deadlines')
          .update({ auto_ban_triggered: true })
          .eq('id', deadline.id);

        // Deactivate supplier
        await supabase
          .from('suppliers')
          .update({ is_active: false })
          .eq('id', deadline.supplier_id);

        // Deactivate all their products
        await supabase
          .from('products')
          .update({ in_stock: false })
          .eq('supplier_id', deadline.supplier_id);

        bannedSuppliers.push(deadline.supplier_id);
      }

      return new Response(JSON.stringify({
        success: true,
        checked: (overdue || []).length,
        banned_suppliers: bannedSuppliers,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: process_payouts — execute pending Monobank API payouts
    if (action === 'process_payouts') {
      const { data: pendingPayouts } = await supabase
        .from('supplier_payouts')
        .select('*')
        .eq('payout_status', 'scheduled')
        .order('scheduled_at', { ascending: true })
        .limit(10);

      const results = [];

      for (const payout of pendingPayouts || []) {
        try {
          // TODO: Integrate actual Monobank API here
          // For now, mark as processed and log
          // const monoResponse = await fetch('https://api.monobank.ua/api/...', { ... });

          await supabase
            .from('supplier_payouts')
            .update({
              payout_status: 'completed',
              processed_at: new Date().toISOString(),
              transaction_id: `MONO-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            })
            .eq('id', payout.id);

          // Update split status
          if (payout.order_split_id) {
            await supabase
              .from('order_splits')
              .update({ split_status: 'paid' })
              .eq('id', payout.order_split_id);
          }

          results.push({ id: payout.id, status: 'completed' });
        } catch (err) {
          await supabase
            .from('supplier_payouts')
            .update({
              payout_status: 'failed',
              error_message: err instanceof Error ? err.message : 'Unknown error',
            })
            .eq('id', payout.id);

          results.push({ id: payout.id, status: 'failed', error: err instanceof Error ? err.message : 'Unknown' });
        }
      }

      return new Response(JSON.stringify({ success: true, processed: results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: mark_deadline_paid — supplier paid their margin
    if (action === 'mark_deadline_paid') {
      if (!deadline_id) throw new Error('deadline_id required');


      await supabase
        .from('supplier_payment_deadlines')
        .update({ is_paid: true, paid_at: new Date().toISOString() })
        .eq('id', deadline_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: recalc_eligibility — compute eligible_payout_at for a received order
    if (action === 'recalc_eligibility') {
      if (!order_id) throw new Error('order_id required');
      await recalcEligibility(supabase, order_id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: run_auto_payouts — drive the balance ledger:
    // 1) accrue eligible splits onto shop balances, 2) execute auto-withdrawals.
    if (action === 'run_auto_payouts') {
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const base = `${Deno.env.get('SUPABASE_URL')}/functions/v1/bank-gateway`;
      const callGateway = async (gwAction: string) => {
        try {
          const r = await fetch(base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': serviceKey },
            body: JSON.stringify({ action: gwAction }),
          });
          return await r.json();
        } catch (e) {
          return { error: e instanceof Error ? e.message : 'gateway call failed' };
        }
      };
      const accruals = await callGateway('run_accruals');
      const withdrawals = await callGateway('run_auto_withdrawals');
      return new Response(JSON.stringify({ success: true, accruals, withdrawals }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: legacy_auto_payouts — old direct-payout path (kept for manual use)
    if (action === 'legacy_auto_payouts') {
      const nowIso = new Date().toISOString();
      const { data: due } = await supabase
        .from('order_splits')
        .select('*')
        .eq('payout_stage', 'created')
        .not('eligible_payout_at', 'is', null)
        .lte('eligible_payout_at', nowIso)
        .limit(50);

      const paid: string[] = [];
      for (const split of due || []) {
        // move to processing
        await supabase.from('order_splits')
          .update({ payout_stage: 'processing' })
          .eq('id', split.id);

        const { data: supplier } = await supabase
          .from('suppliers')
          .select('payment_iban, payment_card_holder, payment_bank_name')
          .eq('id', split.supplier_id)
          .single();

        const hasRequisites = !!(supplier?.payment_iban || supplier?.payment_card_holder);
        const now2 = new Date().toISOString();

        if (!hasRequisites) {
          // keep in processing until admin adds requisites / pays manually
          continue;
        }

        const txId = `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // auto receipt record (text reference; real bank PDF can be attached manually)
        const receiptRef = `Авто-перерахування ${split.supplier_amount}₴ на ${supplier?.payment_iban || supplier?.payment_card_holder} · ${txId}`;

        await supabase.from('supplier_payouts').insert({
          supplier_id: split.supplier_id,
          order_split_id: split.id,
          amount: split.supplier_amount,
          payout_method: 'auto_fop',
          payout_status: 'completed',
          iban: supplier?.payment_iban || null,
          transaction_id: txId,
          processed_at: now2,
        });

        await supabase.from('order_splits').update({
          payout_stage: 'paid',
          split_status: 'paid',
          paid_at: now2,
          receipt_url: split.receipt_url || receiptRef,
          receipt_uploaded_at: now2,
        }).eq('id', split.id);

        paid.push(split.id);
      }

      return new Response(JSON.stringify({ success: true, paid_count: paid.length, paid }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Unknown action');
  } catch (err) {
    console.error('Process payout error:', err);
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Internal error',
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function recalcEligibility(supabase: any, orderId: string) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, received_at')
    .eq('id', orderId)
    .single();
  if (!order?.received_at) return;

  const { data: splits } = await supabase
    .from('order_splits')
    .select('id, supplier_id')
    .eq('order_id', orderId);

  const { data: items } = await supabase
    .from('order_items')
    .select('product_id, products(supplier_id, is_returnable, return_window_days)')
    .eq('order_id', orderId);

  for (const split of splits || []) {
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

    await supabase.from('order_splits').update({
      eligible_payout_at: eligible.toISOString(),
      is_returnable: anyReturnable,
    }).eq('id', split.id);
  }
}

