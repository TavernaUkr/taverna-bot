
-- Drop the permissive INSERT policy on reviews
DROP POLICY IF EXISTS "Users can create reviews" ON public.reviews;

-- Add service role write access for reviews (edge function uses service role)
CREATE POLICY "Reviews service role write access"
ON public.reviews
FOR INSERT
WITH CHECK (false);

-- Keep existing SELECT, UPDATE, DELETE policies as-is
