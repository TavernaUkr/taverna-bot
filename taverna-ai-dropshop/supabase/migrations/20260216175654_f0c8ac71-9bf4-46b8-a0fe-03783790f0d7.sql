
-- Add manager fields to suppliers
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS manager_telegram text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS allow_bot_chat boolean DEFAULT true;

-- Create storage bucket for shop assets (logos, covers, photos)
INSERT INTO storage.buckets (id, name, public) VALUES ('shop-assets', 'shop-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to view shop assets
CREATE POLICY "Shop assets are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'shop-assets');

-- Allow authenticated users to upload to shop-assets
CREATE POLICY "Authenticated users can upload shop assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'shop-assets');

-- Allow authenticated users to update their shop assets
CREATE POLICY "Authenticated users can update shop assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'shop-assets');

-- Allow authenticated users to delete their shop assets
CREATE POLICY "Authenticated users can delete shop assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'shop-assets');
