CREATE TABLE public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('profile','supplier')),
  owner_id uuid NOT NULL,
  balance numeric NOT NULL DEFAULT 0,
  bonus_balance numeric NOT NULL DEFAULT 0,
  pending numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'UAH',
  is_connected boolean NOT NULL DEFAULT false,
  tg_wallet_address text,
  tg_wallet_currency text,
  payout_provider text NOT NULL DEFAULT 'telegram_wallet',
  auto_withdraw boolean NOT NULL DEFAULT false,
  auto_withdraw_min numeric NOT NULL DEFAULT 500,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id)
);

GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own wallet" ON public.wallets
FOR SELECT TO authenticated
USING (owner_type = 'profile' AND owner_id = auth.uid());

CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON public.wallets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('topup','payment','payout','bonus_earn','bonus_spend','refund','hold')),
  amount numeric NOT NULL DEFAULT 0,
  bonus_amount numeric NOT NULL DEFAULT 0,
  provider text NOT NULL DEFAULT 'internal',
  status text NOT NULL DEFAULT 'pending',
  external_id text,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  description text,
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX wallet_tx_external_uniq ON public.wallet_transactions (provider, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX wallet_tx_wallet_idx ON public.wallet_transactions (wallet_id, created_at DESC);

GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_transactions TO service_role;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own wallet transactions" ON public.wallet_transactions
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.wallets w
  WHERE w.id = wallet_transactions.wallet_id
    AND w.owner_type = 'profile'
    AND w.owner_id = auth.uid()
));

CREATE TRIGGER update_wallet_transactions_updated_at BEFORE UPDATE ON public.wallet_transactions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.wallet_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE,
  min_payout numeric NOT NULL DEFAULT 100,
  max_payout numeric NOT NULL DEFAULT 50000,
  daily_limit numeric NOT NULL DEFAULT 100000,
  fee_percent numeric NOT NULL DEFAULT 0,
  fee_fixed numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  eta_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.wallet_limits TO authenticated, anon;
GRANT ALL ON public.wallet_limits TO service_role;
ALTER TABLE public.wallet_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Limits are public" ON public.wallet_limits FOR SELECT USING (true);

CREATE TRIGGER update_wallet_limits_updated_at BEFORE UPDATE ON public.wallet_limits
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.wallet_limits (provider, min_payout, max_payout, daily_limit, fee_percent, fee_fixed, is_active, eta_text) VALUES
  ('telegram_wallet', 50, 100000, 200000, 0, 0, true, 'Миттєво'),
  ('card', 200, 29999, 50000, 1, 5, true, 'До 1 години'),
  ('iban', 500, 400000, 400000, 0, 0, true, '1-2 банківські дні'),
  ('apple_pay', 50, 30000, 60000, 1.5, 0, false, 'Скоро'),
  ('google_pay', 50, 30000, 60000, 1.5, 0, false, 'Скоро'),
  ('mono', 50, 30000, 60000, 1, 0, false, 'Скоро'),
  ('liqpay', 50, 30000, 60000, 1.5, 0, false, 'Скоро'),
  ('nova_pay', 50, 30000, 60000, 1.5, 0, false, 'Скоро');

INSERT INTO public.wallets (owner_type, owner_id, bonus_balance)
SELECT 'profile', ub.profile_id, COALESCE(ub.balance, 0)
FROM public.user_bonuses ub
ON CONFLICT (owner_type, owner_id) DO NOTHING;

INSERT INTO public.wallets (owner_type, owner_id, balance, pending)
SELECT 'supplier', sb.supplier_id, COALESCE(sb.available, 0), COALESCE(sb.pending, 0)
FROM public.shop_balances sb
ON CONFLICT (owner_type, owner_id) DO NOTHING;