
-- Add payment fields to supplier_applications table
ALTER TABLE public.supplier_applications ADD COLUMN IF NOT EXISTS payment_iban text;
ALTER TABLE public.supplier_applications ADD COLUMN IF NOT EXISTS payment_card_holder text;
ALTER TABLE public.supplier_applications ADD COLUMN IF NOT EXISTS payment_bank_name text;

-- Add process-payout function config handled in config.toml
