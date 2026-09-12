import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const { product, type = "telegram", aiHint } = await req.json();

    if (!product || !product.name) {
      throw new Error("Product data with name is required");
    }

    console.log(`Generating ${type} description for:`, product.name);

    // Calculate marketing prices (NEVER use original_price - that's wholesale)
    const retailPrice = product.price; // Already includes markup
    const marketingOldPrice = getMarketingOldPrice(retailPrice);
    const discount = Math.round((1 - retailPrice / marketingOldPrice) * 100);
    const savings = marketingOldPrice - retailPrice;

    // Add AI hint to system prompt if provided
    const aiHintSection = aiHint ? `\n\nДОДАТКОВІ ІНСТРУКЦІЇ ВІД КОРИСТУВАЧА:\n${aiHint}` : "";

    let systemPrompt = "";
    
    if (type === "telegram") {
      systemPrompt = `Ти - копірайтер для тактичного магазину Taverna Group.
Створи опис для Telegram каналу.

КРИТИЧНО ВАЖЛИВО:
- НІКОЛИ не згадуй оптові/закупівельні ціни
- Показуй ТІЛЬКИ роздрібну ціну та маркетингову "звичайну" ціну

ФОРМАТ:
🔥 [Назва]

[2-3 речення про переваги]

💰 Ціна: ${retailPrice.toLocaleString()} ₴
🏷️ Звичайна ціна: ${marketingOldPrice.toLocaleString()} ₴
✨ Економія: ${savings.toLocaleString()} ₴ (-${discount}%)

✅ [Характеристики]

👇 Тисни кнопку нижче, щоб замовити!${aiHintSection}`;
    } else if (type === "marketplace") {
      systemPrompt = `SEO-опис для маркетплейсу (OLX, Prom).
Ціна: ${retailPrice.toLocaleString()} ₴
Без емодзі. 400-800 символів. Ключові слова для пошуку.${aiHintSection}`;
    } else if (type === "social") {
      systemPrompt = `SMM пост для Instagram/Facebook.
Ціна: ${retailPrice.toLocaleString()} ₴ (звичайна ${marketingOldPrice.toLocaleString()} ₴)
Емодзі + 5-8 хештегів. До 280 символів.${aiHintSection}`;
    } else {
      systemPrompt = `Короткий опис товару. Ціна: ${retailPrice.toLocaleString()} ₴${aiHintSection}`;
    }

    const userMessage = `Товар: ${product.name}
Ціна: ${retailPrice} ₴
${product.brand ? `Бренд: ${product.brand}` : ""}
${product.description ? `Опис: ${product.description}` : ""}
${product.sizes?.length ? `Розміри: ${product.sizes.join(", ")}` : ""}
${product.colors?.length ? `Кольори: ${product.colors.join(", ")}` : ""}
${product.category ? `Категорія: ${product.category}` : ""}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI error:", errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error("AI generation failed");
    }

    const aiData = await aiResponse.json();
    const generatedText = aiData.choices?.[0]?.message?.content || "";

    console.log("Generated description for:", type);

    return new Response(
      JSON.stringify({
        success: true,
        description: generatedText,
        type,
        retail_price: retailPrice,
        marketing_old_price: marketingOldPrice,
        discount_percent: discount,
        savings: savings,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("generate-description error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
