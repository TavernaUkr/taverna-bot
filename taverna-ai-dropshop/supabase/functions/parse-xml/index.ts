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

// Validate session and get profile
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

// Validate URL to prevent SSRF attacks
function validateUrl(urlString: string): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('Invalid URL format');
  }
  
  // Only allow HTTP and HTTPS
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS protocols are allowed');
  }
  
  // Block private and internal IP ranges
  const hostname = url.hostname.toLowerCase();
  const privatePatterns = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^localhost$/i,
    /^host\.docker\.internal$/i,
    /^kubernetes\.default/i,
    /^metadata\.google\.internal$/i,
    /\.local$/i,
    /\.internal$/i,
  ];
  
  if (privatePatterns.some(pattern => pattern.test(hostname))) {
    throw new Error('Access to private/internal networks is not allowed');
  }
  
  // Block cloud metadata endpoints
  const metadataEndpoints = [
    '169.254.169.254',
    'metadata.google.internal',
    '100.100.100.200', // Alibaba Cloud
  ];
  
  if (metadataEndpoints.some(endpoint => hostname === endpoint)) {
    throw new Error('Access to cloud metadata is not allowed');
  }
  
  return url;
}

// Calculate tiered markup percentage based on original price
// 33% for 0-1000 UAH, 28% for 1000-10000 UAH, 23% for 10000+ UAH, down to 20% for 1M+
function getTieredMarkupPercent(originalPrice: number): number {
  if (originalPrice >= 1000000) {
    return 20; // Minimum markup for 1M+ items
  } else if (originalPrice >= 100000) {
    // Linear interpolation between 23% and 20% for 100k-1M range
    const ratio = (originalPrice - 100000) / (1000000 - 100000);
    return 23 - (ratio * 3); // Goes from 23% to 20%
  } else if (originalPrice >= 10000) {
    return 23; // 23% for 10000+ UAH
  } else if (originalPrice >= 1000) {
    return 28; // 28% for 1000-10000 UAH
  } else {
    return 33; // 33% for 0-1000 UAH
  }
}

// Price markup function with tiered percentage
function calculateDropPrice(originalPrice: number, overrideMarkupPercent?: number): number {
  // Use override if provided, otherwise calculate based on price tier
  const markupPercent = overrideMarkupPercent ?? getTieredMarkupPercent(originalPrice);
  const markup = originalPrice * (1 + markupPercent / 100);
  
  // Aggressive rounding based on price range
  if (markup < 100) {
    return Math.ceil(markup / 5) * 5;
  } else if (markup < 500) {
    return Math.ceil(markup / 10) * 10;
  } else if (markup < 1000) {
    return Math.ceil(markup / 50) * 50;
  } else if (markup < 5000) {
    return Math.ceil(markup / 100) * 100;
  } else if (markup < 50000) {
    return Math.ceil(markup / 500) * 500;
  } else {
    return Math.ceil(markup / 1000) * 1000;
  }
}

// Parse XML to extract categories and products
function parseXML(xmlText: string) {
  const categories: Map<string, { id: string; name: string; parentId?: string }> = new Map();
  const products: any[] = [];
  
  const categoryRegex = /<category id="(\d+)"(?:\s+parentId="(\d+)")?>([^<]+)<\/category>/g;
  let match;
  while ((match = categoryRegex.exec(xmlText)) !== null) {
    categories.set(match[1], {
      id: match[1],
      name: match[3].trim(),
      parentId: match[2] || undefined
    });
  }
  
  const offerRegex = /<offer[^>]*id="(\d+)"[^>]*(?:group_id="(\d+)")?[^>]*>([\s\S]*?)<\/offer>/g;
  while ((match = offerRegex.exec(xmlText)) !== null) {
    const offerId = match[1];
    const groupId = match[2];
    const offerContent = match[3];
    
    const getName = (content: string) => {
      const m = content.match(/<name>([^<]+)<\/name>/);
      return m ? m[1].trim() : '';
    };
    
    const getDescription = (content: string) => {
      const m = content.match(/<description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/description>/);
      if (m) return m[1].trim().replace(/<br\s*\/?>/g, '\n');
      const m2 = content.match(/<description>([^<]*)<\/description>/);
      return m2 ? m2[1].trim() : '';
    };
    
    const getPrice = (content: string) => {
      const m = content.match(/<price>([^<]+)<\/price>/);
      return m ? parseFloat(m[1]) : 0;
    };
    
    const getCategoryId = (content: string) => {
      const m = content.match(/<categoryId>([^<]+)<\/categoryId>/);
      return m ? m[1] : null;
    };
    
    const getPictures = (content: string) => {
      const pics: string[] = [];
      const picRegex = /<picture>([^<]+)<\/picture>/g;
      let pm;
      while ((pm = picRegex.exec(content)) !== null) {
        pics.push(pm[1]);
      }
      return pics;
    };
    
    const getVendorCode = (content: string) => {
      const m = content.match(/<vendorCode>([^<]+)<\/vendorCode>/);
      return m ? m[1] : null;
    };
    
    const getAvailable = (content: string) => {
      const m = content.match(/<available>([^<]+)<\/available>/);
      return m ? m[1] === 'true' : true;
    };
    
    const getQuantity = (content: string) => {
      const m = content.match(/<quantity_in_stock>([^<]+)<\/quantity_in_stock>/);
      return m ? parseInt(m[1]) : null;
    };
    
    const getParam = (content: string, name: string) => {
      const regex = new RegExp(`<param name="${name}"[^>]*>([^<]+)<\/param>`);
      const m = content.match(regex);
      return m ? m[1] : null;
    };
    
    products.push({
      external_id: offerId,
      group_id: groupId,
      name: getName(offerContent),
      description: getDescription(offerContent),
      original_price: getPrice(offerContent),
      category_external_id: getCategoryId(offerContent),
      images: getPictures(offerContent),
      vendor_code: getVendorCode(offerContent),
      in_stock: getAvailable(offerContent),
      stock_quantity: getQuantity(offerContent),
      size: getParam(offerContent, 'Размер') || getParam(offerContent, 'Розмір'),
    });
  }
  
  return { categories: Array.from(categories.values()), products };
}

function createSlug(name: string): string {
  const translitMap: Record<string, string> = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ye',
    'ж': 'zh', 'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'yi', 'й': 'y', 'к': 'k', 'л': 'l',
    'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '', 'ю': 'yu',
    'я': 'ya', 'ы': 'y', 'э': 'e', 'ё': 'yo',
  };
  
  return name
    .toLowerCase()
    .split('')
    .map(char => translitMap[char] || char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Generate AI description for product
async function generateAIDescription(product: any, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: `Ти копірайтер для тактичного інтернет-магазину Taverna Group.
Переписуй описи товарів, роблячи їх:
- Привабливими та продаючими
- Українською мовою
- Короткими (до 300 символів)
- З ключовими характеристиками
- БЕЗ вигаданих характеристик

Повертай ТІЛЬКИ переписаний опис, нічого більше.`
          },
          {
            role: 'user',
            content: `Перепиши опис для товару:
Назва: ${product.name}
Оригінальний опис: ${product.description || 'Немає опису'}`
          }
        ],
      }),
    });

    if (!response.ok) {
      console.error('AI description generation failed:', response.status);
      return null;
    }

    const aiData = await response.json();
    return aiData.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('AI description error:', error);
    return null;
  }
}

// Auto-categorize products using AI
async function autoCategorizeProducts(products: any[], existingCategories: string[], apiKey: string): Promise<Map<string, string>> {
  const categoryMap = new Map<string, string>();
  
  if (products.length === 0) return categoryMap;

  try {
    // Take sample of products for categorization
    const sampleProducts = products.slice(0, 30).map(p => ({
      id: p.external_id,
      name: p.name,
      desc: (p.description || '').substring(0, 100)
    }));

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Ти AI для категоризації товарів тактичного магазину.
Існуючі категорії: ${existingCategories.join(', ') || 'Мілітарі, Одяг, Взуття, Аксесуари, Спорядження'}

Для кожного товару визнач найкращу категорію. Якщо потрібна нова категорія - створи її (українською).`
          },
          {
            role: 'user',
            content: `Категоризуй ці товари:\n${JSON.stringify(sampleProducts)}`
          }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'categorize_products',
              description: 'Присвоює категорії товарам',
              parameters: {
                type: 'object',
                properties: {
                  results: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        category: { type: 'string' }
                      },
                      required: ['id', 'category']
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

    if (response.ok) {
      const aiResult = await response.json();
      const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const categorized = JSON.parse(toolCall.function.arguments);
        for (const item of categorized.results || []) {
          categoryMap.set(item.id, item.category);
        }
      }
    }
  } catch (error) {
    console.error('Auto-categorization error:', error);
  }

  return categoryMap;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { xml_url, supplier_id, session_token, markup_percentage, enable_ai = true } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
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
    
    // Check if user has supplier role
    if (session.profile.user_type !== 'supplier' && session.profile.user_type !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Only suppliers and admins can import products' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`User ${session.profile.id} (${session.profile.user_type}) initiating XML import with ${markup_percentage}% markup`);
    
    if (!xml_url) {
      throw new Error('XML URL is required');
    }
    
    // Validate URL to prevent SSRF
    const validatedUrl = validateUrl(xml_url);
    console.log('Fetching XML from:', validatedUrl.href);
    
    // Fetch XML with timeout and size limit
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
    
    const xmlResponse = await fetch(validatedUrl.href, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Taverna-Parser/1.0',
        'Accept': 'application/xml, text/xml, */*',
      },
    });
    
    clearTimeout(timeoutId);
    
    if (!xmlResponse.ok) {
      throw new Error(`Failed to fetch XML: ${xmlResponse.status}`);
    }
    
    // Check content length
    const contentLength = xmlResponse.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 100_000_000) { // 100MB limit
      throw new Error('XML file too large (max 100MB)');
    }
    
    const xmlText = await xmlResponse.text();
    console.log('XML fetched, size:', xmlText.length);
    
    // Validate it looks like XML
    if (!xmlText.trim().startsWith('<?xml') && !xmlText.trim().startsWith('<')) {
      throw new Error('Response does not appear to be valid XML');
    }
    
    const { categories, products } = parseXML(xmlText);
    console.log(`Parsed ${categories.length} categories and ${products.length} products`);
    
    // Create import log
    const { data: importLog, error: logError } = await supabase
      .from('import_logs')
      .insert({
        supplier_id,
        status: 'processing',
        total_products: products.length,
      })
      .select()
      .single();
    
    if (logError) {
      console.error('Import log error:', logError);
    }
    
    // Get existing categories for AI context
    const { data: existingCats } = await supabase
      .from('categories')
      .select('id, name, slug, external_id');
    
    const existingCategoryNames = existingCats?.map(c => c.name) || [];
    
    // Auto-categorize if AI enabled
    let aiCategoryMap = new Map<string, string>();
    if (enable_ai && LOVABLE_API_KEY) {
      console.log('Running AI auto-categorization...');
      aiCategoryMap = await autoCategorizeProducts(products, existingCategoryNames, LOVABLE_API_KEY);
      console.log(`AI categorized ${aiCategoryMap.size} products`);
    }
    
    // Insert/update categories (including AI-suggested ones)
    const categoryIdMap = new Map<string, string>();
    
    // Create AI-suggested categories if they don't exist
    const aiCategories = new Set(aiCategoryMap.values());
    for (const catName of aiCategories) {
      if (!existingCategoryNames.includes(catName)) {
        const slug = createSlug(catName);
        const { data } = await supabase
          .from('categories')
          .upsert({
            name: catName,
            slug,
            is_active: true,
          }, { onConflict: 'slug' })
          .select()
          .single();
        
        if (data) {
          categoryIdMap.set(catName, data.id);
        }
      }
    }
    
    // Insert XML categories
    for (const cat of categories.filter(c => !c.parentId)) {
      const slug = createSlug(cat.name) + '-' + cat.id;
      const { data, error } = await supabase
        .from('categories')
        .upsert({
          external_id: cat.id,
          name: cat.name,
          slug,
          is_active: true,
        }, { onConflict: 'external_id' })
        .select()
        .single();
      
      if (data) {
        categoryIdMap.set(cat.id, data.id);
        categoryIdMap.set(cat.name, data.id);
      }
      if (error) console.error('Category insert error:', error);
    }
    
    for (const cat of categories.filter(c => c.parentId)) {
      const parentUuid = categoryIdMap.get(cat.parentId!);
      const slug = createSlug(cat.name) + '-' + cat.id;
      const { data, error } = await supabase
        .from('categories')
        .upsert({
          external_id: cat.id,
          name: cat.name,
          slug,
          parent_id: parentUuid,
          is_active: true,
        }, { onConflict: 'external_id' })
        .select()
        .single();
      
      if (data) {
        categoryIdMap.set(cat.id, data.id);
        categoryIdMap.set(cat.name, data.id);
      }
      if (error) console.error('Child category insert error:', error);
    }
    
    // Refresh category map
    const { data: allCategories } = await supabase
      .from('categories')
      .select('id, external_id, name');
    
    if (allCategories) {
      for (const cat of allCategories) {
        if (cat.external_id) categoryIdMap.set(cat.external_id, cat.id);
        categoryIdMap.set(cat.name, cat.id);
      }
    }
    
    const productGroups = new Map<string, any[]>();
    for (const product of products) {
      const key = product.group_id || product.external_id;
      if (!productGroups.has(key)) {
        productGroups.set(key, []);
      }
      productGroups.get(key)!.push(product);
    }
    
    let importedCount = 0;
    let failedCount = 0;
    let aiDescriptionsGenerated = 0;
    
    for (const [groupKey, groupProducts] of productGroups) {
      const firstProduct = groupProducts[0];
      const sizes = [...new Set(groupProducts.map(p => p.size).filter(Boolean))];
      const totalStock = groupProducts.reduce((sum, p) => sum + (p.stock_quantity || 0), 0);
      const inStock = groupProducts.some(p => p.in_stock);
      
      // Calculate price with tiered markup (or use supplier's override if provided)
      const dropPrice = calculateDropPrice(firstProduct.original_price, markup_percentage);
      const appliedMarkup = markup_percentage ?? getTieredMarkupPercent(firstProduct.original_price);
      
      // Determine category (AI-suggested or from XML)
      let categoryId = null;
      const aiCategory = aiCategoryMap.get(firstProduct.external_id);
      if (aiCategory) {
        categoryId = categoryIdMap.get(aiCategory);
      }
      if (!categoryId && firstProduct.category_external_id) {
        categoryId = categoryIdMap.get(firstProduct.category_external_id);
      }
      
      // Generate AI description (for first 50 products to avoid rate limits)
      let aiDescription = null;
      if (enable_ai && LOVABLE_API_KEY && importedCount < 50) {
        aiDescription = await generateAIDescription(firstProduct, LOVABLE_API_KEY);
        if (aiDescription) aiDescriptionsGenerated++;
      }
      
      const { error } = await supabase
        .from('products')
        .upsert({
          external_id: firstProduct.external_id,
          group_id: firstProduct.group_id,
          supplier_id,
          category_id: categoryId,
          name: firstProduct.name,
          description: aiDescription || firstProduct.description,
          original_description: firstProduct.description,
          ai_description: aiDescription,
          ai_category: aiCategory,
          price: dropPrice,
          original_price: firstProduct.original_price,
          currency: 'UAH',
          vendor_code: firstProduct.vendor_code,
          sizes: sizes.length > 0 ? sizes : null,
          images: firstProduct.images,
          in_stock: inStock,
          stock_quantity: totalStock,
        }, { onConflict: 'external_id' });
      
      if (error) {
        console.error('Product insert error:', error);
        failedCount++;
      } else {
        importedCount++;
      }
    }
    
    if (importLog) {
      await supabase
        .from('import_logs')
        .update({
          status: 'completed',
          imported_products: importedCount,
          failed_products: failedCount,
          completed_at: new Date().toISOString(),
        })
        .eq('id', importLog.id);
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        categories_count: categories.length + aiCategories.size,
        products_count: importedCount,
        failed_count: failedCount,
        ai_descriptions_generated: aiDescriptionsGenerated,
        markup_applied: `${markup_percentage}%`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error: unknown) {
    console.error('Parse XML error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
