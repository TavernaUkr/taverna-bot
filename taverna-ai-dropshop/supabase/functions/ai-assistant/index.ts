import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Hash the token for lookup
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

// Validate session
async function validateSession(supabase: any, sessionToken: string): Promise<any> {
  if (!sessionToken) return null;
  
  const tokenHash = await hashToken(sessionToken);
  
  const { data: session, error } = await supabase
    .from('sessions')
    .select('*, profile:profiles(*)')
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .single();
  
  if (error || !session) {
    return null;
  }
  
  return session;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, session_token, context, image_base64 } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }
    
    // Optional: validate session for personalized responses
    let profile = null;
    if (session_token) {
      const session = await validateSession(supabase, session_token);
      if (session) {
        profile = session.profile;
      }
    }
    
    // Fetch some products for context
    const { data: products } = await supabase
      .from('products')
      .select('id, name, price, sizes, colors, in_stock, brand, category:categories(name)')
      .eq('in_stock', true)
      .limit(50);
    
    // Fetch user's orders if authenticated
    let userOrders = null;
    if (profile) {
      const { data: orders } = await supabase
        .from('orders')
        .select(`
          id, order_number, status, total, created_at, delivery_tracking, delivery_service,
          items:order_items(product_name, quantity, price, size, color)
        `)
        .eq('profile_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(10);
      userOrders = orders;
    }

    // Fetch suppliers list
    const { data: suppliers } = await supabase
      .from('suppliers_public')
      .select('id, shop_name, is_active')
      .eq('is_active', true)
      .limit(20);
    
    const userName = profile?.first_name || 'шановний клієнте';
    
    // Build context for AI
    const productContext = products?.slice(0, 30).map(p => 
      `- ${p.name}: ${p.price}₴, бренд: ${p.brand || 'н/д'}, категорія: ${(p.category as any)?.name || 'н/д'}, розміри: ${p.sizes?.join(', ') || 'н/д'}`
    ).join('\n') || '';
    
    const ordersContext = userOrders?.map(o => {
      const items = (o as any).items?.map((i: any) => `${i.product_name} x${i.quantity}`).join(', ') || '';
      return `- Замовлення ${o.order_number}: статус "${o.status}", сума ${o.total}₴, доставка: ${o.delivery_service || 'н/д'}, ТТН: ${o.delivery_tracking || 'не вказано'}, товари: ${items}, дата: ${new Date(o.created_at).toLocaleDateString('uk-UA')}`;
    }).join('\n') || '';

    const suppliersContext = suppliers?.map(s => `- ${s.shop_name}`).join('\n') || '';
    
    const systemPrompt = `Ти — AI-асистент маркетплейсу Taverna, спеціалізованого на тактичному та військовому спорядженні.
    
Твої можливості:
1. Пошук товарів за описом, фото, характеристиками
2. Перевірка статусу замовлень користувача
3. Допомога з поверненням товарів (через фото)
4. Підбір розмірів одягу та взуття
5. Пошук постачальників за типом товару
6. З'єднання клієнта з постачальником

Правила:
1. Відповідай ТІЛЬКИ українською мовою
2. Будь дружнім та професійним
3. Використовуй емодзі помірковано для наочності
4. Якщо користувач питає про товар — шукай у наявному каталозі
5. Якщо питає про замовлення — надай статус та деталі з історії
6. Для підбору розміру — проси виміри (груди, талія, стопа в см)
7. Для повернення — поясни процедуру та попроси фото товару
8. НЕ вигадуй інформацію, якої не маєш
9. Якщо отримав фото — аналізуй його детально та допомагай

Користувач: ${userName}
${userOrders?.length ? `\n📦 Його замовлення:\n${ordersContext}` : '\n(Замовлень немає або користувач не авторизований)'}

🛍️ Приклади доступних товарів:\n${productContext}

🏪 Доступні постачальники:\n${suppliersContext}

📋 Процедура повернення:
1. Товар можна повернути протягом 14 днів
2. Товар має бути в оригінальній упаковці
3. Надішліть фото товару для перевірки
4. Ми створимо ТТН на повернення через Нову Пошту

📐 Розміри (орієнтовно):
- S: груди 88-92см, талія 73-77см
- M: груди 96-100см, талія 81-85см  
- L: груди 104-108см, талія 89-93см
- XL: груди 112-116см, талія 97-101см
- Взуття: вказуйте довжину стопи в см

ВАЖЛИВО: Відповідай коротко (до 4-5 речень), якщо не потрібно більше деталей. Якщо отримав фото — аналізуй що на ньому та пропонуй відповідні дії.`;

    // Prepare messages for AI
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
    ];
    
    // Add conversation context if provided
    if (context && Array.isArray(context)) {
      for (const msg of context.slice(-6)) { // Last 6 messages for context
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }
    
    // Add current message with optional image
    if (image_base64) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: message || 'Проаналізуй це зображення' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image_base64}` } },
        ],
      });
    } else {
      messages.push({ role: 'user', content: message });
    }
    
    console.log(`AI Assistant request from ${profile?.id || 'guest'}: ${message?.substring(0, 50)}...`);
    
    // Call Lovable AI Gateway (Gemini)
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: image_base64 ? 'google/gemini-2.5-pro' : 'google/gemini-2.5-flash',
        messages,
        max_tokens: 500,
        temperature: 0.7,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      throw new Error(`AI API error: ${response.status}`);
    }
    
    const aiResult = await response.json();
    const assistantMessage = aiResult.choices?.[0]?.message?.content || 'Вибачте, виникла помилка. Спробуйте ще раз.';
    
    // Log for analytics
    console.log(`AI response generated successfully`);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: assistantMessage,
        model: image_base64 ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error: unknown) {
    console.error('AI Assistant error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        message: 'Вибачте, AI-асистент тимчасово недоступний. Спробуйте пізніше або зверніться до підтримки.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
