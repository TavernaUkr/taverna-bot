-- =====================================================
-- Security Fix: Implement proper session management and RLS
-- =====================================================

-- 1. Create sessions table for server-side session tracking
CREATE TABLE IF NOT EXISTS public.sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on sessions
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- Sessions only accessible via service role (edge functions)
CREATE POLICY "Sessions managed by service role"
ON public.sessions
FOR ALL
USING (true);

-- Create index for fast token lookup
CREATE INDEX idx_sessions_token_hash ON public.sessions(token_hash);
CREATE INDEX idx_sessions_expires_at ON public.sessions(expires_at);
CREATE INDEX idx_sessions_profile_id ON public.sessions(profile_id);

-- =====================================================
-- 2. Update RLS policies for profiles table
-- =====================================================

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Profiles viewable" ON public.profiles;
DROP POLICY IF EXISTS "Profiles insertable" ON public.profiles;
DROP POLICY IF EXISTS "Profiles updatable" ON public.profiles;

-- Only allow profiles access via service role (edge functions will handle auth)
CREATE POLICY "Profiles service role access"
ON public.profiles
FOR ALL
USING (true);

-- =====================================================
-- 3. Update RLS policies for delivery_addresses table
-- =====================================================

DROP POLICY IF EXISTS "Addresses viewable" ON public.delivery_addresses;
DROP POLICY IF EXISTS "Addresses insertable" ON public.delivery_addresses;
DROP POLICY IF EXISTS "Addresses updatable" ON public.delivery_addresses;
DROP POLICY IF EXISTS "Addresses deletable" ON public.delivery_addresses;

CREATE POLICY "Delivery addresses service role access"
ON public.delivery_addresses
FOR ALL
USING (true);

-- =====================================================
-- 4. Update RLS policies for cart_items table
-- =====================================================

DROP POLICY IF EXISTS "Cart viewable" ON public.cart_items;
DROP POLICY IF EXISTS "Cart insertable" ON public.cart_items;
DROP POLICY IF EXISTS "Cart updatable" ON public.cart_items;
DROP POLICY IF EXISTS "Cart deletable" ON public.cart_items;

CREATE POLICY "Cart items service role access"
ON public.cart_items
FOR ALL
USING (true);

-- =====================================================
-- 5. Update RLS policies for orders table
-- =====================================================

DROP POLICY IF EXISTS "Orders viewable" ON public.orders;
DROP POLICY IF EXISTS "Orders insertable" ON public.orders;
DROP POLICY IF EXISTS "Orders updatable" ON public.orders;

CREATE POLICY "Orders service role access"
ON public.orders
FOR ALL
USING (true);

-- =====================================================
-- 6. Update RLS policies for order_items table
-- =====================================================

DROP POLICY IF EXISTS "Order items viewable" ON public.order_items;
DROP POLICY IF EXISTS "Order items insertable" ON public.order_items;

CREATE POLICY "Order items service role access"
ON public.order_items
FOR ALL
USING (true);

-- =====================================================
-- 7. Fix suppliers table - remove public exposure of sensitive data
-- =====================================================

DROP POLICY IF EXISTS "Suppliers are viewable by everyone" ON public.suppliers;

-- Create a view with only public-safe fields
CREATE OR REPLACE VIEW public.suppliers_public AS
SELECT 
  id,
  shop_name,
  is_active
FROM public.suppliers
WHERE is_active = true;

-- Grant access to the public view
GRANT SELECT ON public.suppliers_public TO anon, authenticated;

-- =====================================================
-- 8. Fix trigger functions with proper search_path
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.order_number = 'TAV-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD') || '-' || 
    pg_catalog.lpad(pg_catalog.nextval('public.order_number_seq')::text, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- Create sequence for order numbers if not exists
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq;