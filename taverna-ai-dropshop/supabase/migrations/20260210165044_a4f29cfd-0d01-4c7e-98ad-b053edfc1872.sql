
-- Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

-- Allow users to read their own profile (full access)
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
USING (
  id = auth.uid()
  OR has_role(auth.uid(), 'admin')
  OR has_role(auth.uid(), 'moderator')
);

-- Create a public-safe view with only non-sensitive fields
CREATE OR REPLACE VIEW public.profiles_safe AS
SELECT 
  id,
  first_name,
  last_name,
  avatar_url,
  user_type,
  referral_code
FROM public.profiles
WHERE is_active = true;

GRANT SELECT ON public.profiles_safe TO anon, authenticated;
