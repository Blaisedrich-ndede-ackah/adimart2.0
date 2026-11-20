-- Let the shop app read and spend SMS units with the same Supabase access
-- it already uses for sales. Safe to run after supabase-migrate-sms-wallet.sql.

GRANT EXECUTE ON FUNCTION adimat_apply_sms_wallet(UUID, INTEGER, TEXT, TEXT, TEXT, INTEGER, TEXT)
  TO anon, authenticated, service_role;

ALTER TABLE sms_wallet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_topup_intents ENABLE ROW LEVEL SECURITY;

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
