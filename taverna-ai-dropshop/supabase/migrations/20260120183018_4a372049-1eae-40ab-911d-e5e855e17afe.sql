-- Create reports table for product complaints
CREATE TABLE public.reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  reporter_telegram_id TEXT,
  reporter_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('counterfeit', 'wrong_category', 'offensive', 'misleading', 'other')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  admin_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Anyone can create a report (including anonymous users for telegram webapp)
CREATE POLICY "Anyone can create reports"
ON public.reports
FOR INSERT
WITH CHECK (true);

-- Users can view their own reports
CREATE POLICY "Users can view their own reports"
ON public.reports
FOR SELECT
USING (
  reporter_profile_id = auth.uid() OR
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'moderator')
);

-- Only admins/moderators can update reports
CREATE POLICY "Admins can update reports"
ON public.reports
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'moderator')
);

-- Create timestamp trigger
CREATE TRIGGER update_reports_updated_at
BEFORE UPDATE ON public.reports
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();