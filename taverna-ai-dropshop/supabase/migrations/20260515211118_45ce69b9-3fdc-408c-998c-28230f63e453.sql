ALTER TABLE public.promotions
ADD COLUMN IF NOT EXISTS media_images text[] DEFAULT '{}'::text[],
ADD COLUMN IF NOT EXISTS media_video text;