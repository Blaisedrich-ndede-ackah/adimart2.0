-- ============================================================
-- ADIMAT POS - Supplier payables
-- Tracks amount paid and due date on purchase orders, plus each
-- partial payment (cash, MoMo, bank). Safe to run more than once.
-- ============================================================

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_date DATE;

ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_amount_paid_check;
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_amount_paid_check
  CHECK (amount_paid >= 0);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  method VARCHAR(20) NOT NULL CHECK (method IN ('cash', 'momo', 'bank')),
  note TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  created_by_name VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'supplier_payments' AND policyname = 'supplier_payments_select') THEN
    CREATE POLICY "supplier_payments_select" ON supplier_payments FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'supplier_payments' AND policyname = 'supplier_payments_insert') THEN
    CREATE POLICY "supplier_payments_insert" ON supplier_payments FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'supplier_payments' AND policyname = 'supplier_payments_update') THEN
    CREATE POLICY "supplier_payments_update" ON supplier_payments FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'supplier_payments' AND policyname = 'supplier_payments_delete') THEN
    CREATE POLICY "supplier_payments_delete" ON supplier_payments FOR DELETE USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_store ON supplier_payments(store_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_order ON supplier_payments(purchase_order_id);

NOTIFY pgrst, 'reload schema';
