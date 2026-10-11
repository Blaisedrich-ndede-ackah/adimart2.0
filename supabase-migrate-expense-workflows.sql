ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_image_data_url TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recurring_expense_id UUID;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recurrence_month VARCHAR(7);

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  description VARCHAR(255) NOT NULL,
  category VARCHAR(100) DEFAULT 'Other',
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  notes TEXT DEFAULT '',
  day_of_month SMALLINT NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_generated_month VARCHAR(7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expense_budgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category VARCHAR(100) NOT NULL,
  monthly_limit DECIMAL(12,2) NOT NULL CHECK (monthly_limit > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, category)
);

ALTER TABLE recurring_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_budgets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recurring_expenses' AND policyname = 'recurring_expenses_select') THEN
    CREATE POLICY "recurring_expenses_select" ON recurring_expenses FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recurring_expenses' AND policyname = 'recurring_expenses_insert') THEN
    CREATE POLICY "recurring_expenses_insert" ON recurring_expenses FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recurring_expenses' AND policyname = 'recurring_expenses_update') THEN
    CREATE POLICY "recurring_expenses_update" ON recurring_expenses FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recurring_expenses' AND policyname = 'recurring_expenses_delete') THEN
    CREATE POLICY "recurring_expenses_delete" ON recurring_expenses FOR DELETE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'expense_budgets' AND policyname = 'expense_budgets_select') THEN
    CREATE POLICY "expense_budgets_select" ON expense_budgets FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'expense_budgets' AND policyname = 'expense_budgets_insert') THEN
    CREATE POLICY "expense_budgets_insert" ON expense_budgets FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'expense_budgets' AND policyname = 'expense_budgets_update') THEN
    CREATE POLICY "expense_budgets_update" ON expense_budgets FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'expense_budgets' AND policyname = 'expense_budgets_delete') THEN
    CREATE POLICY "expense_budgets_delete" ON expense_budgets FOR DELETE USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_store ON recurring_expenses(store_id);
CREATE INDEX IF NOT EXISTS idx_expense_budgets_store ON expense_budgets(store_id);
