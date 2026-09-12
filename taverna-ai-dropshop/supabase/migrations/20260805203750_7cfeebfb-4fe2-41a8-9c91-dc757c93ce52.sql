CREATE TABLE public.refund_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  method_type text NOT NULL DEFAULT 'card',
  masked_value text NOT NULL,
  full_value text NOT NULL,
  holder text,
  bank_name text,
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.refund_methods TO authenticated;
GRANT ALL ON public.refund_methods TO service_role;

ALTER TABLE public.refund_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their refund methods"
ON public.refund_methods FOR ALL
TO authenticated
USING (profile_id = auth.uid())
WITH CHECK (profile_id = auth.uid());

CREATE INDEX idx_refund_methods_profile ON public.refund_methods(profile_id);

CREATE TRIGGER update_refund_methods_updated_at
BEFORE UPDATE ON public.refund_methods
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();