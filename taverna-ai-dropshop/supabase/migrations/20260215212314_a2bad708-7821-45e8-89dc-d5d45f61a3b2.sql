
-- Add shop management fields to suppliers table
ALTER TABLE public.suppliers 
ADD COLUMN IF NOT EXISTS cover_image_url text,
ADD COLUMN IF NOT EXISTS shop_photos text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS logo_url text,
ADD COLUMN IF NOT EXISTS website_url text,
ADD COLUMN IF NOT EXISTS return_policy text,
ADD COLUMN IF NOT EXISTS exchange_policy text,
ADD COLUMN IF NOT EXISTS shipping_schedule text,
ADD COLUMN IF NOT EXISTS shipping_days text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS return_contact_info text;
