-- Таблиця для просування постів та реклами
CREATE TABLE public.promotions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  promotion_type TEXT NOT NULL CHECK (promotion_type IN ('post', 'ad', 'auto')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  
  -- Platforms for advertising
  platforms TEXT[] DEFAULT '{}',
  
  -- Budget and costs (null for auto-promotions)
  budget NUMERIC DEFAULT 0,
  spent NUMERIC DEFAULT 0,
  
  -- Duration
  start_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
  end_date TIMESTAMP WITH TIME ZONE,
  
  -- Stats
  views INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  orders INTEGER DEFAULT 0,
  
  -- Auto-promotion queue position
  queue_position INTEGER,
  
  -- AI-generated content
  ai_generated_text TEXT,
  
  -- Telegram post details
  telegram_message_id BIGINT,
  telegram_channel_id TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Таблиця для черги авто-реклами
CREATE TABLE public.auto_promotion_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  last_promoted_at TIMESTAMP WITH TIME ZONE,
  total_promotions INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Таблиця для історії рекламних платформ
CREATE TABLE public.promotion_platforms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT,
  is_active BOOLEAN DEFAULT true,
  cost_per_promotion NUMERIC DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Наповнення платформ
INSERT INTO public.promotion_platforms (name, icon, is_active, description) VALUES
  ('Telegram', '📱', true, 'Telegram канали та групи'),
  ('Instagram', '📸', true, 'Instagram пости та сторіс'),
  ('Facebook', '👤', true, 'Facebook сторінки та групи'),
  ('OLX', '🏷️', true, 'OLX оголошення'),
  ('Prom', '🛒', true, 'Prom.ua маркетплейс'),
  ('TikTok', '🎵', true, 'TikTok відео'),
  ('YouTube', '▶️', true, 'YouTube Shorts та відео'),
  ('X (Twitter)', '✖️', true, 'X (Twitter) пости'),
  ('Viber', '💬', true, 'Viber канали'),
  ('WhatsApp', '💚', true, 'WhatsApp Business');

-- Enable RLS
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_promotion_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_platforms ENABLE ROW LEVEL SECURITY;

-- Policies for promotions
CREATE POLICY "Promotions viewable by everyone" 
ON public.promotions 
FOR SELECT 
USING (true);

CREATE POLICY "Promotions service role access" 
ON public.promotions 
FOR ALL 
USING (true);

-- Policies for auto_promotion_queue
CREATE POLICY "Queue viewable by everyone" 
ON public.auto_promotion_queue 
FOR SELECT 
USING (true);

CREATE POLICY "Queue service role access" 
ON public.auto_promotion_queue 
FOR ALL 
USING (true);

-- Policies for promotion_platforms
CREATE POLICY "Platforms viewable by everyone" 
ON public.promotion_platforms 
FOR SELECT 
USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_promotions_updated_at
BEFORE UPDATE ON public.promotions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for promotions
ALTER PUBLICATION supabase_realtime ADD TABLE public.promotions;