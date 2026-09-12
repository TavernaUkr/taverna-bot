
-- Add shop_manager to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'shop_manager';

-- Add telegram_forward_enabled to suppliers
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS telegram_forward_enabled boolean DEFAULT false;

-- Add supplier_id to link shop_manager to a specific supplier
-- We need a table to link shop managers to suppliers since one user can manage multiple shops
CREATE TABLE IF NOT EXISTS public.shop_manager_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  assigned_at timestamp with time zone NOT NULL DEFAULT now(),
  assigned_by uuid,
  UNIQUE(profile_id, supplier_id)
);

ALTER TABLE public.shop_manager_links ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Shop manager links service role access"
  ON public.shop_manager_links FOR ALL
  USING (true);

-- Suppliers and shop managers can view their own links
CREATE POLICY "Users can view own manager links"
  ON public.shop_manager_links FOR SELECT
  USING (true);
