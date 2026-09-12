CREATE TABLE public.wallet_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  wallet_invoice_id text,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'UAH',
  status text NOT NULL DEFAULT 'active',
  pay_link text,
  direct_pay_link text,
  mode text NOT NULL DEFAULT 'sandbox',
  paid_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX wallet_invoices_wallet_invoice_id_key ON public.wallet_invoices (wallet_invoice_id) WHERE wallet_invoice_id IS NOT NULL;
CREATE INDEX wallet_invoices_order_id_idx ON public.wallet_invoices (order_id);

GRANT SELECT ON public.wallet_invoices TO authenticated;
GRANT ALL ON public.wallet_invoices TO service_role;

ALTER TABLE public.wallet_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages wallet invoices"
ON public.wallet_invoices FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE TRIGGER update_wallet_invoices_updated_at
BEFORE UPDATE ON public.wallet_invoices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.payout_methods
  ADD COLUMN IF NOT EXISTS wallet_address text,
  ADD COLUMN IF NOT EXISTS wallet_currency text DEFAULT 'USDT';