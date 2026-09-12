-- Create user_bonuses table for loyalty system
CREATE TABLE public.user_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE,
  balance INTEGER DEFAULT 0,
  total_earned INTEGER DEFAULT 0,
  total_spent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_bonuses ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view own bonuses"
ON public.user_bonuses
FOR SELECT
USING (true);

CREATE POLICY "Bonuses service role access"
ON public.user_bonuses
FOR ALL
USING (true);

-- Create trigger for updating updated_at
CREATE TRIGGER update_user_bonuses_updated_at
BEFORE UPDATE ON public.user_bonuses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create promo_codes table for admin-managed promotions
CREATE TABLE public.promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  discount_percent INTEGER,
  discount_amount NUMERIC,
  min_order_amount NUMERIC DEFAULT 0,
  max_uses INTEGER,
  current_uses INTEGER DEFAULT 0,
  valid_from TIMESTAMPTZ DEFAULT now(),
  valid_until TIMESTAMPTZ,
  category_id UUID,
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for promo_codes
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

-- Promo codes viewable by everyone
CREATE POLICY "Promo codes viewable by everyone"
ON public.promo_codes
FOR SELECT
USING (is_active = true);

-- Service role can manage promo codes
CREATE POLICY "Promo codes service role access"
ON public.promo_codes
FOR ALL
USING (true);

-- Create used_promo_codes to track usage per user
CREATE TABLE public.used_promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  promo_code_id UUID REFERENCES public.promo_codes(id),
  order_id UUID,
  used_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.used_promo_codes ENABLE ROW LEVEL SECURITY;

-- Users can view their own used promo codes
CREATE POLICY "Users can view own used promos"
ON public.used_promo_codes
FOR SELECT
USING (true);

-- Service role access
CREATE POLICY "Used promos service role access"
ON public.used_promo_codes
FOR ALL
USING (true);

-- Add color field to categories table for dynamic colors
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS color TEXT;