
-- Add views_count and is_boosted fields to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS views_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_boosted boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS video_url text;

-- Create index for trending sorting
CREATE INDEX IF NOT EXISTS idx_products_views ON public.products(views_count DESC);
CREATE INDEX IF NOT EXISTS idx_products_boosted ON public.products(is_boosted) WHERE is_boosted = true;
