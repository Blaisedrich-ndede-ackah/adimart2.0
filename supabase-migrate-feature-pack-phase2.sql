-- Adimat feature pack Phase 2: gift cards and rental agreements.
-- Apply in Supabase before deploying the matching client build.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_rentable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rental_rate_daily NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rental_rate_weekly NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rental_rate_monthly NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS gift_card_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gift_card_code TEXT NOT NULL DEFAULT '';
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_payment_method_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_payment_method_check
  CHECK (payment_method IN (
    'cash', 'split', 'paystack', 'momo_mtn', 'momo_telecel', 'momo_airteltigo',
    'bank_transfer', 'card_terminal', 'credit', 'wallet', 'gift_card'
  ));

CREATE TABLE IF NOT EXISTS public.gift_cards (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  initial_value NUMERIC(12,2) NOT NULL CHECK (initial_value >= 0),
  balance NUMERIC(12,2) NOT NULL CHECK (balance >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','depleted','disabled')),
  customer_id UUID,
  customer_name TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_cards_store_code_ci ON public.gift_cards(store_id, UPPER(code));
CREATE INDEX IF NOT EXISTS idx_gift_cards_store_status ON public.gift_cards(store_id, status, expires_at);

CREATE TABLE IF NOT EXISTS public.gift_card_transactions (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  gift_card_id UUID NOT NULL REFERENCES public.gift_cards(id) ON DELETE CASCADE,
  transaction_id UUID,
  type TEXT NOT NULL CHECK (type IN ('issue','redeem','reload','refund')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  balance_after NUMERIC(12,2) NOT NULL CHECK (balance_after >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gift_card_transactions_store_date ON public.gift_card_transactions(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_card_transactions_card ON public.gift_card_transactions(gift_card_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.rental_agreements (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  agreement_number TEXT NOT NULL,
  customer_id UUID,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','overdue','returned','cancelled')),
  starts_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  returned_at TIMESTAMPTZ,
  deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  deposit_returned NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deposit_returned >= 0),
  late_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (late_fee >= 0),
  damage_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (damage_fee >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, agreement_number)
);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_store_due ON public.rental_agreements(store_id, status, due_at);

CREATE TABLE IF NOT EXISTS public.rental_items (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  agreement_id UUID NOT NULL REFERENCES public.rental_agreements(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  product_name TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  rate_amount NUMERIC(12,2) NOT NULL CHECK (rate_amount >= 0),
  rate_period TEXT NOT NULL CHECK (rate_period IN ('daily','weekly','monthly')),
  deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  condition_at_return TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rental_items_agreement ON public.rental_items(store_id, agreement_id);

ALTER TABLE public.gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_items ENABLE ROW LEVEL SECURITY;

-- This app currently uses store-scoped client IDs rather than Supabase Auth user IDs.
-- These policies match its existing client-sync table access model; never put secret values here.
DROP POLICY IF EXISTS gift_cards_store_access ON public.gift_cards;
CREATE POLICY gift_cards_store_access ON public.gift_cards FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS gift_card_transactions_store_access ON public.gift_card_transactions;
CREATE POLICY gift_card_transactions_store_access ON public.gift_card_transactions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS rental_agreements_store_access ON public.rental_agreements;
CREATE POLICY rental_agreements_store_access ON public.rental_agreements FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS rental_items_store_access ON public.rental_items;
CREATE POLICY rental_items_store_access ON public.rental_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gift_cards, public.gift_card_transactions,
  public.rental_agreements, public.rental_items TO anon, authenticated;
GRANT ALL ON public.gift_cards, public.gift_card_transactions,
  public.rental_agreements, public.rental_items TO service_role;

NOTIFY pgrst, 'reload schema';
