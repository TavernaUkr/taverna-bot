
-- Add manager_telegram to supplier_applications to store the manager info from registration
ALTER TABLE public.supplier_applications
ADD COLUMN IF NOT EXISTS manager_telegram text;
