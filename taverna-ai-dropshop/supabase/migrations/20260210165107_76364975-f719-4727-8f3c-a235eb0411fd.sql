
-- Drop the policy we just created (it won't work with custom auth since auth.uid() is always NULL)
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

-- Block all direct SELECT on profiles table for anon/authenticated (service role still bypasses RLS)
CREATE POLICY "Profiles read blocked for clients"
ON public.profiles FOR SELECT
USING (false);

-- The profiles_safe view and GRANT were already created in previous migration
-- Add last_name and referral_code to the safe view for referral functionality
CREATE OR REPLACE VIEW public.profiles_safe AS
SELECT 
  id,
  first_name,
  last_name,
  avatar_url,
  user_type,
  referral_code,
  referred_by
FROM public.profiles
WHERE is_active = true;

GRANT SELECT ON public.profiles_safe TO anon, authenticated;
