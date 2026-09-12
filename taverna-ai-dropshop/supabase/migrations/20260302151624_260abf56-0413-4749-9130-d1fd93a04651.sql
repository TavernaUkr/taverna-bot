
-- Block 2: Add supplier_id to support_tickets for order-linked conversations
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS supplier_id uuid;

-- Block 4: Create ai_order_reports table for AI audit
CREATE TABLE IF NOT EXISTS public.ai_order_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  supplier_id uuid,
  report_type text NOT NULL DEFAULT 'order_summary',
  ai_summary text,
  sentiment_score numeric,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_order_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "AI reports service role access" ON public.ai_order_reports FOR ALL USING (true);
CREATE POLICY "AI reports viewable by admins" ON public.ai_order_reports FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'moderator'::app_role)
);
