import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Nova Poshta status code 9 / 10 / 11 mean the parcel was received by the recipient.
const RECEIVED_CODES = ["9", "10", "11"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const npKey = Deno.env.get("NOVA_POSHTA_API_KEY");

  try {
    // Orders that are shipped, have a TTN, and not yet marked received
    const { data: orders } = await supabase
      .from("orders")
      .select("id, delivery_tracking, status, received_at")
      .not("delivery_tracking", "is", null)
      .is("received_at", null)
      .in("status", ["shipped", "processing", "delivered"])
      .limit(100);

    let receivedCount = 0;
    const updated: string[] = [];

    for (const order of orders || []) {
      const ttn = (order.delivery_tracking || "").trim();
      if (!ttn || !npKey) continue;

      let statusCode = "";
      let statusText = "";
      try {
        const resp = await fetch("https://api.novaposhta.ua/v2.0/json/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: npKey,
            modelName: "TrackingDocument",
            calledMethod: "getStatusDocuments",
            methodProperties: { Documents: [{ DocumentNumber: ttn }] },
          }),
        });
        const json = await resp.json();
        const info = json?.data?.[0];
        statusCode = String(info?.StatusCode || "");
        statusText = info?.Status || "";
      } catch (e) {
        console.error("NP tracking error for", ttn, e);
        continue;
      }

      if (!statusCode) continue;

      if (RECEIVED_CODES.includes(statusCode)) {
        const nowIso = new Date().toISOString();
        await supabase.from("orders").update({
          received_at: nowIso,
          tracking_status: statusText || "received",
          status: "received",
        }).eq("id", order.id);

        // compute payout eligibility window
        await supabase.functions.invoke("process-payout", {
          body: { action: "recalc_eligibility", order_id: order.id },
        });

        receivedCount++;
        updated.push(order.id);
      } else if (statusText) {
        await supabase.from("orders").update({ tracking_status: statusText }).eq("id", order.id);
      }
    }

    // trigger auto payouts for any now-eligible splits
    await supabase.functions.invoke("process-payout", { body: { action: "run_auto_payouts" } });

    return new Response(JSON.stringify({ success: true, checked: (orders || []).length, received: receivedCount, updated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("track-deliveries error:", err);
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
