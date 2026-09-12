CREATE TABLE public.order_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  refund_method_id uuid REFERENCES public.refund_methods(id) ON DELETE SET NULL,
  refund_target text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  amount numeric NOT NULL DEFAULT 0,
  bonus_amount numeric NOT NULL DEFAULT 0,
  reason text NOT NULL,
  comment text,
  status text NOT NULL DEFAULT 'requested',
  rejection_reason text,
  transaction_id text,
  processed_by uuid,
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.order_refunds TO authenticated;
GRANT ALL ON public.order_refunds TO service_role;

ALTER TABLE public.order_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their refunds"
ON public.order_refunds FOR SELECT TO authenticated
USING (profile_id = auth.uid());

CREATE POLICY "Staff can view all refunds"
ON public.order_refunds FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));

CREATE INDEX idx_order_refunds_order ON public.order_refunds(order_id);
CREATE INDEX idx_order_refunds_profile ON public.order_refunds(profile_id);
CREATE INDEX idx_order_refunds_status ON public.order_refunds(status);

CREATE TRIGGER update_order_refunds_updated_at
BEFORE UPDATE ON public.order_refunds
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();