
-- Add payment IBAN to suppliers table
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS payment_iban text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS payment_card_holder text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS payment_bank_name text;

-- Create order_splits table for tracking financial splits per order
CREATE TABLE public.order_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  supplier_id uuid REFERENCES public.suppliers(id) NOT NULL,
  product_total numeric NOT NULL DEFAULT 0,
  supplier_amount numeric NOT NULL DEFAULT 0,
  platform_commission numeric NOT NULL DEFAULT 0,
  markup_percentage numeric NOT NULL DEFAULT 33,
  payment_method text NOT NULL DEFAULT 'prepaid',
  split_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Order splits service role access" ON public.order_splits FOR ALL USING (true);
CREATE POLICY "Suppliers can view own splits" ON public.order_splits FOR SELECT USING (true);

-- Create supplier_payouts table for tracking actual payouts
CREATE TABLE public.supplier_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.suppliers(id) NOT NULL,
  order_split_id uuid REFERENCES public.order_splits(id),
  amount numeric NOT NULL DEFAULT 0,
  payout_method text NOT NULL DEFAULT 'monobank_api',
  payout_status text NOT NULL DEFAULT 'pending',
  iban text,
  transaction_id text,
  error_message text,
  scheduled_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Payouts service role access" ON public.supplier_payouts FOR ALL USING (true);
CREATE POLICY "Suppliers can view own payouts" ON public.supplier_payouts FOR SELECT USING (true);

-- Add supplier_payment_deadlines for COD margin tracking
CREATE TABLE public.supplier_payment_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.suppliers(id) NOT NULL,
  order_id uuid REFERENCES public.orders(id) NOT NULL,
  amount_due numeric NOT NULL DEFAULT 0,
  deadline_at timestamptz NOT NULL,
  is_paid boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  auto_ban_triggered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_payment_deadlines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deadlines service role access" ON public.supplier_payment_deadlines FOR ALL USING (true);
CREATE POLICY "Suppliers can view own deadlines" ON public.supplier_payment_deadlines FOR SELECT USING (true);
