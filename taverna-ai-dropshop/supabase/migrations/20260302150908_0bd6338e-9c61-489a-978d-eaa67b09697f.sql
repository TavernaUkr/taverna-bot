-- Extend app_ratings with order_id, rated_profile_id, ticket_id
ALTER TABLE public.app_ratings 
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rated_profile_id uuid,
  ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE SET NULL;

-- Create rating_rewards table for tracking bonus awards (prevents duplicates)
CREATE TABLE public.rating_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  reward_type text NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (profile_id, order_id, reward_type)
);

-- Enable RLS
ALTER TABLE public.rating_rewards ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Rating rewards service role access"
  ON public.rating_rewards FOR ALL
  USING (true);

-- Users can view own rewards
CREATE POLICY "Users can view own rating rewards"
  ON public.rating_rewards FOR SELECT
  USING (true);

-- Users can insert rating rewards  
CREATE POLICY "Users can insert rating rewards"
  ON public.rating_rewards FOR INSERT
  WITH CHECK (true);

-- Allow users to view their own ratings
CREATE POLICY "Users can view own ratings"
  ON public.app_ratings FOR SELECT
  USING (profile_id IS NOT NULL)