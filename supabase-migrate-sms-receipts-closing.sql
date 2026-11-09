-- ============================================================
-- ADIMAT POS - SMS receipts and the owner closing summary
-- Queues messages on the device and uploads the outbox.
-- Safe to run more than once. No columns or tables are dropped.
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS closing_sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS closing_sms_time VARCHAR(5) NOT NULL DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS cashiers_can_record_expenses BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS sms_outbox (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('receipt', 'closing')),
  recipient VARCHAR(30) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

ALTER TABLE sms_outbox ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sms_outbox' AND policyname = 'sms_outbox_select') THEN
    CREATE POLICY "sms_outbox_select" ON sms_outbox FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sms_outbox' AND policyname = 'sms_outbox_insert') THEN
    CREATE POLICY "sms_outbox_insert" ON sms_outbox FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sms_outbox' AND policyname = 'sms_outbox_update') THEN
    CREATE POLICY "sms_outbox_update" ON sms_outbox FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sms_outbox' AND policyname = 'sms_outbox_delete') THEN
    CREATE POLICY "sms_outbox_delete" ON sms_outbox FOR DELETE USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sms_outbox_store ON sms_outbox(store_id, created_at);

NOTIFY pgrst, 'reload schema';
