
-- App/Store ratings table
CREATE TABLE public.app_ratings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID,
  rating INTEGER NOT NULL DEFAULT 5,
  comment TEXT,
  rating_type TEXT NOT NULL DEFAULT 'app',
  target_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.app_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert ratings" ON public.app_ratings
FOR INSERT WITH CHECK (true);

CREATE POLICY "Ratings viewable by admins" ON public.app_ratings
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'moderator'::app_role)
);

CREATE POLICY "Ratings service role access" ON public.app_ratings
FOR ALL USING (true);
