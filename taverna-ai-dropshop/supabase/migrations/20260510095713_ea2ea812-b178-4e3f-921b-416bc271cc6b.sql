
-- ============================================================
-- Phase 1: Critical RLS hardening
-- ============================================================

-- 1. user_roles: CRITICAL privilege escalation fix
-- Previously: "Service role can manage roles" FOR ALL USING(true) allowed
-- ANY anonymous client to INSERT admin role for any user.
-- Service role bypasses RLS automatically — no explicit policy needed.
DROP POLICY IF EXISTS "Service role can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
-- All role mutations now go through manage-user-roles edge function.
-- All role reads now go through telegram-auth (validateSession populates roles).

-- 2. profiles: drop the FOR ALL permissive policy.
-- "Profiles read blocked for clients" (SELECT USING false) stays.
-- Service role bypass continues to work for telegram-auth & admin functions.
DROP POLICY IF EXISTS "Profiles service role access" ON public.profiles;

-- 3. Expand suppliers_public safe view (non-breaking, additive)
-- Excludes ALL sensitive fields: contact_email, contact_phone, tax_code,
-- payment_iban, payment_card_holder, payment_bank_name, manager_telegram,
-- company_name, legal_type, return_contact_info, xml_url, telegram_id
DROP VIEW IF EXISTS public.suppliers_public;
CREATE VIEW public.suppliers_public AS
  SELECT id, shop_name, logo_url, cover_image_url, description,
         shop_photos, return_policy, exchange_policy, shipping_schedule,
         shipping_days, website_url, telegram_channel_url, is_active,
         markup_percentage, created_at, updated_at
  FROM public.suppliers
  WHERE is_active = true;

GRANT SELECT ON public.suppliers_public TO anon, authenticated;
