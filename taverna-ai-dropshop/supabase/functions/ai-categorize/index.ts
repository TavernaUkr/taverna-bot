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
    const { products, action, session_token, parent_category } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Validate session token
    if (!session_token) {
      throw new Error('Authentication required');
    }
    
    const session = await validateSession(supabase, session_token);
    if (!session) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Check if user has appropriate role
    if (session.profile.user_type !== 'supplier' && session.profile.user_type !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Only suppliers and admins can use AI categorization' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`AI categorize request from user ${session.profile.id}: ${action}`);
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }
    
    // Fetch existing categories for context
    const { data: categories } = await supabase
      .from('categories')
      .select('id, name, slug, parent_id');
    
    const categoryList = categories?.map(c => c.name).join(', ') || 'Мілітарі, Одяг, Взуття, Аксесуари';
    
    if (action === 'categorize') {
      // Categorize products using AI
      const productDescriptions = products.slice(0, 20).map((p: any) => 
        `ID: ${p.id}, Назва: ${p.name}, Опис: ${p.description?.substring(0, 100) || 'немає'}`
      ).join('\n');
      
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            {
              role: 'system',
              content: `Ти AI асистент для категоризації товарів інтернет-магазину. 
Існуючі категорії: ${categoryList}

Для кожного товару визнач:
1. Найкращу категорію (ai_category)
2. Теги для пошуку (ai_tags) - масив з 3-5 ключових слів

Відповідай у форматі JSON масиву:
[{"id": "...", "ai_category": "...", "ai_tags": ["...", "..."]}]`
            },
            {
              role: 'user',
              content: `Категоризуй ці товари:\n${productDescriptions}`
            }
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'categorize_products',
                description: 'Категоризує товари та додає теги',
                parameters: {
                  type: 'object',
                  properties: {
                    results: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          ai_category: { type: 'string' },
                          ai_tags: { 
                            type: 'array',
                            items: { type: 'string' }
                          }
                        },
                        required: ['id', 'ai_category', 'ai_tags']
                      }
                    }
                  },
                  required: ['results']
                }
              }
            }
          ],
          tool_choice: { type: 'function', function: { name: 'categorize_products' } }
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('AI API error:', response.status, errorText);
        throw new Error(`AI API error: ${response.status}`);
      }
      
      const aiResult = await response.json();
      const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
      
      if (toolCall?.function?.arguments) {
        const categorizedProducts = JSON.parse(toolCall.function.arguments);
        
        // Update products with AI categorization
        for (const item of categorizedProducts.results || []) {
          await supabase
            .from('products')
            .update({
              ai_category: item.ai_category,
              ai_tags: item.ai_tags,
            })
            .eq('id', item.id);
        }
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            categorized: categorizedProducts.results?.length || 0 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    
    if (action === 'suggest_subcategories') {
      const { data: productsData } = await supabase
        .from('products')
        .select('name')
        .limit(100);
      
      const productNames = productsData?.map(p => p.name).join(', ') || '';
      
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            {
              role: 'system',
              content: `Ти AI асистент для структурування каталогу товарів.
На основі списку товарів запропонуй логічні підкатегорії для категорії "${parent_category}".
Підкатегорії мають бути українською мовою, короткими та зрозумілими.`
            },
            {
              role: 'user',
              content: `Товари: ${productNames}\n\nЗапропонуй 5-10 підкатегорій.`
            }
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'suggest_subcategories',
                description: 'Пропонує підкатегорії',
                parameters: {
                  type: 'object',
                  properties: {
                    subcategories: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          description: { type: 'string' }
                        },
                        required: ['name']
                      }
                    }
                  },
                  required: ['subcategories']
                }
              }
            }
          ],
          tool_choice: { type: 'function', function: { name: 'suggest_subcategories' } }
        }),
      });
      
      const aiResult = await response.json();
      const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
      
      if (toolCall?.function?.arguments) {
        const suggestions = JSON.parse(toolCall.function.arguments);
        return new Response(
          JSON.stringify({ success: true, subcategories: suggestions.subcategories }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    
    return new Response(
      JSON.stringify({ success: false, error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error: unknown) {
    console.error('AI categorize error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
