-- Store SMS units. Each store pays for its own texts.
-- Safe to run more than once. Balance starts at zero.

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS sms_balance_pesewas INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sms_topup_intents (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  amount_pesewas INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sms_wallet_entries (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL,
  entry_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount_pesewas INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  recipients INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sms_wallet_topup_reference
  ON sms_wallet_entries (reference)
  WHERE entry_type = 'topup' AND reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS sms_wallet_entries_store
  ON sms_wallet_entries (store_id, created_at DESC);

CREATE OR REPLACE FUNCTION adimat_apply_sms_wallet(
  p_store_id UUID,
  p_delta INTEGER,
  p_entry_type TEXT,
  p_direction TEXT,
  p_reference TEXT,
  p_recipients INTEGER,
  p_message TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance INTEGER;
BEGIN
  IF p_reference IS NOT NULL AND p_reference <> '' AND p_entry_type = 'topup' THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_reference));
    SELECT balance_after INTO new_balance
    FROM sms_wallet_entries
    WHERE reference = p_reference AND entry_type = 'topup'
    LIMIT 1;
    IF FOUND THEN
      RETURN new_balance;
    END IF;
  END IF;

  UPDATE stores
  SET sms_balance_pesewas = COALESCE(sms_balance_pesewas, 0) + p_delta
  WHERE id = p_store_id
    AND (p_delta >= 0 OR COALESCE(sms_balance_pesewas, 0) + p_delta >= 0)
  RETURNING sms_balance_pesewas INTO new_balance;

  IF new_balance IS NULL THEN
    IF p_delta >= 0 THEN
      RAISE EXCEPTION 'This store is not on the server yet';
    END IF;
    RAISE EXCEPTION 'SMS credit is too low for this message';
  END IF;

  INSERT INTO sms_wallet_entries (
    id, store_id, entry_type, direction, amount_pesewas, balance_after,
    recipients, message, reference, created_at
  ) VALUES (
    gen_random_uuid(),
    p_store_id,
    p_entry_type,
    p_direction,
    ABS(p_delta),
    new_balance,
    COALESCE(p_recipients, 0),
    LEFT(COALESCE(p_message, ''), 460),
    NULLIF(p_reference, ''),
    NOW()
  );

  RETURN new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION adimat_apply_sms_wallet(UUID, INTEGER, TEXT, TEXT, TEXT, INTEGER, TEXT)
  TO anon, authenticated, service_role;

ALTER TABLE sms_topup_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_wallet_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sms_wallet_entries_select" ON sms_wallet_entries;
DROP POLICY IF EXISTS "sms_wallet_entries_insert" ON sms_wallet_entries;
CREATE POLICY "sms_wallet_entries_select" ON sms_wallet_entries FOR SELECT USING (true);
CREATE POLICY "sms_wallet_entries_insert" ON sms_wallet_entries FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "sms_topup_intents_select" ON sms_topup_intents;
DROP POLICY IF EXISTS "sms_topup_intents_insert" ON sms_topup_intents;
CREATE POLICY "sms_topup_intents_select" ON sms_topup_intents FOR SELECT USING (true);
CREATE POLICY "sms_topup_intents_insert" ON sms_topup_intents FOR INSERT WITH CHECK (true);

GRANT SELECT, INSERT ON sms_wallet_entries TO anon, authenticated;
GRANT SELECT, INSERT ON sms_topup_intents TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
