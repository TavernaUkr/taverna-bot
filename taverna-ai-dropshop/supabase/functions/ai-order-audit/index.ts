import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { order_id, session_token } = body;
    if (!order_id) throw new Error("order_id required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // AuthN: require internal key OR staff session
    const internalKey = req.headers.get("x-internal-key");
    if (internalKey !== Deno.env.get("INTERNAL_FUNCTION_KEY")) {
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
      if (!roleList.includes("admin") && !roleList.includes("moderator")) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }


    // Fetch order
    const { data: order } = await supabase.from("orders").select("*").eq("id", order_id).single();
    if (!order) throw new Error("Order not found");

    // Fetch order items
    const { data: items } = await supabase.from("order_items").select("*").eq("order_id", order_id);

    // Fetch related tickets
    const { data: tickets } = await supabase.from("support_tickets").select("id, type, status").eq("related_order_id", order_id);

    // Fetch ticket messages
    let allMessages: any[] = [];
    if (tickets?.length) {
      const ticketIds = tickets.map((t: any) => t.id);
      const { data: msgs } = await supabase.from("ticket_messages").select("*").in("ticket_id", ticketIds).order("created_at");
      allMessages = msgs || [];
    }

    // Fetch ratings for this order
    const { data: ratings } = await supabase.from("app_ratings").select("*").eq("order_id", order_id);

    // Find supplier
    let supplierId: string | null = null;
    if (items?.length) {
      const productIds = items.map((i: any) => i.product_id).filter(Boolean);
      if (productIds.length) {
        const { data: products } = await supabase.from("products").select("supplier_id").in("id", productIds).limit(1);
        supplierId = products?.[0]?.supplier_id || null;
      }
    }

    // Build prompt for AI
    const prompt = `Проаналізуй замовлення та створи короткий аудит-звіт українською мовою.

Замовлення: ${order.order_number || order.id}
Статус: ${order.status}
Сума: ${order.total} ₴
Дата: ${order.created_at}

Товари (${items?.length || 0}):
${items?.map((i: any) => `- ${i.product_name} x${i.quantity} = ${i.total}₴`).join("\n") || "Немає"}

Тікети підтримки (${tickets?.length || 0}):
${tickets?.map((t: any) => `- Тип: ${t.type}, Статус: ${t.status}`).join("\n") || "Немає"}

Повідомлення в чатах (${allMessages.length}):
${allMessages.slice(-20).map((m: any) => `[${m.sender_role}]: ${m.message_text.slice(0, 200)}`).join("\n") || "Немає"}

Оцінки (${ratings?.length || 0}):
${ratings?.map((r: any) => `- Тип: ${r.rating_type}, Оцінка: ${r.rating}/5${r.comment ? `, Коментар: ${r.comment}` : ""}`).join("\n") || "Немає"}

Надай:
1. Короткий підсумок ситуації (2-3 речення)
2. Рівень задоволення клієнта (оцінка від 0.0 до 1.0)
3. Ключові проблеми (якщо є)
4. Рекомендації

Відповідь в форматі JSON:
{"summary": "...", "sentiment": 0.0-1.0, "issues": ["..."], "recommendations": ["..."]}`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Ти аналітик якості сервісу маркетплейсу. Відповідай тільки JSON." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiResponse.ok) throw new Error(`AI error: ${aiResponse.status}`);
    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let summary = aiContent;
    let sentiment = 0.5;
    try {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        summary = `${parsed.summary || ""}\n\n` +
          (parsed.issues?.length ? `⚠️ Проблеми: ${parsed.issues.join(", ")}\n` : "") +
          (parsed.recommendations?.length ? `💡 Рекомендації: ${parsed.recommendations.join(", ")}` : "");
        sentiment = typeof parsed.sentiment === "number" ? parsed.sentiment : 0.5;
      }
    } catch (_) {}

    // Save report
    const { data: report, error } = await supabase.from("ai_order_reports").insert({
      order_id,
      supplier_id: supplierId,
      report_type: "order_summary",
      ai_summary: summary.trim(),
      sentiment_score: sentiment,
    }).select().single();

    if (error) throw error;

    return new Response(JSON.stringify({ report }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("AI audit error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
