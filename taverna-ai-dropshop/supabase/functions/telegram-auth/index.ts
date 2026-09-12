import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Generate a secure random token
function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// Hash the token for storage using HMAC-SHA256 with server-side secret (rainbow-table resistant)
async function hashToken(token: string): Promise<string> {
  const secret = Deno.env.get('SESSION_HMAC_SECRET') || '';
  const encoder = new TextEncoder();
  if (secret) {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(token));
    return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // fallback for environments without the secret configured
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
}

// Allowlist of profile fields the user is permitted to update directly
const PROFILE_UPDATABLE_FIELDS = new Set<string>([
  'first_name', 'last_name', 'phone', 'email', 'avatar_url',
  'last_city', 'last_city_ref', 'last_warehouse', 'last_warehouse_ref',
]);

function sanitizeProfileUpdates(updates: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates || {})) {
    if (PROFILE_UPDATABLE_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

// Determine if we should allow the "mock_dev_auth" bypass.
// Requires an explicit ALLOW_MOCK_AUTH secret to be set (never true in real deployments).
function mockAuthAllowed(): boolean {
  return Deno.env.get('ALLOW_MOCK_AUTH') === 'true';
}


// Telegram Mini App auth validation
async function validateTelegramAuth(initData: string, botToken: string): Promise<any> {
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  urlParams.delete('hash');
  
  // Sort parameters
  const params = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  
  // Create HMAC-SHA256 signature
  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const secretKeyData = await crypto.subtle.sign(
    'HMAC',
    secretKey,
    encoder.encode(botToken)
  );
  
  const dataKey = await crypto.subtle.importKey(
    'raw',
    secretKeyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    dataKey,
    encoder.encode(params)
  );
  
  const calculatedHash = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  if (calculatedHash !== hash) {
    throw new Error('Invalid Telegram auth data');
  }
  
  // Parse user data
  const userString = urlParams.get('user');
  if (!userString) {
    throw new Error('No user data in auth');
  }
  
  return JSON.parse(userString);
}

// Validate session token
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
  
  // Update last_used_at
  await supabase
    .from('sessions')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', session.id);
  
  // Fetch user roles from secure table
  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', session.profile.id);
  
  session.profile.roles = roles?.map((r: any) => r.role) || ['customer'];
  
  return session;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { init_data, action, session_token } = body;
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Handle session validation
    if (action === 'validate' && session_token) {
      const session = await validateSession(supabase, session_token);
      
      if (!session) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid or expired session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Fetch delivery addresses
      const { data: addresses } = await supabase
        .from('delivery_addresses')
        .select('*')
        .eq('profile_id', session.profile.id)
        .order('is_default', { ascending: false });
      
      return new Response(
        JSON.stringify({
          success: true,
          profile: session.profile,
          addresses: addresses || [],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Handle profile update
    if (action === 'update_profile' && session_token) {
      const session = await validateSession(supabase, session_token);
      if (!session) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const { updates } = body;
      const safeUpdates = sanitizeProfileUpdates(updates || {});
      const { data: updatedProfile, error } = await supabase
        .from('profiles')
        .update(safeUpdates)
        .eq('id', session.profile.id)
        .select()
        .single();

      
      if (error) throw error;
      
      return new Response(
        JSON.stringify({ success: true, profile: updatedProfile }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Handle add address
    if (action === 'add_address' && session_token) {
      const session = await validateSession(supabase, session_token);
      if (!session) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const { address } = body;
      const { data: newAddress, error } = await supabase
        .from('delivery_addresses')
        .insert({
          ...address,
          profile_id: session.profile.id,
        })
        .select()
        .single();
      
      if (error) throw error;
      
      return new Response(
        JSON.stringify({ success: true, address: newAddress }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Handle update address
    if (action === 'update_address' && session_token) {
      const session = await validateSession(supabase, session_token);
      if (!session) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const { address_id, updates } = body;
      
      // Verify address belongs to user
      const { data: existing } = await supabase
        .from('delivery_addresses')
        .select('id')
        .eq('id', address_id)
        .eq('profile_id', session.profile.id)
        .single();
      
      if (!existing) {
        return new Response(
          JSON.stringify({ error: 'Address not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const { data: updatedAddress, error } = await supabase
        .from('delivery_addresses')
        .update(updates)
        .eq('id', address_id)
        .select()
        .single();
      
      if (error) throw error;
      
      return new Response(
        JSON.stringify({ success: true, address: updatedAddress }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Handle delete address
    if (action === 'delete_address' && session_token) {
      const session = await validateSession(supabase, session_token);
      if (!session) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const { address_id } = body;
      
      const { error } = await supabase
        .from('delivery_addresses')
        .delete()
        .eq('id', address_id)
        .eq('profile_id', session.profile.id);
      
      if (error) throw error;
      
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Handle logout
    if (action === 'logout' && session_token) {
      const tokenHash = await hashToken(session_token);
      await supabase
        .from('sessions')
        .delete()
        .eq('token_hash', tokenHash);
      
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Handle get addresses
    if (action === 'get_addresses' && session_token) {
      const session = await validateSession(supabase, session_token);
      if (!session) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid or expired session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: addresses } = await supabase
        .from('delivery_addresses')
        .select('*')
        .eq('profile_id', session.profile.id)
        .order('is_default', { ascending: false });

      return new Response(
        JSON.stringify({ success: true, addresses: addresses || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ---------- CART CRUD (server-side, RLS-locked table) ----------
    if (action === 'cart_get' && session_token) {
      const session = await validateSession(supabase, session_token);
      if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const { data } = await supabase
        .from('cart_items')
        .select('*, product:products(id, name, price, images, sizes, colors, supplier_id, supplier:suppliers(id, shop_name))')
        .eq('profile_id', session.profile.id)
        .order('created_at', { ascending: false });
      return new Response(JSON.stringify({ success: true, items: data || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'cart_add' && session_token) {
      const session = await validateSession(supabase, session_token);
      if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const { product_id, size, color } = body;
      if (!product_id) throw new Error('product_id required');
      // Verify product exists
      const { data: prod } = await supabase.from('products').select('id').eq('id', product_id).maybeSingle();
      if (!prod) throw new Error('Product not found');
      const { data: existing } = await supabase
        .from('cart_items')
        .select('id, quantity')
        .eq('profile_id', session.profile.id)
        .eq('product_id', product_id)
        .eq('size', size || '')
        .eq('color', color || '')
        .maybeSingle();
      if (existing) {
        await supabase.from('cart_items').update({ quantity: existing.quantity + 1, updated_at: new Date().toISOString() }).eq('id', existing.id);
      } else {
        await supabase.from('cart_items').insert({ profile_id: session.profile.id, product_id, quantity: 1, size: size || null, color: color || null });
      }
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'cart_update' && session_token) {
      const session = await validateSession(supabase, session_token);
      if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const { cart_item_id, quantity } = body;
      const qty = Math.max(1, Math.floor(Number(quantity) || 1));
      const { error } = await supabase.from('cart_items').update({ quantity: qty, updated_at: new Date().toISOString() }).eq('id', cart_item_id).eq('profile_id', session.profile.id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'cart_remove' && session_token) {
      const session = await validateSession(supabase, session_token);
      if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const { cart_item_id } = body;
      const { error } = await supabase.from('cart_items').delete().eq('id', cart_item_id).eq('profile_id', session.profile.id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'cart_clear' && session_token) {
      const session = await validateSession(supabase, session_token);
      if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const { error } = await supabase.from('cart_items').delete().eq('profile_id', session.profile.id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    // Handle get orders
    if (action === 'get_orders' && session_token) {
      const session = await validateSession(supabase, session_token);
      if (!session) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select(`
          *,
          items:order_items(*),
          delivery_address:delivery_addresses(city, warehouse_number, street_address, building_number, recipient_name, phone)
        `)
        .eq('profile_id', session.profile.id)
        .order('created_at', { ascending: false });
      
      if (ordersError) throw ordersError;
      
      return new Response(
        JSON.stringify({ success: true, orders: orders || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Handle create order (authenticated)
    if (action === 'create_order' && session_token) {
      const session = await validateSession(supabase, session_token);
      if (!session) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const { order, guest_info } = body;
      const orderNumber = `TAV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      // Server-side price recalculation to prevent tampering
      const clientItems = Array.isArray(order?.items) ? order.items : [];
      if (clientItems.length === 0) throw new Error('Order has no items');
      const productIds = clientItems.map((i: any) => i.product_id).filter(Boolean);
      const { data: catalog } = await supabase.from('products').select('id, name, price, images').in('id', productIds);
      const priceMap = new Map<string, { price: number; name: string; image: string | null }>(
        (catalog || []).map((p: any) => [p.id, { price: Number(p.price), name: p.name, image: p.images?.[0] || null }])
      );

      let recomputedSubtotal = 0;
      const orderItems = clientItems.map((item: any) => {
        const p = priceMap.get(item.product_id);
        if (!p) throw new Error(`Unknown product ${item.product_id}`);
        const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
        const lineTotal = p.price * qty;
        recomputedSubtotal += lineTotal;
        return {
          product_id: item.product_id,
          product_name: p.name,
          product_image: p.image,
          price: p.price,
          quantity: qty,
          size: item.size,
          color: item.color,
          total: lineTotal,
        };
      });
      const deliveryCost = Math.max(0, Number(order.delivery_cost) || 0);
      const recomputedTotal = recomputedSubtotal + deliveryCost;

      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert({
          profile_id: session.profile.id,
          delivery_address_id: order.delivery_address_id,
          order_number: orderNumber,
          payment_method: order.payment_method,
          payment_status: 'pending',
          delivery_service: 'nova_poshta',
          delivery_cost: deliveryCost,
          subtotal: recomputedSubtotal,
          total: recomputedTotal,
          notes: order.notes,
          status: 'pending',
        })
        .select()
        .single();
      
      if (orderError) throw new Error('Failed to create order');
      
      await supabase.from('order_items').insert(orderItems.map((oi: any) => ({ ...oi, order_id: newOrder.id })));
      await supabase.from('cart_items').delete().eq('profile_id', session.profile.id);
      
      // Save last used city and warehouse to profile for future auto-fill
      if (guest_info?.city && guest_info?.city_ref) {
        await supabase
          .from('profiles')
          .update({
            last_city: guest_info.city,
            last_city_ref: guest_info.city_ref,
            last_warehouse: guest_info.warehouse_number || null,
            last_warehouse_ref: guest_info.warehouse_ref || null,
          })
          .eq('id', session.profile.id);
      }
      
      return new Response(
        JSON.stringify({ success: true, order: newOrder }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Handle guest order
    if (action === 'create_guest_order') {
      const { guest_info, order } = body;
      const orderNumber = `TAV-G-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      // Server-side price recalculation
      const clientItems = Array.isArray(order?.items) ? order.items : [];
      if (clientItems.length === 0) throw new Error('Order has no items');
      const productIds = clientItems.map((i: any) => i.product_id).filter(Boolean);
      const { data: catalog } = await supabase.from('products').select('id, name, price, images').in('id', productIds);
      const priceMap = new Map<string, { price: number; name: string; image: string | null }>(
        (catalog || []).map((p: any) => [p.id, { price: Number(p.price), name: p.name, image: p.images?.[0] || null }])
      );

      let recomputedSubtotal = 0;
      const orderItems = clientItems.map((item: any) => {
        const p = priceMap.get(item.product_id);
        if (!p) throw new Error(`Unknown product ${item.product_id}`);
        const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
        const lineTotal = p.price * qty;
        recomputedSubtotal += lineTotal;
        return {
          product_id: item.product_id,
          product_name: p.name,
          product_image: p.image,
          price: p.price,
          quantity: qty,
          size: item.size,
          color: item.color,
          total: lineTotal,
        };
      });
      const deliveryCost = Math.max(0, Number(order.delivery_cost) || 0);
      const recomputedTotal = recomputedSubtotal + deliveryCost;

      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert({
          order_number: orderNumber,
          payment_method: order.payment_method,
          payment_status: 'pending',
          delivery_service: guest_info.delivery_service || 'nova_poshta',
          delivery_cost: deliveryCost,
          subtotal: recomputedSubtotal,
          total: recomputedTotal,
          notes: `ГІСТЬ: ${guest_info.recipient_name}, ${guest_info.phone}, ${guest_info.city}${guest_info.warehouse_number ? `, Відділення №${guest_info.warehouse_number}` : ''}${guest_info.street_address ? `, ${guest_info.street_address} ${guest_info.building_number}` : ''}${order.notes ? ` | ${order.notes}` : ''}`,
          status: 'pending',
        })
        .select()
        .single();
      
      if (orderError) throw new Error('Failed to create order');
      
      await supabase.from('order_items').insert(orderItems.map((oi: any) => ({ ...oi, order_id: newOrder.id })));

      return new Response(
        JSON.stringify({ success: true, order: newOrder }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    
    // Handle create review
    if (action === 'create_review' && session_token) {
      const session = await validateSession(supabase, session_token);
      if (!session) {
        return new Response(
          JSON.stringify({ error: 'Authentication required' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { product_id, rating, title, content } = body;

      if (!product_id || !rating || rating < 1 || rating > 5) {
        return new Response(
          JSON.stringify({ error: 'Invalid review data' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check duplicate
      const { data: existing } = await supabase
        .from('reviews')
        .select('id')
        .eq('product_id', product_id)
        .eq('profile_id', session.profile.id)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ error: 'You already reviewed this product' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check verified purchase
      const { data: purchase } = await supabase
        .from('order_items')
        .select('id, order:orders!inner(profile_id)')
        .eq('product_id', product_id)
        .eq('orders.profile_id', session.profile.id)
        .limit(1)
        .maybeSingle();

      const { data: review, error: reviewError } = await supabase
        .from('reviews')
        .insert({
          product_id,
          profile_id: session.profile.id,
          author_name: session.profile.first_name || session.profile.telegram_username || 'User',
          rating: Math.round(rating),
          title: typeof title === 'string' ? title.slice(0, 200) : null,
          content: typeof content === 'string' ? content.slice(0, 2000) : null,
          is_verified_purchase: !!purchase,
        })
        .select()
        .single();

      if (reviewError) throw reviewError;

      return new Response(
        JSON.stringify({ success: true, review }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle login/authentication
    let telegramUser: any;
    const allowMock = mockAuthAllowed();

    // Only allow mock auth when ALLOW_MOCK_AUTH secret is explicitly set
    if (init_data === 'mock_dev_auth') {
      if (!allowMock) {
        throw new Error('Mock authentication is disabled');
      }
      // Mock user for development only
      telegramUser = {
        id: 123456789,
        first_name: 'Test',
        last_name: 'User',
        username: 'testuser',
      };
      console.log('Using mock auth for development');
    } else if (init_data) {
      const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
      if (!botToken) {
        if (!allowMock) {
          throw new Error('TELEGRAM_BOT_TOKEN not configured');
        }

        // In development, try to parse user data directly with warning
        try {
          const urlParams = new URLSearchParams(init_data);
          const userString = urlParams.get('user');
          if (userString) {
            telegramUser = JSON.parse(userString);
            console.warn('DEV MODE: Using unvalidated Telegram data');
          } else {
            throw new Error('No user data found');
          }
        } catch {
          throw new Error('TELEGRAM_BOT_TOKEN not configured');
        }
      } else {
        telegramUser = await validateTelegramAuth(init_data, botToken);
      }
    } else {
      throw new Error('No auth data provided');
    }
    
    console.log('Telegram user:', telegramUser.id);
    
    // Check if profile exists
    const { data: existingProfile, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('telegram_id', telegramUser.id)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Profile fetch error:', fetchError);
    }
    
    let profile = existingProfile;
    
    if (!profile) {
      // Create new profile
      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          telegram_id: telegramUser.id,
          telegram_username: telegramUser.username,
          first_name: telegramUser.first_name,
          last_name: telegramUser.last_name,
          avatar_url: telegramUser.photo_url,
          user_type: 'customer',
        })
        .select()
        .single();
      
      if (insertError) {
        console.error('Profile insert error:', insertError);
        throw insertError;
      }
      
      profile = newProfile;
      
      // Create default customer role for new user
      await supabase
        .from('user_roles')
        .insert({
          user_id: profile.id,
          role: 'customer',
        });
    } else {
      // Update profile with latest Telegram data
      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update({
          telegram_username: telegramUser.username,
          first_name: telegramUser.first_name,
          last_name: telegramUser.last_name,
          avatar_url: telegramUser.photo_url,
        })
        .eq('id', profile.id)
        .select()
        .single();
      
      if (!updateError && updatedProfile) {
        profile = updatedProfile;
      }
    }
    
    // Auto-link as shop_manager if telegram_username matches any supplier's manager_telegram
    if (telegramUser.username) {
      const cleanUsername = telegramUser.username.toLowerCase();
      const { data: matchingSuppliers } = await supabase
        .from('suppliers')
        .select('id')
        .or(`manager_telegram.ilike.@${cleanUsername},manager_telegram.ilike.${cleanUsername}`)
        .eq('is_active', true);
      
      if (matchingSuppliers && matchingSuppliers.length > 0) {
        // Add shop_manager role
        await supabase
          .from('user_roles')
          .upsert({ user_id: profile.id, role: 'shop_manager' }, { onConflict: 'user_id,role' });
        
        // Create shop_manager_links for each matching supplier
        for (const supplier of matchingSuppliers) {
          const { data: existingLink } = await supabase
            .from('shop_manager_links')
            .select('id')
            .eq('profile_id', profile.id)
            .eq('supplier_id', supplier.id)
            .maybeSingle();
          
          if (!existingLink) {
            await supabase
              .from('shop_manager_links')
              .insert({
                profile_id: profile.id,
                supplier_id: supplier.id,
              });
          }
        }
        
        console.log(`Auto-linked @${cleanUsername} as shop_manager for ${matchingSuppliers.length} supplier(s)`);
      }
    }

    // Fetch user roles from secure table
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', profile.id);
    
    profile.roles = userRoles?.map((r: any) => r.role) || ['customer'];
    
    // Create session token
    const sessionToken = generateSessionToken();
    const tokenHash = await hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    // Keep active sessions. Preview/HMR can start authentication more than once in
    // parallel; deleting all profile sessions here lets the last request invalidate
    // the token returned by the first request before the client can use it.
    // Only remove expired rows so separate tabs/devices and concurrent auth calls
    // cannot revoke one another. Explicit logout still revokes its exact token.
    await supabase
      .from('sessions')
      .delete()
      .eq('profile_id', profile.id)
      .lte('expires_at', new Date().toISOString());
    
    // Insert new session
    const { error: sessionError } = await supabase
      .from('sessions')
      .insert({
        profile_id: profile.id,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
      });
    
    if (sessionError) {
      console.error('Session creation error:', sessionError);
      throw new Error('Failed to create session');
    }
    
    // Fetch delivery addresses
    const { data: addresses } = await supabase
      .from('delivery_addresses')
      .select('*')
      .eq('profile_id', profile.id)
      .order('is_default', { ascending: false });
    
    // Fetch cart items
    const { data: cartItems } = await supabase
      .from('cart_items')
      .select(`
        *,
        product:products(*)
      `)
      .eq('profile_id', profile.id);
    
    return new Response(
      JSON.stringify({
        success: true,
        session_token: sessionToken,
        profile,
        addresses: addresses || [],
        cart: cartItems || [],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error: unknown) {
    console.error('Telegram auth error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
