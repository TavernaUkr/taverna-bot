-- Payments / Payouts panel schema extensions

-- order_splits: payout lifecycle
ALTER TABLE public.order_splits
  ADD COLUMN IF NOT EXISTS payout_stage text NOT NULL DEFAULT 'created',
  ADD COLUMN IF NOT EXISTS payout_type text,
  ADD COLUMN IF NOT EXISTS eligible_payout_at timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS receipt_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_returnable boolean;

-- products: returnability
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_returnable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS return_window_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS returnability_source text NOT NULL DEFAULT 'default';

-- orders: delivery confirmation
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracking_status text;

-- Backfill payout_stage from existing split_status
UPDATE public.order_splits
SET payout_stage = CASE
  WHEN split_status = 'paid' THEN 'paid'
  WHEN split_status IN ('payout_scheduled') THEN 'processing'
  ELSE 'created'
END
WHERE payout_stage = 'created';