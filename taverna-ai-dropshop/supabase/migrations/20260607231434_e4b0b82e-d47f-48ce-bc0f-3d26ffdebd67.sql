CREATE TABLE public.shop_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL UNIQUE REFERENCES public.suppliers(id) ON DELETE CASCADE,
  available numeric NOT NULL DEFAULT 0,
  pending numeric NOT NULL DEFAULT 0,
  lifetime_paid numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'UAH',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.shop_balances TO service_role;
ALTER TABLE public.shop_balances ENABLE ROW LEVEL SECURITY;
-- access only via edge functions (service role); no client policies

CREATE TABLE public.balance_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  order_split_id uuid REFERENCES public.order_splits(id) ON DELETE SET NULL,
  type text NOT NULL,
  amount numeric NOT NULL,
  balance_after numeric,
  status text NOT NULL DEFAULT 'settled',
  provider text NOT NULL DEFAULT 'internal',
  external_tx_id text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.balance_movements TO service_role;
ALTER TABLE public.balance_movements ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.payout_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'liqpay',
  type text NOT NULL DEFAULT 'card',
  masked_pan text,
  card_token text,
  iban text,
  holder text,
  is_default boolean NOT NULL DEFAULT true,
  auto_withdraw boolean NOT NULL DEFAULT false,
  auto_charge boolean NOT NULL DEFAULT false,
  min_withdraw numeric NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.payout_methods TO service_role;
ALTER TABLE public.payout_methods ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.order_splits ADD COLUMN IF NOT EXISTS balance_movement_id uuid REFERENCES public.balance_movements(id) ON DELETE SET NULL;

CREATE INDEX idx_balance_movements_supplier ON public.balance_movements(supplier_id);
CREATE INDEX idx_payout_methods_supplier ON public.payout_methods(supplier_id);

CREATE TRIGGER update_shop_balances_updated_at BEFORE UPDATE ON public.shop_balances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_payout_methods_updated_at BEFORE UPDATE ON public.payout_methods FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();