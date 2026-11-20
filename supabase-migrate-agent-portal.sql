-- ============================================================
-- ADIMAT AGENT PORTAL
-- Agents, store prospects, follow-ups, subscription invoices,
-- commissions, and Mobile Money withdrawal requests.
-- Safe to re-run. Agents sign in with a PIN, not Supabase Auth,
-- so policies match the rest of this prototype (anon read/write).
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- AGENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(255) DEFAULT '',
  pin_hash TEXT NOT NULL,
  momo_number VARCHAR(50) DEFAULT '',
  momo_network VARCHAR(50) DEFAULT '',
  momo_account_name VARCHAR(255) DEFAULT '',
  commission_percentage NUMERIC(5, 2) NOT NULL DEFAULT 10.00 CHECK (commission_percentage >= 0 AND commission_percentage <= 100),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agents_select" ON agents;
DROP POLICY IF EXISTS "agents_insert" ON agents;
DROP POLICY IF EXISTS "agents_update" ON agents;
CREATE POLICY "agents_select" ON agents FOR SELECT USING (true);
CREATE POLICY "agents_insert" ON agents FOR INSERT WITH CHECK (true);
CREATE POLICY "agents_update" ON agents FOR UPDATE USING (true);
CREATE INDEX IF NOT EXISTS idx_agents_phone ON agents(phone);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

-- ============================================================
-- PROSPECTS
-- ============================================================
CREATE TABLE IF NOT EXISTS prospects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  store_name VARCHAR(255) NOT NULL,
  owner_full_name VARCHAR(255) NOT NULL,
  owner_phone VARCHAR(50) NOT NULL,
  owner_email VARCHAR(255) DEFAULT '',
  address TEXT DEFAULT '',
  city VARCHAR(100) DEFAULT '',
  business_type VARCHAR(100) DEFAULT '',
  subscription_package VARCHAR(100) DEFAULT '',
  source VARCHAR(50) DEFAULT '',
  status VARCHAR(30) NOT NULL DEFAULT 'lead' CHECK (status IN ('lead', 'contacted', 'follow_up', 'converted', 'lost')),
  notes TEXT DEFAULT '',
  last_contacted_at TIMESTAMPTZ,
  next_follow_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prospects_select" ON prospects;
DROP POLICY IF EXISTS "prospects_insert" ON prospects;
DROP POLICY IF EXISTS "prospects_update" ON prospects;
CREATE POLICY "prospects_select" ON prospects FOR SELECT USING (true);
CREATE POLICY "prospects_insert" ON prospects FOR INSERT WITH CHECK (true);
CREATE POLICY "prospects_update" ON prospects FOR UPDATE USING (true);
CREATE INDEX IF NOT EXISTS idx_prospects_agent ON prospects(agent_id);
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_prospects_next_follow_up ON prospects(next_follow_up_at);

-- ============================================================
-- FOLLOW UPS
-- ============================================================
CREATE TABLE IF NOT EXISTS follow_ups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  follow_up_at TIMESTAMPTZ NOT NULL,
  channel VARCHAR(30) DEFAULT 'call' CHECK (channel IN ('call', 'sms', 'whatsapp', 'visit', 'other')),
  outcome TEXT DEFAULT '',
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'missed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "follow_ups_select" ON follow_ups;
DROP POLICY IF EXISTS "follow_ups_insert" ON follow_ups;
DROP POLICY IF EXISTS "follow_ups_update" ON follow_ups;
CREATE POLICY "follow_ups_select" ON follow_ups FOR SELECT USING (true);
CREATE POLICY "follow_ups_insert" ON follow_ups FOR INSERT WITH CHECK (true);
CREATE POLICY "follow_ups_update" ON follow_ups FOR UPDATE USING (true);
CREATE INDEX IF NOT EXISTS idx_follow_ups_prospect ON follow_ups(prospect_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_agent_due ON follow_ups(agent_id, follow_up_at);

-- ============================================================
-- AGENT STORES (link from a paid prospect to the opened POS store)
-- The row id is the real Adimat stores.id created for the owner.
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_stores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  prospect_id UUID REFERENCES prospects(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  owner_phone VARCHAR(50) NOT NULL,
  owner_email VARCHAR(255) DEFAULT '',
  address TEXT DEFAULT '',
  city VARCHAR(100) DEFAULT '',
  business_type VARCHAR(100) DEFAULT '',
  subscription_package VARCHAR(100) DEFAULT '',
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'inactive')),
  activated_at TIMESTAMPTZ,
  subscription_expires_at TIMESTAMPTZ,
  momo_account_name VARCHAR(255) DEFAULT '',
  momo_number VARCHAR(50) DEFAULT '',
  momo_network VARCHAR(50) DEFAULT '',
  access_blocked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE agent_stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_stores_select" ON agent_stores;
DROP POLICY IF EXISTS "agent_stores_insert" ON agent_stores;
DROP POLICY IF EXISTS "agent_stores_update" ON agent_stores;
CREATE POLICY "agent_stores_select" ON agent_stores FOR SELECT USING (true);
CREATE POLICY "agent_stores_insert" ON agent_stores FOR INSERT WITH CHECK (true);
CREATE POLICY "agent_stores_update" ON agent_stores FOR UPDATE USING (true);
CREATE INDEX IF NOT EXISTS idx_agent_stores_agent ON agent_stores(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_stores_status ON agent_stores(status);
CREATE INDEX IF NOT EXISTS idx_agent_stores_prospect ON agent_stores(prospect_id);

-- ============================================================
-- INVOICES
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number VARCHAR(40) NOT NULL UNIQUE,
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  amount_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_ghs >= 0),
  currency_code VARCHAR(8) NOT NULL DEFAULT 'GHS',
  due_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'paid', 'partial', 'overdue', 'cancelled')),
  description TEXT DEFAULT '',
  paystack_reference VARCHAR(120) DEFAULT '',
  pdf_url TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE agent_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_invoices_select" ON agent_invoices;
DROP POLICY IF EXISTS "agent_invoices_insert" ON agent_invoices;
DROP POLICY IF EXISTS "agent_invoices_update" ON agent_invoices;
CREATE POLICY "agent_invoices_select" ON agent_invoices FOR SELECT USING (true);
CREATE POLICY "agent_invoices_insert" ON agent_invoices FOR INSERT WITH CHECK (true);
CREATE POLICY "agent_invoices_update" ON agent_invoices FOR UPDATE USING (true);
CREATE INDEX IF NOT EXISTS idx_agent_invoices_agent ON agent_invoices(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_invoices_prospect ON agent_invoices(prospect_id);
CREATE INDEX IF NOT EXISTS idx_agent_invoices_status ON agent_invoices(status);
CREATE INDEX IF NOT EXISTS idx_agent_invoices_due_date ON agent_invoices(due_date);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES agent_invoices(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  amount_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_ghs >= 0),
  payment_method VARCHAR(30) NOT NULL CHECK (payment_method IN ('cash', 'momo', 'bank_transfer', 'paystack')),
  reference VARCHAR(120) DEFAULT '',
  paid_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE agent_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_payments_select" ON agent_payments;
DROP POLICY IF EXISTS "agent_payments_insert" ON agent_payments;
DROP POLICY IF EXISTS "agent_payments_update" ON agent_payments;
CREATE POLICY "agent_payments_select" ON agent_payments FOR SELECT USING (true);
CREATE POLICY "agent_payments_insert" ON agent_payments FOR INSERT WITH CHECK (true);
CREATE POLICY "agent_payments_update" ON agent_payments FOR UPDATE USING (true);
CREATE INDEX IF NOT EXISTS idx_agent_payments_invoice ON agent_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_agent_payments_agent ON agent_payments(agent_id);

-- ============================================================
-- COMMISSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_commissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES agent_invoices(id) ON DELETE CASCADE,
  commission_rate_percentage NUMERIC(5, 2) NOT NULL CHECK (commission_rate_percentage >= 0 AND commission_rate_percentage <= 100),
  commission_amount_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (commission_amount_ghs >= 0),
  status VARCHAR(30) NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued', 'paid', 'withheld')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);
ALTER TABLE agent_commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_commissions_select" ON agent_commissions;
DROP POLICY IF EXISTS "agent_commissions_insert" ON agent_commissions;
DROP POLICY IF EXISTS "agent_commissions_update" ON agent_commissions;
CREATE POLICY "agent_commissions_select" ON agent_commissions FOR SELECT USING (true);
CREATE POLICY "agent_commissions_insert" ON agent_commissions FOR INSERT WITH CHECK (true);
CREATE POLICY "agent_commissions_update" ON agent_commissions FOR UPDATE USING (true);
CREATE INDEX IF NOT EXISTS idx_agent_commissions_agent ON agent_commissions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_commissions_status ON agent_commissions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_commissions_invoice ON agent_commissions(invoice_id);

-- ============================================================
-- WITHDRAWAL REQUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  amount_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_ghs > 0),
  fee_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (fee_ghs >= 0),
  net_amount_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (net_amount_ghs >= 0),
  momo_number VARCHAR(50) NOT NULL,
  momo_network VARCHAR(50) NOT NULL,
  momo_account_name VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  rejection_reason TEXT DEFAULT '',
  payout_reference VARCHAR(120) DEFAULT '',
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processed_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE agent_withdrawal_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_withdrawal_requests_select" ON agent_withdrawal_requests;
DROP POLICY IF EXISTS "agent_withdrawal_requests_insert" ON agent_withdrawal_requests;
DROP POLICY IF EXISTS "agent_withdrawal_requests_update" ON agent_withdrawal_requests;
CREATE POLICY "agent_withdrawal_requests_select" ON agent_withdrawal_requests FOR SELECT USING (true);
CREATE POLICY "agent_withdrawal_requests_insert" ON agent_withdrawal_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "agent_withdrawal_requests_update" ON agent_withdrawal_requests FOR UPDATE USING (true);
CREATE INDEX IF NOT EXISTS idx_agent_withdrawal_requests_agent ON agent_withdrawal_requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_withdrawal_requests_status ON agent_withdrawal_requests(status);

-- ============================================================
-- COMMISSION SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_commission_settings (
  id TEXT PRIMARY KEY DEFAULT 'main',
  default_commission_percentage NUMERIC(5, 2) NOT NULL DEFAULT 10.00 CHECK (default_commission_percentage >= 0 AND default_commission_percentage <= 100),
  min_withdrawal_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (min_withdrawal_ghs >= 0),
  withdrawal_fee_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (withdrawal_fee_ghs >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE agent_commission_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_commission_settings_select" ON agent_commission_settings;
DROP POLICY IF EXISTS "agent_commission_settings_insert" ON agent_commission_settings;
DROP POLICY IF EXISTS "agent_commission_settings_update" ON agent_commission_settings;
CREATE POLICY "agent_commission_settings_select" ON agent_commission_settings FOR SELECT USING (true);
CREATE POLICY "agent_commission_settings_insert" ON agent_commission_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "agent_commission_settings_update" ON agent_commission_settings FOR UPDATE USING (true);
INSERT INTO agent_commission_settings (id, default_commission_percentage, min_withdrawal_ghs, withdrawal_fee_ghs)
VALUES ('main', 10.00, 0, 0)
ON CONFLICT (id) DO NOTHING;
