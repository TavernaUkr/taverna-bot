import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key",
};

async function hashTokenSha256(token: string): Promise<string> {
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


interface ProductData {
  id: string;
  name: string;
  description?: string;
  ai_description?: string;
  price: number;
  original_price?: number; // Wholesale - NEVER show to customer
  images?: string[];
  brand?: string;
  vendor_code?: string;
  sizes?: string[];
  colors?: string[];
  category?: { name: string };
}

// Generate marketing "old price" - 18% higher than retail for discount perception
function getMarketingOldPrice(retailPrice: number): number {
  const oldPrice = retailPrice * 1.18;
  
  if (oldPrice < 100) {
    return Math.ceil(oldPrice / 5) * 5;
  } else if (oldPrice < 500) {
    return Math.ceil(oldPrice / 10) * 10;
  } else if (oldPrice < 1000) {
    return Math.ceil(oldPrice / 50) * 50;
  } else if (oldPrice < 5000) {
    return Math.ceil(oldPrice / 100) * 100;
  } else {
    return Math.ceil(oldPrice / 500) * 500;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    if (!TELEGRAM_BOT_TOKEN) {
      throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    }
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const body = await req.json();
    const { product_id, channel_id = "@taverna_ukr_group", custom_text, session_token } = body;

    // AuthN: require internal key OR staff session
    const _supabaseAuthClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const internalKey = req.headers.get("x-internal-key");
    if (internalKey !== Deno.env.get("INTERNAL_FUNCTION_KEY")) {
      if (!session_token) throw new Error("Unauthorized");
      const tokenHash = await hashTokenSha256(session_token);
      const { data: session } = await _supabaseAuthClient.from("sessions").select("profile_id").eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle();
      if (!session) throw new Error("Invalid session");
      const { data: roles } = await _supabaseAuthClient.from("user_roles").select("role").eq("user_id", session.profile_id);
      const roleList = (roles || []).map((r: any) => r.role);
      if (!roleList.includes("admin") && !roleList.includes("moderator") && !roleList.includes("supplier") && !roleList.includes("shop_manager")) {
        throw new Error("Forbidden");
      }
    }

    if (!product_id) {
      throw new Error("product_id is required");
    }

    console.log(`Publishing product ${product_id} to channel ${channel_id}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch product data with category
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("*, category:categories(name)")
      .eq("id", product_id)
      .single();

    if (productError || !product) {
      throw new Error(`Product not found: ${productError?.message || "No data"}`);
    }

    // Calculate marketing prices (NEVER expose wholesale/original_price)
    const retailPrice = product.price; // This already includes our markup
    const marketingOldPrice = getMarketingOldPrice(retailPrice);
    const discount = Math.round((1 - retailPrice / marketingOldPrice) * 100);
    const savings = marketingOldPrice - retailPrice;

    console.log("Product:", product.name, "Retail:", retailPrice, "Marketing old:", marketingOldPrice);

    // Generate AI description
    let aiDescription = "";
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
              content: `Ти - досвідчений копірайтер для тактичного магазину Taverna Group.
Створи привабливий опис товару для Telegram.

ПРАВИЛА:
- Пиши українською
- Використовуй емодзі (🔥💪🎯⚡✅🛡️)
- До 400 символів
- НЕ вигадуй характеристики
- НІКОЛИ не згадуй оптові/закупівельні ціни

ФОРМАТ:
🔥 [Назва товару]

[2-3 речення про переваги]

💰 Ціна: ${retailPrice.toLocaleString()} ₴
🏷️ Звичайна ціна: ${marketingOldPrice.toLocaleString()} ₴
✨ Економія: ${savings.toLocaleString()} ₴ (-${discount}%)

✅ [2-3 характеристики]

👇 Тисни кнопку нижче, щоб замовити!`
            },
            {
              role: "user",
              content: `Товар: ${product.name}
Ціна: ${retailPrice} ₴
Бренд: ${product.brand || "Не вказано"}
Опис: ${product.description || product.ai_description || ""}
Категорія: ${product.category?.name || "Тактика"}
Розміри: ${product.sizes?.join(", ") || "Універсальний"}
Кольори: ${product.colors?.join(", ") || "Стандарт"}`
            }
          ],
        }),
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        aiDescription = aiData.choices?.[0]?.message?.content || "";
        console.log("AI description generated");
      }
    } catch (aiError) {
      console.error("AI error:", aiError);
    }

    // Fallback text (also hides wholesale price)
    const messageText = custom_text || aiDescription || `
🔥 ${product.name}

💰 Ціна: ${retailPrice.toLocaleString()} ₴
🏷️ Звичайна ціна: ${marketingOldPrice.toLocaleString()} ₴
✨ Економія: ${savings.toLocaleString()} ₴

${product.description ? product.description.slice(0, 150) + "..." : ""}

👇 Тисни кнопку нижче, щоб замовити!
    `.trim();

    const miniAppUrl = `https://taverna-ai-dropshop.lovable.app/product/${product_id}`;

    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: "🛒 Замовити зараз", url: miniAppUrl }],
        [{ text: "📱 Відкрити в додатку", url: `https://t.me/TavernaShopBot/app?startapp=product_${product_id}` }],
      ],
    };

    const imageUrl = product.images?.[0];
    let telegramResponse;

    if (imageUrl) {
      telegramResponse = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: channel_id,
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
            chat_id: channel_id,
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

    // Update promotion record
    await supabase
      .from("promotions")
      .update({
        telegram_message_id: telegramResult.result.message_id,
        telegram_channel_id: channel_id,
        ai_generated_text: aiDescription || null,
        status: "active",
        start_date: new Date().toISOString(),
      })
      .eq("product_id", product_id)
      .eq("status", "pending");

    return new Response(
      JSON.stringify({
        success: true,
        message_id: telegramResult.result.message_id,
        channel: channel_id,
        retail_price: retailPrice,
        marketing_old_price: marketingOldPrice,
        discount_percent: discount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("telegram-publish error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
