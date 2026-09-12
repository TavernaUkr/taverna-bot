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

// Send Telegram notification to admin
async function notifyAdmin(botToken: string, adminChatId: string, message: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminChatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (error) {
    console.error('Failed to notify admin:', error);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { application, session_token, action } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const ADMIN_CHAT_ID = Deno.env.get('ADMIN_TELEGRAM_CHAT_ID') || '';

    // Action: submit - Create new application
    if (action === 'submit') {
      // Validate session if provided
      let profileId = null;
      if (session_token) {
        const session = await validateSession(supabase, session_token);
        if (session) {
          profileId = session.profile.id;
        }
      }

      // Check for similar suppliers by name/tax_id
      const { data: existingSuppliers } = await supabase
        .from('suppliers')
        .select('id, name, contact_email')
        .or(`name.ilike.%${application.shop_name}%,contact_email.eq.${application.email}`);

      // Check for similar products if XML provided
      let plagiarismAnalysis = null;
      let similarProducts: any[] = [];
      
      if (application.xml_url && LOVABLE_API_KEY) {
        // Sample first few product names for analysis
        const { data: allProducts } = await supabase
          .from('products')
          .select('id, name, supplier_id')
          .limit(500);

        if (allProducts && allProducts.length > 0) {
          // Use AI to analyze potential overlap
          const analysisResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-3-flash-preview',
              messages: [
                {
                  role: 'system',
                  content: `Ти аналітик для маркетплейсу. Проаналізуй заявку постачальника та оціни:
1. Чи є ознаки перекупства (reseller) - продаж товарів інших брендів
2. Чи є схожі товари у інших постачальників (plagiarism score)
3. Які категорії товарів пропонує постачальник

Відповідай JSON з полями: reseller_probability (0-100), plagiarism_score (0-100), categories (array), analysis_text (короткий текст).`
                },
                {
                  role: 'user',
                  content: `Заявка постачальника:
Назва: ${application.shop_name}
Опис: ${application.description || 'Не вказано'}
XML URL: ${application.xml_url || 'Не вказано'}

Існуючі товари в базі (приклади): ${allProducts.slice(0, 50).map(p => p.name).join(', ')}`
                }
              ],
              tools: [
                {
                  type: 'function',
                  function: {
                    name: 'analyze_supplier',
                    description: 'Аналізує заявку постачальника',
                    parameters: {
                      type: 'object',
                      properties: {
                        reseller_probability: { type: 'number', minimum: 0, maximum: 100 },
                        plagiarism_score: { type: 'number', minimum: 0, maximum: 100 },
                        categories: { type: 'array', items: { type: 'string' } },
                        analysis_text: { type: 'string' }
                      },
                      required: ['reseller_probability', 'plagiarism_score', 'categories', 'analysis_text']
                    }
                  }
                }
              ],
              tool_choice: { type: 'function', function: { name: 'analyze_supplier' } }
            }),
          });

          if (analysisResponse.ok) {
            const aiResult = await analysisResponse.json();
            const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
            if (toolCall?.function?.arguments) {
              plagiarismAnalysis = JSON.parse(toolCall.function.arguments);
            }
          }
        }
      }

      // Insert application
      const { data: newApplication, error: insertError } = await supabase
        .from('supplier_applications')
        .insert({
          profile_id: profileId,
          telegram_id: application.telegram_id,
          supplier_type: application.supplier_type,
          full_name: application.full_name,
          company_name: application.company_name,
          tax_id: application.tax_id,
          email: application.email,
          phone: application.phone,
          telegram_username: application.telegram_username,
          shop_name: application.shop_name,
          xml_url: application.xml_url,
          telegram_channel: application.telegram_channel,
          description: application.description,
          manager_telegram: application.manager_telegram || null,
          payment_iban: application.payment_iban || null,
          payment_card_holder: application.payment_card_holder || null,
          payment_bank_name: application.payment_bank_name || null,
          ai_analysis: plagiarismAnalysis || {},
          similar_suppliers: existingSuppliers || [],
          plagiarism_score: plagiarismAnalysis?.plagiarism_score || 0,
          reseller_probability: plagiarismAnalysis?.reseller_probability || 0,
          suggested_categories: plagiarismAnalysis?.categories || [],
          status: 'pending'
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(`Failed to create application: ${insertError.message}`);
      }

      // Notify admin via Telegram
      if (TELEGRAM_BOT_TOKEN && ADMIN_CHAT_ID) {
        const adminMessage = `🆕 <b>Нова заявка постачальника!</b>

📋 <b>Магазин:</b> ${application.shop_name}
👤 <b>Контакт:</b> ${application.full_name}
📧 <b>Email:</b> ${application.email}
📱 <b>Телефон:</b> ${application.phone}
${application.telegram_username ? `💬 Telegram: @${application.telegram_username.replace('@', '')}` : ''}

${plagiarismAnalysis ? `
📊 <b>AI-аналіз:</b>
• Ймовірність перекупства: ${plagiarismAnalysis.reseller_probability}%
• Схожість з існуючими: ${plagiarismAnalysis.plagiarism_score}%
• Категорії: ${plagiarismAnalysis.categories?.join(', ') || 'Невизначено'}

📝 ${plagiarismAnalysis.analysis_text}` : ''}

${existingSuppliers && existingSuppliers.length > 0 ? `
⚠️ <b>Схожі постачальники:</b>
${existingSuppliers.map(s => `• ${s.name}`).join('\n')}` : ''}

🔗 Перегляньте в панелі адміністратора.`;

        await notifyAdmin(TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, adminMessage);
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          application_id: newApplication.id,
          message: 'Заявку надіслано на розгляд'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: approve/reject - Admin actions (require admin role)
    if (action === 'approve' || action === 'reject') {
      if (!session_token) {
        throw new Error('Authentication required');
      }
      
      const session = await validateSession(supabase, session_token);
      if (!session) {
        return new Response(
          JSON.stringify({ error: 'Invalid session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Check admin role from secure user_roles table
      const { data: adminRole } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.profile.id)
        .eq('role', 'admin')
        .single();
      
      if (!adminRole) {
        return new Response(
          JSON.stringify({ error: 'Admin access required' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { application_id, rejection_reason, markup_percentage = 33 } = application;

      if (action === 'approve') {
        // Get application details
        const { data: app } = await supabase
          .from('supplier_applications')
          .select('*')
          .eq('id', application_id)
          .single();

        if (!app) {
          throw new Error('Application not found');
        }

        // Create supplier record
        const managerTg = app.manager_telegram || '';
        const { data: newSupplier, error: supplierError } = await supabase
          .from('suppliers')
          .insert({
            shop_name: app.shop_name,
            company_name: app.company_name || app.shop_name,
            contact_name: app.full_name,
            contact_phone: app.phone,
            contact_email: app.email,
            legal_type: app.supplier_type || 'individual',
            tax_code: app.tax_id,
            xml_url: app.xml_url,
            description: app.description,
            manager_telegram: managerTg || null,
            markup_percentage: markup_percentage,
            is_active: true,
            payment_iban: app.payment_iban || null,
            payment_card_holder: app.payment_card_holder || null,
            payment_bank_name: app.payment_bank_name || null,
          })
          .select()
          .single();

        if (supplierError) {
          throw new Error(`Failed to create supplier: ${supplierError.message}`);
        }

        // Add supplier role to user_roles table (secure roles)
        if (app.profile_id) {
          // Update legacy user_type for backward compatibility
          await supabase
            .from('profiles')
            .update({ user_type: 'supplier' })
            .eq('id', app.profile_id);
          
          // Add supplier role to secure user_roles table
          await supabase
            .from('user_roles')
            .upsert({ 
              user_id: app.profile_id, 
              role: 'supplier' 
            }, { onConflict: 'user_id,role' });
          
          // Link supplier owner as a manager too
          await supabase
            .from('shop_manager_links')
            .insert({
              profile_id: app.profile_id,
              supplier_id: newSupplier.id,
              assigned_by: session.profile.id,
            });
          
          console.log(`Added supplier role to user ${app.profile_id}`);
        }

        // Handle manager_telegram: find or invite manager
        if (managerTg) {
          const cleanUsername = managerTg.replace('@', '').trim();
          
          // Try to find existing profile by telegram_username
          const { data: managerProfile } = await supabase
            .from('profiles')
            .select('id')
            .eq('telegram_username', cleanUsername)
            .single();
          
          if (managerProfile) {
            // Manager already registered - assign role and link
            await supabase
              .from('user_roles')
              .upsert({ 
                user_id: managerProfile.id, 
                role: 'shop_manager' 
              }, { onConflict: 'user_id,role' });
            
            await supabase
              .from('shop_manager_links')
              .upsert({
                profile_id: managerProfile.id,
                supplier_id: newSupplier.id,
                assigned_by: session.profile.id,
              }, { onConflict: 'profile_id,supplier_id' });
            
            console.log(`Linked existing manager @${cleanUsername} to supplier ${newSupplier.id}`);
          }
          
          // Send Telegram invitation to manager
          if (TELEGRAM_BOT_TOKEN) {
            // We need to resolve username to chat_id - this requires the manager to have started the bot
            // Send via username mention in admin notification instead
            console.log(`Manager @${cleanUsername} will be auto-linked on first login`);
          }
        }

        // If no manager specified and approver is admin, auto-link admin as manager
        if (!managerTg) {
          await supabase
            .from('shop_manager_links')
            .upsert({
              profile_id: session.profile.id,
              supplier_id: newSupplier.id,
              assigned_by: session.profile.id,
            }, { onConflict: 'profile_id,supplier_id' });
          
          console.log(`Admin ${session.profile.id} auto-linked as manager for supplier ${newSupplier.id}`);
        }

        // Update application status
        await supabase
          .from('supplier_applications')
          .update({
            status: 'approved',
            reviewed_by: session.profile.id,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', application_id);

        // Create categories if suggested
        if (app.suggested_categories && app.suggested_categories.length > 0) {
          for (const categoryName of app.suggested_categories) {
            const slug = categoryName.toLowerCase()
              .replace(/[а-яіїєґ]/g, (char: string) => {
                const map: Record<string, string> = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ye', 'ж': 'zh', 'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'yi', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '', 'ю': 'yu', 'я': 'ya' };
                return map[char] || char;
              })
              .replace(/[^a-z0-9]+/g, '-');
            
            await supabase
              .from('categories')
              .upsert({ 
                name: categoryName, 
                slug: slug,
                is_active: true 
              }, { onConflict: 'slug' });
          }
        }

        // Notify supplier via Telegram if possible
        if (TELEGRAM_BOT_TOKEN && app.telegram_id) {
          let managerMsg = '';
          if (managerTg) {
            managerMsg = `\n\n👨‍💼 Менеджер магазину: @${managerTg.replace('@', '')} — отримає запрошення зареєструватись у нашому додатку.`;
          }
          await notifyAdmin(TELEGRAM_BOT_TOKEN, app.telegram_id.toString(), 
            `✅ <b>Вітаємо!</b> Вашу заявку на магазин "${app.shop_name}" схвалено!\n\nТепер ви можете завантажити товари через панель постачальника.${managerMsg}`
          );
        }

        // Send invitation to manager via Telegram bot
        if (TELEGRAM_BOT_TOKEN && managerTg) {
          const cleanUsername = managerTg.replace('@', '').trim();
          // Notify admin about manager invitation
          if (ADMIN_CHAT_ID) {
            await notifyAdmin(TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID,
              `👨‍💼 <b>Менеджер магазину "${app.shop_name}":</b> @${cleanUsername}\n\nПотрібно надіслати йому запрошення в MiniApp для керування замовленнями.`
            );
          }
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            supplier_id: newSupplier.id,
            message: 'Постачальника схвалено'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      } else if (action === 'reject') {
        // Get application for notification
        const { data: app } = await supabase
          .from('supplier_applications')
          .select('*')
          .eq('id', application_id)
          .single();

        // Update application status
        await supabase
          .from('supplier_applications')
          .update({
            status: 'rejected',
            rejection_reason: rejection_reason,
            reviewed_by: session.profile.id,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', application_id);

        // Notify supplier via Telegram if possible
        if (TELEGRAM_BOT_TOKEN && app?.telegram_id) {
          await notifyAdmin(TELEGRAM_BOT_TOKEN, app.telegram_id.toString(), 
            `❌ На жаль, вашу заявку на магазин "${app.shop_name}" відхилено.\n\nПричина: ${rejection_reason || 'Не вказано'}\n\nЗв'яжіться з підтримкою для уточнень.`
          );
        }

        return new Response(
          JSON.stringify({ success: true, message: 'Заявку відхилено' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Action: list - Get pending applications (admin only)
    if (action === 'list') {
      if (!session_token) {
        throw new Error('Authentication required');
      }
      
      const session = await validateSession(supabase, session_token);
      if (!session) {
        return new Response(
          JSON.stringify({ error: 'Invalid session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Check admin role from secure user_roles table
      const { data: adminRole } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.profile.id)
        .eq('role', 'admin')
        .single();
      
      if (!adminRole) {
        return new Response(
          JSON.stringify({ error: 'Admin access required' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: applications } = await supabase
        .from('supplier_applications')
        .select('*')
        .order('created_at', { ascending: false });

      return new Response(
        JSON.stringify({ success: true, applications }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Process supplier application error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});