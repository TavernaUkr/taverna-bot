
-- Drop the misleading policy that says "admins" but allows everyone
DROP POLICY IF EXISTS "Supplier applications viewable by admins" ON public.supplier_applications;

-- Block all client reads (service role handles all operations via edge functions)
CREATE POLICY "Applications blocked for clients"
ON public.supplier_applications
FOR SELECT
USING (false);
