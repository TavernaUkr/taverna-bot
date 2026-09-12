-- Add columns for storing last used Nova Poshta delivery address
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS last_city TEXT,
ADD COLUMN IF NOT EXISTS last_city_ref TEXT,
ADD COLUMN IF NOT EXISTS last_warehouse TEXT,
ADD COLUMN IF NOT EXISTS last_warehouse_ref TEXT;