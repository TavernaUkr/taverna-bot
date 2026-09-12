import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key",
};

// Posting intervals (in minutes)
const INTERVALS = {
  newProducts: { min: 2, max: 5 },
  oldProducts: { min: 10, max: 25 },
};

function getRandomInterval(type: "new" | "old"): number {
  const interval = type === "new" ? INTERVALS.newProducts : INTERVALS.oldProducts;
  return Math.floor(Math.random() * (interval.max - interval.min + 1)) + interval.min;
}

// ========== USER AUTO-QUEUES PROCESSOR ==========
async function processUserAutoQueues(
  supabase: any,
  TELEGRAM_BOT_TOKEN: string,
  LOVABLE_API_KEY: string | undefined,
): Promise<Array<{ queue_id: string; product_id?: string; status: string }>> {
  const results: Array<{ queue_id: string; product_id?: string; status: string }> = [];
  const now = new Date();

  // Kyiv hour for active_hours filter
  const kyivHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Kiev",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );

  const { data: queues } = await supabase
    .from("user_auto_queues")
    .select("*")
    .eq("is_paused", false)
    .lte("next_execution_at", now.toISOString())
    .limit(20);

  if (!queues || queues.length === 0) return results;

  for (const q of queues) {
    try {
      // Active hours filter (if set)
      if (q.active_hours_start != null && q.active_hours_end != null) {
        const inHours =
          q.active_hours_start <= q.active_hours_end
            ? kyivHour >= q.active_hours_start && kyivHour < q.active_hours_end
            : kyivHour >= q.active_hours_start || kyivHour < q.active_hours_end;
        if (!inHours) {
          results.push({ queue_id: q.id, status: "outside_hours" });
          continue;
        }
      }

      // Date range filter
      if (q.start_date && new Date(q.start_date) > now) {
        results.push({ queue_id: q.id, status: "before_start" });
        continue;
      }
      if (q.end_date && new Date(q.end_date) < now) {
        await supabase.from("user_auto_queues").update({ is_paused: true }).eq("id", q.id);
        results.push({ queue_id: q.id, status: "expired" });
        continue;
      }

      // Pick product
      let product: any = null;
      let nextPosition = q.current_position;

      if (q.mode === "manual") {
        const ids: string[] = q.product_ids || [];
        if (ids.length === 0) {
          results.push({ queue_id: q.id, status: "no_products" });
          continue;
        }
        const pos = q.current_position % ids.length;
        const productId = ids[pos];
        const { data: p } = await supabase.from("products").select("*").eq("id", productId).maybeSingle();
        product = p;
        nextPosition = pos + 1;
      } else {
        // random from selected suppliers, exclude last 24h promoted
        const supplierIds: string[] = q.supplier_ids || [];
        if (supplierIds.length === 0) {
          results.push({ queue_id: q.id, status: "no_shops" });
          continue;
        }
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: recent } = await supabase
          .from("promotions")
          .select("product_id")
          .in("supplier_id", supplierIds)
          .gte("start_date", since);
        const recentIds = (recent || []).map((r: any) => r.product_id).filter(Boolean);

        let pq = supabase
          .from("products")
          .select("*")
          .in("supplier_id", supplierIds)
          .eq("in_stock", true)
          .limit(40);
        if (recentIds.length > 0) {
          pq = pq.not("id", "in", `(${recentIds.join(",")})`);
        }
        const { data: pool } = await pq;
        if (!pool || pool.length === 0) {
          results.push({ queue_id: q.id, status: "no_available_products" });
          // shift next exec anyway to avoid spinning
          await supabase
            .from("user_auto_queues")
            .update({ next_execution_at: new Date(Date.now() + q.interval_minutes * 60 * 1000).toISOString() })
            .eq("id", q.id);
          continue;
        }
        product = pool[Math.floor(Math.random() * pool.length)];
      }

      if (!product) {
        results.push({ queue_id: q.id, status: "product_missing" });
        continue;
      }

      // Build text
      const retailPrice = Number(product.price);
      const marketingOldPrice = Math.ceil((retailPrice * 1.18) / 10) * 10;
      const savings = marketingOldPrice - retailPrice;
      const discount = Math.round((savings / marketingOldPrice) * 100);
      let text = "";

      if (LOVABLE_API_KEY) {
        try {
          const aiR = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                {
                  role: "system",
                  content: `Ти копірайтер. Створи короткий пост для Telegram (до 350 символів) укр. мовою з емодзі про товар. Без оптових цін.`,
                },
                {
                  role: "user",
                  content: `Назва: ${product.name}\nЦіна: ${retailPrice} ₴\nЗвичайна: ${marketingOldPrice} ₴\nЗнижка: -${discount}%\n${product.description || product.ai_description || ""}`,
                },
              ],
            }),
          });
          if (aiR.ok) {
            const aj = await aiR.json();
            text = aj.choices?.[0]?.message?.content || "";
          }
        } catch (e) {
          console.error("AI gen error", e);
        }
      }

      if (!text) {
        text = `🔥 ${product.name}\n\n💰 ${retailPrice.toLocaleString()} ₴\n🏷️ Звичайна: ${marketingOldPrice.toLocaleString()} ₴\n✨ Економія: ${savings.toLocaleString()} ₴\n\n👇 Замовляй!`;
      }

      const platforms: string[] = q.platforms || ["telegram"];
      const includesTelegram = platforms.includes("telegram");
      let telegramMessageId: number | null = null;

      if (includesTelegram) {
        const channelId = "@taverna_ukr_group";
        const miniAppUrl = `https://taverna-ai-dropshop.lovable.app/product/${product.id}`;
        const inlineKeyboard = {
          inline_keyboard: [
            [{ text: "🛒 Замовити зараз", url: miniAppUrl }],
          ],
        };
        const imageUrl = product.images?.[0];
        const tgRes = imageUrl
          ? await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: channelId,
                photo: imageUrl,
                caption: text.slice(0, 1024),
                reply_markup: inlineKeyboard,
              }),
            })
          : await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: channelId,
                text,
                reply_markup: inlineKeyboard,
              }),
            });
        const tgJson = await tgRes.json();
        if (tgJson.ok) telegramMessageId = tgJson.result.message_id;
      }

      // Record promotion (per platform, simplified: one row with platforms[])
      await supabase.from("promotions").insert({
        supplier_id: product.supplier_id,
        product_id: product.id,
        promotion_type: q.type === "advertising" ? "auto_ad" : "auto",
        status: "active",
        platforms,
        telegram_message_id: telegramMessageId,
        telegram_channel_id: includesTelegram ? "@taverna_ukr_group" : null,
        ai_generated_text: text,
        start_date: now.toISOString(),
      });

      // Update queue
      await supabase
        .from("user_auto_queues")
        .update({
          last_executed_at: now.toISOString(),
          next_execution_at: new Date(Date.now() + q.interval_minutes * 60 * 1000).toISOString(),
          total_published: (q.total_published || 0) + 1,
          current_position: nextPosition,
        })
        .eq("id", q.id);

      results.push({ queue_id: q.id, product_id: product.id, status: "published" });
    } catch (err) {
      console.error("Queue error", q.id, err);
      results.push({ queue_id: q.id, status: "error" });
    }
  }

  return results;
}

// ========== PENDING PROMOTIONS PROCESSOR (user batch inserts) ==========
async function processPendingPromotions(
  supabase: any,
  TELEGRAM_BOT_TOKEN: string,
  LOVABLE_API_KEY: string | undefined,
): Promise<Array<{ promotion_id: string; status: string }>> {
  const results: Array<{ promotion_id: string; status: string }> = [];

  // Take up to 10 pending promotions per cycle to avoid Telegram rate limits
  const { data: pending } = await supabase
    .from("promotions")
    .select("*, product:products(id, name, price, images, description, ai_description, supplier_id)")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);

  if (!pending || pending.length === 0) return results;

  for (const promo of pending) {
    try {
      const product = promo.product;
      if (!product) {
        await supabase
          .from("promotions")
          .update({ status: "rejected", updated_at: new Date().toISOString() })
          .eq("id", promo.id);
        results.push({ promotion_id: promo.id, status: "no_product" });
        continue;
      }

      // Build text — substitute template variables if AI text contains {name}/{price},
      // otherwise use AI text as-is, or generate via Gemini, or fallback.
      const retailPrice = Number(product.price);
      const marketingOldPrice = Math.ceil((retailPrice * 1.18) / 10) * 10;
      const savings = marketingOldPrice - retailPrice;
      const discount = Math.round((savings / marketingOldPrice) * 100);

      let text = (promo.ai_generated_text || "").trim();
      const hasTemplateVars = /\{name\}|\{price\}/i.test(text);

      if (hasTemplateVars) {
        text = text
          .replace(/\{name\}/gi, product.name)
          .replace(/\{price\}/gi, String(retailPrice));
      } else if (!text && LOVABLE_API_KEY) {
        try {
          const aiR = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                {
                  role: "system",
                  content: `Ти копірайтер. Створи короткий пост для Telegram (до 350 символів) укр. мовою з емодзі про товар.`,
                },
                {
                  role: "user",
                  content: `Назва: ${product.name}\nЦіна: ${retailPrice} ₴\nЗнижка: -${discount}%\n${product.description || product.ai_description || ""}`,
                },
              ],
            }),
          });
          if (aiR.ok) {
            const aj = await aiR.json();
            text = aj.choices?.[0]?.message?.content || "";
          }
        } catch (e) {
          console.error("AI gen error in pending promo", e);
        }
      }

      if (!text) {
        text = `🔥 ${product.name}\n\n💰 ${retailPrice.toLocaleString()} ₴\n🏷️ Звичайна: ${marketingOldPrice.toLocaleString()} ₴\n✨ Економія: ${savings.toLocaleString()} ₴\n\n👇 Замовляй!`;
      }

      const platforms: string[] = promo.platforms || ["telegram"];
      const includesTelegram = platforms.includes("telegram");
      let telegramMessageId: number | null = null;

      if (includesTelegram) {
        const channelId = "@taverna_ukr_group";
        const miniAppUrl = `https://taverna-ai-dropshop.lovable.app/product/${product.id}`;
        const inlineKeyboard = {
          inline_keyboard: [[{ text: "🛒 Замовити зараз", url: miniAppUrl }]],
        };
        const imageUrl = product.images?.[0];
        const tgRes = imageUrl
          ? await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: channelId,
                photo: imageUrl,
                caption: text.slice(0, 1024),
                reply_markup: inlineKeyboard,
              }),
            })
          : await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: channelId,
                text,
                reply_markup: inlineKeyboard,
              }),
            });
        const tgJson = await tgRes.json();
        if (tgJson.ok) telegramMessageId = tgJson.result.message_id;
      }

      await supabase
        .from("promotions")
        .update({
          status: "active",
          ai_generated_text: text,
          telegram_message_id: telegramMessageId,
          telegram_channel_id: includesTelegram ? "@taverna_ukr_group" : null,
          start_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", promo.id);

      results.push({ promotion_id: promo.id, status: "published" });

      // Tiny gap to avoid Telegram rate limits (1.5s)
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      console.error("Pending promo error", promo.id, err);
      results.push({ promotion_id: promo.id, status: "error" });
    }
  }

  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // AuthN: cron-only endpoint, require internal key
  const internalKey = req.headers.get("x-internal-key");
  if (internalKey !== Deno.env.get("INTERNAL_FUNCTION_KEY")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!TELEGRAM_BOT_TOKEN) {
      throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);


    console.log("Starting auto-post cycle...");

    // ========== PENDING PROMOTIONS (user batch inserts) ==========
    const pendingResults = await processPendingPromotions(supabase, TELEGRAM_BOT_TOKEN, LOVABLE_API_KEY);
    console.log(`Processed ${pendingResults.length} pending promotions`);

    // ========== USER AUTO-QUEUES (per-user custom queues) ==========
    const userQueueResults = await processUserAutoQueues(supabase, TELEGRAM_BOT_TOKEN, LOVABLE_API_KEY);
    console.log(`Processed ${userQueueResults.length} user auto-queues`);

    // ========== PLATFORM ROUND-ROBIN (legacy supplier queue) ==========
    // Get the next supplier in the queue (round-robin)
    const { data: queue, error: queueError } = await supabase
      .from("auto_promotion_queue")
      .select("*, supplier:suppliers(id, shop_name, is_active)")
      .order("last_promoted_at", { ascending: true, nullsFirst: true })
      .limit(1)
      .single();

    if (queueError || !queue) {
      console.log("No suppliers in auto-promotion queue");
      return new Response(
        JSON.stringify({ success: true, user_queues_processed: userQueueResults.length, message: "No platform suppliers in queue" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supplierId = queue.supplier_id;
    console.log(`Processing supplier: ${queue.supplier?.shop_name || supplierId}`);

    // Get products from this supplier that haven't been promoted recently
    const { data: recentPromotions } = await supabase
      .from("promotions")
      .select("product_id")
      .eq("supplier_id", supplierId)
      .eq("promotion_type", "auto")
      .gte("start_date", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const recentProductIds = recentPromotions?.map((p) => p.product_id) || [];

    // Get a random product not recently promoted
    let productQuery = supabase
      .from("products")
      .select("*, category:categories(name)")
      .eq("supplier_id", supplierId)
      .eq("in_stock", true);

    if (recentProductIds.length > 0) {
      productQuery = productQuery.not("id", "in", `(${recentProductIds.join(",")})`);
    }

    const { data: products, error: productsError } = await productQuery.limit(20);

    if (productsError || !products || products.length === 0) {
      console.log("No available products for this supplier");
      
      // Move to next supplier
      await supabase
        .from("auto_promotion_queue")
        .update({ last_promoted_at: new Date().toISOString() })
        .eq("id", queue.id);

      return new Response(
        JSON.stringify({ success: false, message: "No products available" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Randomly select a product (AI Gemini style randomization)
    const randomIndex = Math.floor(Math.random() * products.length);
    const selectedProduct = products[randomIndex];

    console.log(`Selected product: ${selectedProduct.name}`);

    // Generate AI description
    let aiDescription = "";
    const retailPrice = selectedProduct.price;
    const marketingOldPrice = Math.ceil(retailPrice * 1.18 / 10) * 10;
    const discount = Math.round((1 - retailPrice / marketingOldPrice) * 100);
    const savings = marketingOldPrice - retailPrice;

    if (LOVABLE_API_KEY) {
      try {
        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              {
                role: "system",
                content: `Ти - копірайтер для тактичного магазину Taverna Group.
Створи привабливий опис товару для Telegram (до 400 символів).

ПРАВИЛА:
- Пиши українською
- Використовуй емодзі (🔥💪🎯⚡✅🛡️)
- НЕ вигадуй характеристики
- НІКОЛИ не згадуй оптові ціни

ФОРМАТ:
🔥 [Назва]

[2-3 речення про переваги]

💰 Ціна: ${retailPrice.toLocaleString()} ₴
🏷️ Звичайна: ${marketingOldPrice.toLocaleString()} ₴
✨ Економія: ${savings.toLocaleString()} ₴ (-${discount}%)

✅ [Характеристики]

👇 Замовляй!`
              },
              {
                role: "user",
                content: `Товар: ${selectedProduct.name}
Ціна: ${retailPrice} ₴
Бренд: ${selectedProduct.brand || "Не вказано"}
Опис: ${selectedProduct.description || selectedProduct.ai_description || ""}
Категорія: ${selectedProduct.category?.name || "Тактика"}`
              }
            ],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          aiDescription = aiData.choices?.[0]?.message?.content || "";
        }
      } catch (aiError) {
        console.error("AI error:", aiError);
      }
    }

    // Fallback text
    const messageText = aiDescription || `
🔥 ${selectedProduct.name}

💰 Ціна: ${retailPrice.toLocaleString()} ₴
🏷️ Звичайна: ${marketingOldPrice.toLocaleString()} ₴
✨ Економія: ${savings.toLocaleString()} ₴

${selectedProduct.description ? selectedProduct.description.slice(0, 150) + "..." : ""}

👇 Замовляй у Taverna Drop Shop!
    `.trim();

    // Publish to Telegram
    const channelId = "@taverna_ukr_group";
    const miniAppUrl = `https://taverna-ai-dropshop.lovable.app/product/${selectedProduct.id}`;

    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: "🛒 Замовити зараз", url: miniAppUrl }],
        [{ text: "📱 Відкрити в додатку", url: `https://t.me/TavernaShopBot/app?startapp=product_${selectedProduct.id}` }],
      ],
    };

    const imageUrl = selectedProduct.images?.[0];
    let telegramResponse;

    if (imageUrl) {
      telegramResponse = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: channelId,
            photo: imageUrl,
            caption: messageText.slice(0, 1024),
            parse_mode: "HTML",
            reply_markup: inlineKeyboard,
          }),
        }
      );
    } else {
      telegramResponse = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: channelId,
            text: messageText,
            parse_mode: "HTML",
            reply_markup: inlineKeyboard,
          }),
        }
      );
    }

    const telegramResult = await telegramResponse.json();

    if (!telegramResult.ok) {
      throw new Error(`Telegram error: ${telegramResult.description}`);
    }

    console.log("Posted to Telegram:", telegramResult.result.message_id);

    // Create promotion record
    await supabase.from("promotions").insert({
      supplier_id: supplierId,
      product_id: selectedProduct.id,
      promotion_type: "auto",
      status: "active",
      platforms: ["telegram"],
      telegram_message_id: telegramResult.result.message_id,
      telegram_channel_id: channelId,
      ai_generated_text: aiDescription || null,
      start_date: new Date().toISOString(),
    });

    // Update queue position
    await supabase
      .from("auto_promotion_queue")
      .update({
        last_promoted_at: new Date().toISOString(),
        total_promotions: (queue.total_promotions || 0) + 1,
      })
      .eq("id", queue.id);

    // Calculate next interval
    const isNewProduct = new Date(selectedProduct.created_at) > new Date(Date.now() - 24 * 60 * 60 * 1000);
    const nextInterval = getRandomInterval(isNewProduct ? "new" : "old");

    return new Response(
      JSON.stringify({
        success: true,
        product_id: selectedProduct.id,
        product_name: selectedProduct.name,
        supplier_id: supplierId,
        message_id: telegramResult.result.message_id,
        next_post_in_minutes: nextInterval,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("auto-post error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
