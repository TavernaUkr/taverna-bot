-- Create a permissive SELECT policy for profiles that anyone can view
-- This allows showing supplier/user avatars publicly
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

CREATE POLICY "Public profiles are viewable by everyone" 
ON public.profiles FOR SELECT 
USING (true);