
-- Create user_bans table for banning users
CREATE TABLE public.user_bans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL,
  banned_by UUID,
  reason TEXT NOT NULL,
  banned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_bans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bans service role access" ON public.user_bans FOR ALL USING (true);

CREATE POLICY "Admins can view bans" ON public.user_bans FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'moderator'::app_role));

CREATE INDEX idx_user_bans_profile ON public.user_bans(profile_id);
CREATE INDEX idx_user_bans_active ON public.user_bans(is_active, expires_at);
