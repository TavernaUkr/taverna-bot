import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOVA_POSHTA_API = 'https://api.novaposhta.ua/v2.0/json/';

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
    const { action, params, session_token } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Public actions that don't require authentication
    const publicActions = ['trackPackage', 'searchCity', 'getWarehouses'];
    
    let userId = 'anonymous';
    
    // Validate session token for non-public actions
    if (!publicActions.includes(action)) {
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
      userId = session.profile?.id || 'unknown';
    } else if (session_token) {
      const session = await validateSession(supabase, session_token);
      if (session) {
        userId = session.profile?.id || 'unknown';
      }
    }
    
    console.log(`Nova Poshta request from user ${userId}: ${action}`);
    
    const apiKey = Deno.env.get('NOVA_POSHTA_API_KEY');
    
    if (!apiKey) {
      // Return mock data for development
      return new Response(
        JSON.stringify(getMockData(action, params)),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    let modelName: string;
    let calledMethod: string;
    let methodProperties: any = {};
    
    switch (action) {
      case 'searchCity':
        modelName = 'Address';
        calledMethod = 'searchSettlements';
        methodProperties = {
          CityName: params.query,
          Limit: params.limit || 20,
        };
        break;
        
      case 'getWarehouses':
        modelName = 'Address';
        calledMethod = 'getWarehouses';
        methodProperties = {
          CityRef: params.cityRef,
          TypeOfWarehouseRef: params.type,
          Limit: params.limit || 50,
        };
        break;
        
      case 'calculateDelivery':
        modelName = 'InternetDocument';
        calledMethod = 'getDocumentPrice';
        methodProperties = {
          CitySender: params.citySender || '8d5a980d-391c-11dd-90d9-001a92567626', // Kyiv
          CityRecipient: params.cityRecipient,
          Weight: params.weight || 1,
          ServiceType: params.serviceType || 'WarehouseWarehouse',
          Cost: params.cost,
          CargoType: 'Cargo',
          SeatsAmount: 1,
        };
        break;
        
      case 'trackPackage':
        modelName = 'TrackingDocument';
        calledMethod = 'getStatusDocuments';
        methodProperties = {
          Documents: [{ DocumentNumber: params.trackingNumber }],
        };
        break;
        
      default:
        throw new Error(`Unknown action: ${action}`);
    }
    
    const response = await fetch(NOVA_POSHTA_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        modelName,
        calledMethod,
        methodProperties,
      }),
    });
    
    const data = await response.json();
    
    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error: unknown) {
    console.error('Nova Poshta API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Mock data for development without API key
function getMockData(action: string, params: any) {
  switch (action) {
    case 'searchCity':
      return {
        success: true,
        data: [
          { 
            Ref: 'a9522a7e-eaf5-11e7-80c6-00155dfbfb00', 
            Description: 'Київ', 
            DescriptionRu: 'Киев',
            Present: 'м. Київ, Київська обл.',
            Warehouses: 500,
          },
          { 
            Ref: 'db5c88e0-391c-11dd-90d9-001a92567626', 
            Description: 'Харків', 
            DescriptionRu: 'Харьков',
            Present: 'м. Харків, Харківська обл.',
            Warehouses: 350,
          },
          { 
            Ref: 'db5c88f5-391c-11dd-90d9-001a92567626', 
            Description: 'Одеса', 
            DescriptionRu: 'Одесса',
            Present: 'м. Одеса, Одеська обл.',
            Warehouses: 280,
          },
          { 
            Ref: 'db5c88d7-391c-11dd-90d9-001a92567626', 
            Description: 'Дніпро', 
            DescriptionRu: 'Днепр',
            Present: 'м. Дніпро, Дніпропетровська обл.',
            Warehouses: 220,
          },
          { 
            Ref: 'db5c88f0-391c-11dd-90d9-001a92567626', 
            Description: 'Львів', 
            DescriptionRu: 'Львов',
            Present: 'м. Львів, Львівська обл.',
            Warehouses: 180,
          },
        ].filter(c => 
          c.Description.toLowerCase().includes((params?.query || '').toLowerCase()) ||
          c.DescriptionRu.toLowerCase().includes((params?.query || '').toLowerCase())
        ),
      };
      
    case 'getWarehouses':
      return {
        success: true,
        data: [
          { 
            Ref: 'warehouse-1', 
            Description: 'Відділення №1: вул. Хрещатик, 22', 
            Number: '1',
            TypeOfWarehouse: 'Branch',
            CityDescription: 'Київ',
          },
          { 
            Ref: 'warehouse-2', 
            Description: 'Відділення №2: вул. Велика Васильківська, 100', 
            Number: '2',
            TypeOfWarehouse: 'Branch',
            CityDescription: 'Київ',
          },
          { 
            Ref: 'postomat-1', 
            Description: 'Поштомат №101: ТЦ Ocean Plaza', 
            Number: '101',
            TypeOfWarehouse: 'Postomat',
            CityDescription: 'Київ',
          },
          { 
            Ref: 'postomat-2', 
            Description: 'Поштомат №102: ТРЦ Gulliver', 
            Number: '102',
            TypeOfWarehouse: 'Postomat',
            CityDescription: 'Київ',
          },
        ],
      };
      
    case 'calculateDelivery':
      return {
        success: true,
        data: [
          {
            Cost: 75,
            AssessedCost: params?.cost || 1000,
            CostRedelivery: 45,
            EstimatedDeliveryDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          },
        ],
      };
      
    case 'trackPackage':
      return {
        success: true,
        data: [
          {
            Number: params?.trackingNumber,
            Status: 'Відправлення отримано',
            StatusCode: '9',
            WarehouseSender: 'Відділення №1',
            WarehouseRecipient: 'Відділення №5',
            ScheduledDeliveryDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          },
        ],
      };
      
    default:
      return { success: false, errors: ['Unknown action'] };
  }
}
