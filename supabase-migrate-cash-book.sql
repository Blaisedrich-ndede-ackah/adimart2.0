-- Owner cash book (manual income / expense ledger)
CREATE TABLE IF NOT EXISTS cash_book_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('income', 'expense')),
  description VARCHAR(255) NOT NULL,
  category VARCHAR(100) DEFAULT 'Other',
  amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  notes TEXT DEFAULT '',
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by VARCHAR(255) DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cash_book_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash_book_entries_select" ON cash_book_entries;
DROP POLICY IF EXISTS "cash_book_entries_insert" ON cash_book_entries;
DROP POLICY IF EXISTS "cash_book_entries_update" ON cash_book_entries;
DROP POLICY IF EXISTS "cash_book_entries_delete" ON cash_book_entries;

CREATE POLICY "cash_book_entries_select" ON cash_book_entries FOR SELECT USING (true);
CREATE POLICY "cash_book_entries_insert" ON cash_book_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "cash_book_entries_update" ON cash_book_entries FOR UPDATE USING (true);
CREATE POLICY "cash_book_entries_delete" ON cash_book_entries FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_cash_book_store ON cash_book_entries(store_id);
CREATE INDEX IF NOT EXISTS idx_cash_book_date ON cash_book_entries(store_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_cash_book_type ON cash_book_entries(store_id, entry_type);

DROP TRIGGER IF EXISTS update_cash_book_entries_updated_at ON cash_book_entries;
CREATE TRIGGER update_cash_book_entries_updated_at
  BEFORE UPDATE ON cash_book_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
