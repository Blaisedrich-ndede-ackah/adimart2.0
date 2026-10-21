# Adimat Agent Portal — System Architecture & Developer Reference

**Product:** Adimat Agent Portal  
**Repository:** `Blaisedrich-ndede-ackah/adimart2.0`  
**Document type:** System architecture, data models, sync, security, integrations, and operations  
**Audience:** Developers, product owners, platform operators, technical stakeholders  
**Currency / locale:** Ghana Cedi (GHS / GH₵), dates styled for `en-GH`, Ghana phone numbers (e.g. `024XXXXXXX`)  
**Status:** Future development — specification only, no implementation yet  
**Parent system:** Adimat POS (React 19 + Vite + Tailwind + TypeScript, Supabase + Dexie, Zustand, `swr`, `jspdf`, Paystack)

---

## 1. Executive Overview

The Adimat Agent Portal is a mobile-first, offline-first Progressive Web App (PWA) that enables field **agents** to onboard stores onto the Adimat platform. Unlike self-service signup, the flow is admin-mediated:

1. The **platform admin registers the agent** and issues a 4-digit PIN.
2. The **agent logs in with PIN only**.
3. The **agent records store details as a prospect** for future follow-ups.
4. The **agent creates a subscription invoice** and shares a PDF with the store owner.
5. The store owner pays through the existing **Paystack** integration.
6. Once payment is confirmed, the **store owner's account is automatically opened/activated**.
7. The **agent earns a percentage commission** on the subscription, viewable as a balance.
8. The **agent can request withdrawal** of their balance to their registered Mobile Money (MoMo) number, subject to admin approval.

The portal runs entirely in the browser as a static client, with IndexedDB (Dexie.js) as the local source of truth and optional Supabase (PostgreSQL) cloud backup/sync. There is **no first-party application server**. Production deployment is static hosting of a Vite-built single-file bundle.

### Primary capabilities

| Area | Capabilities |
|------|--------------|
| Agent onboarding (admin-mediated) | Admin creates agent account; agent logs in with PIN only; optional biometric unlock |
| MoMo payout setup | Agent registers/updates Mobile Money number, network, and account name for withdrawals |
| Prospect (store lead) management | Create, read, update, archive store prospects; capture contact, business type, location, status, notes |
| Follow-ups | Schedule next follow-up date/time, view overdue follow-ups, log follow-up outcomes |
| Subscription invoicing | Create invoice for a prospect/store, generate downloadable PDF, share via WhatsApp, record payment method |
| Paystack subscription payment | Store owner pays subscription via Paystack inline; automatic account activation on confirmed payment |
| Commission / percentage balance | Accrued commission per paid subscription invoice, configurable percentage, payable vs withdrawn balance view |
| Withdrawals | Request withdrawal to registered MoMo number, track status (pending → approved → paid/rejected), view payout history |
| Admin oversight | Platform admin registers agents, approves store registrations after payment, approves/rejects withdrawals, monitors payouts |


## 2. System Context

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Device Browser (Agent PWA)                             │
│  React UI  →  Zustand stores  →  Dexie (IndexedDB, local source of truth)   │
│       │              │                 │                                     │
│       ├─ PIN login (4-digit, hashed)                                        │
│       ├─ Optional WebAuthn biometric unlock                                 │
│       ├─ Paystack Inline JS ─────────────────────────► Paystack             │
│       ├─ WhatsApp deep link (wa.me) — invoice PDF share                     │
│       ├─ Supabase JS client ─────────────────────────► Supabase Postgres    │
│       │         (anon key, optional cloud sync / restore)                   │
│       └─ SMS (mNotify) — withdrawal status alerts (optional)                │
│                                                                             │
│  Service Worker (public/sw.js) — network-first asset cache, offline shell   │
└─────────────────────────────────────────────────────────────────────────────┘
                                     ▲
                                     │ HTTPS / Realtime
                                     │
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Cloud Layer (Supabase)                             │
│  PostgreSQL tables with Row Level Security (RLS)                            │
│  ┌─────────────┐  ┌────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │ agents      │  │ prospects  │  │ invoices     │  │ payments        │   │
│  │ stores      │  │ commissions│  │ withdrawal_  │  │ commission_     │   │
│  │             │  │ follow_ups │  │ requests     │  │ settings        │   │
│  └─────────────┘  └────────────┘  └──────────────┘  └─────────────────┘   │
│                                                                             │
│  Server-side logic: verify-payment, activate-store, create-withdrawal,      │
│  approve-withdrawal, compute-agent-balance                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     ▲
                                     │
┌─────────────────────────────────────────────────────────────────────────────┐
│                        External Systems                                       │
│  Paystack — subscription checkout (MoMo, card, bank, USSD, QR) + verification│
│  Mobile Money providers (MTN / Telecel / AirtelTigo) — agent withdrawal      │
│  WhatsApp (wa.me) — invoice PDF link sharing                                 │
│  mNotify SMS — withdrawal status notifications (platform settings)           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### External systems

| System | Role | Integration point |
|--------|------|-------------------|
| Supabase | Multi-tenant PostgreSQL sync/restore, agent and store records | `src/lib/supabase.ts`, `src/lib/dexie.ts`, `src/lib/sync.ts` |
| Paystack | Store subscription checkout (MoMo, card, bank, USSD, QR) + transaction verification | `src/lib/paystack.ts` |
| Mobile Money | Agent withdrawal destination (agent-registered number) | Withdrawal request → admin approval → payout reference |
| WhatsApp | Share invoice PDF link via `wa.me` | Invoice UI |
| mNotify | SMS alerts for withdrawal status | `platform_settings.mnotify_api_key`, `mnotify_sender_id` |
| Browser APIs | Camera, IndexedDB, Service Worker, optional WebAuthn | PWA shell |

---

## 3. Actor Model

| Actor | Description | Primary responsibilities |
|-------|-------------|--------------------------|
| **Platform Admin** | Back-office operator who runs the Adimat platform | Registers agents, approves store registrations after payment, sets commission rates and withdrawal thresholds, approves/rejects withdrawals, monitors payouts |
| **Agent** | Field sales representative, authenticated via PIN only | Registers store prospects, schedules follow-ups, creates subscription invoices, shares PDF invoices, views commission balance, requests withdrawal to own MoMo number |
| **Store owner / Prospect** | Potential or active merchant onboarding to Adimat | Receives invoice PDF, pays subscription via Paystack, gets account automatically activated after payment |

---

## 4. Feature Walkthroughs

### 4.1 Agent registration (admin-mediated)

Agents do **not** self-register.

1. Platform admin creates an agent account in the admin back-office: full name, phone, email, initial commission percentage, and a 4-digit PIN.
2. The agent's PIN is hashed before storage (never plain text).
3. The admin registers the agent's default Mobile Money payout number (number, network, account name) or leaves it for the agent to set on first login.
4. The agent receives their phone/PIN credentials and logs into the agent PWA.

### 4.2 Agent login (PIN only)

1. Agent opens the agent portal and enters their registered phone number and 4-digit PIN.
2. PIN is verified against the stored hash.
3. Optional WebAuthn biometric unlock can be enabled for subsequent logins.
4. On successful login, the agent lands on the dashboard showing: pending follow-ups, active prospects, commission balance, and quick actions (register store, create invoice, request withdrawal).

### 4.3 Register a store as a prospect

1. Agent navigates to **Prospects → Add Prospect / Register Store**.
2. Captures store details:
   - Store/business name, owner full name, owner phone, owner email
   - Business address/city, business type, subscription package/tier
   - Source (referral, walk-in, social media), initial notes
3. System assigns the prospect to the signed-in agent (`agent_id`) and timestamps `created_at`.
4. Prospect status defaults to `lead`.
5. Saved locally (Dexie) and queued for Supabase sync.
6. The prospect record becomes the basis for follow-ups and the eventual subscription invoice.

### 4.4 Prospect details & future follow-ups

1. Agent opens a prospect's detail page to view all logged store information and interaction history.
2. Agent schedules a follow-up: date/time, channel (call / SMS / WhatsApp / visit), outcome notes, status (`scheduled` / `completed` / `missed`).
3. The system surfaces **overdue follow-ups** and **today's follow-ups** on the agent dashboard.
4. Each follow-up is timestamped; a prospect can have many follow-ups over its lifetime.
5. Prospect lifecycle statuses: `lead` → `contacted` → `follow_up` → `converted` (paid & activated) / `lost`.
### 4.5 Create a subscription invoice for the store

1. From a prospect's detail page, agent taps **Create Invoice**.
2. Enters: invoice amount (GHS, the subscription fee), due date, subscription package, optional description.
3. System generates an invoice number (`#INV-YYYYMMDD-XXXX`), links `prospect_id`, `store_id` (if created), and `agent_id`, sets status `issued`.
4. Agent can:
   - Generate/download a **PDF invoice** (itemised: agent details, store details, subscription package, amount, due date, Paystack payment link / MoMo instructions)
   - Share the invoice via WhatsApp deep link (`wa.me`) so the store owner can pay
   - Record a manual payment (cash / MoMo / bank transfer) directly against the invoice
   - Trigger a Paystack checkout so the store owner pays online/MoMo directly

### 4.6 Store owner pays via Paystack → automatic account activation

1. Store owner receives the invoice PDF (via WhatsApp or printed) and pays the subscription through Paystack (Mobile Money, card, bank, USSD, QR).
2. The system verifies the Paystack transaction reference (server-side or client-side verification against Paystack API).
3. On confirmed `success`:
   - A `payments` row is recorded with `paystack_reference`.
   - The invoice status moves to `paid`.
   - A `stores` row is created/activated for the store owner (account auto-opened), linked to the agent who onboarded them.
   - Store owner receives store credentials and can log into the Adimat POS.
4. If payment fails or is not received by `due_date`, the invoice is flagged `overdue`.

### 4.7 Commission / percentage balance

For every invoice that reaches `paid` status:

```
commission_amount = invoice_amount × agent_commission_percentage / 100
```

A `commissions` row is created with:
- `invoice_id`, `agent_id`, `commission_rate_percentage`, `commission_amount_ghs`
- Status: `accrued` (earned, not yet paid out)

The agent's **payable balance** is computed as:

```
payable_balance = SUM(accrued commissions) − SUM(paid withdrawals)
```

The agent dashboard shows:
- Total accrued commission (GHS)
- Total withdrawn (GHS)
- Current payable balance (GHS) — available to request for withdrawal

### 4.8 Withdrawal request to agent's MoMo number

1. Agent navigates to **Wallet → Request Withdrawal**.
2. Enters amount (must be ≤ current payable balance and ≥ `min_withdrawal_ghs` platform setting).
3. System pre-fills the agent's registered MoMo number, network, and account name (agent may confirm; changes require re-verification).
4. A `withdrawal_requests` row is created with status `pending` and a snapshot of the MoMo details at request time.
5. Platform admin reviews the request:
   - **Approve:** status → `approved`, payout reference recorded, agent payable balance reduced, agent notified via SMS/WhatsApp.
   - **Reject:** status → `rejected` with reason; no balance deduction; agent notified.
6. After disbursement to the agent's MoMo number, admin marks status `paid` with payout date/reference.
7. Agent views full withdrawal history (amount, MoMo destination, status, dates) in the wallet screen.

### 4.9 Admin oversight (platform admin back-office)

Platform admin can:
- Register agents (name, phone, PIN, commission percentage, MoMo payout details)
- Activate/suspend/deactivate agents
- Set default commission rate per agent or globally
- Configure minimum withdrawal threshold and payout fee
- View pending store registrations and approve them after Paystack payment confirmation
- Approve/reject pending agent withdrawals
- View all agents, their prospect counts, invoice volumes, accrued commission, and payout history
- Export agent payout and commission reports (CSV/PDF)


---

## 5. Data Model

Entity-relationship (text):

```text
agents 1──< prospects           (agent registers many store prospects)
agents 1──< invoices            (agent issues many subscription invoices)
agents 1──< commissions         (agent earns many commissions)
agents 1──< withdrawal_requests (agent requests many withdrawals)
agents 1──< stores              (agent onboards many stores after activation)
prospects 1──< invoices         (prospect receives many invoices)
prospects 1──< follow_ups       (prospect has many follow-up activities)
invoices 1──< payments          (invoice receives many payments)
invoices 1──< commissions       (paid invoice generates one commission)
commission_settings 1──< agents (global/default commission rate)
```

### 5.1 Table definitions (Supabase PostgreSQL, matching `supabase-init.sql` style)

```sql
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- AGENTS (registered by admin; PIN-only login)
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

-- ============================================================
-- PROSPECTS (store leads recorded by agents for follow-up)
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
CREATE INDEX IF NOT EXISTS idx_prospects_agent ON prospects(agent_id);
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_prospects_next_follow_up ON prospects(next_follow_up_at);

-- ============================================================
-- FOLLOW_UPS (scheduled store follow-up activities)
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
CREATE INDEX IF NOT EXISTS idx_follow_ups_prospect ON follow_ups(prospect_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_agent_due ON follow_ups(agent_id, follow_up_at);

-- ============================================================
-- STORES (activated store accounts after subscription payment)
-- ============================================================
CREATE TABLE IF NOT EXISTS stores (
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
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_stores_agent ON stores(agent_id);
CREATE INDEX IF NOT EXISTS idx_stores_status ON stores(status);
CREATE INDEX IF NOT EXISTS idx_stores_prospect ON stores(prospect_id);

-- ============================================================
-- INVOICES (subscription invoices issued to prospects/stores)
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
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
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_invoices_agent ON invoices(agent_id);
CREATE INDEX IF NOT EXISTS idx_invoices_prospect ON invoices(prospect_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
);
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_stores_agent ON stores(agent_id);
CREATE INDEX IF NOT EXISTS idx_stores_status ON stores(status);
CREATE INDEX IF NOT EXISTS idx_stores_prospect ON stores(prospect_id);
```

-- ============================================================
-- PAYMENTS (subscription payments recorded against invoices)
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  amount_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_ghs >= 0),
  payment_method VARCHAR(30) NOT NULL CHECK (payment_method IN ('cash', 'momo', 'bank_transfer', 'paystack')),
  reference VARCHAR(120) DEFAULT '',
  paid_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_agent ON payments(agent_id);

-- ============================================================
-- COMMISSIONS (accrued earnings per paid subscription invoice)
-- ============================================================
CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  commission_rate_percentage NUMERIC(5, 2) NOT NULL CHECK (commission_rate_percentage >= 0 AND commission_rate_percentage <= 100),
  commission_amount_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (commission_amount_ghs >= 0),
  status VARCHAR(30) NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued', 'paid', 'withheld')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_commissions_agent ON commissions(agent_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(status);
-- ============================================================
-- WITHDRAWAL_REQUESTS (agent payout requests to MoMo)
-- ============================================================
CREATE TABLE IF NOT EXISTS withdrawal_requests (
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
  processed_by UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_agent ON withdrawal_requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status);

-- ============================================================
-- COMMISSION SETTINGS (platform-wide defaults)
-- ============================================================
CREATE TABLE IF NOT EXISTS commission_settings (
  id TEXT PRIMARY KEY DEFAULT 'main',
  default_commission_percentage NUMERIC(5, 2) NOT NULL DEFAULT 10.00 CHECK (default_commission_percentage >= 0 AND default_commission_percentage <= 100),
  min_withdrawal_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (min_withdrawal_ghs >= 0),
  withdrawal_fee_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (withdrawal_fee_ghs >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE commission_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO commission_settings (id, default_commission_percentage, min_withdrawal_ghs, withdrawal_fee_ghs)
VALUES ('main', 10.00, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- ROW LEVEL SECURITY POLICIES (agent-scoped access)
-- ============================================================
CREATE POLICY "agents_own" ON agents FOR ALL USING (auth.uid()::text = id::text);
CREATE POLICY "prospects_agent" ON prospects FOR ALL USING (agent_id = auth.uid()::text);
CREATE POLICY "follow_ups_agent" ON follow_ups FOR ALL USING (agent_id = auth.uid()::text);
CREATE POLICY "stores_agent" ON stores FOR ALL USING (agent_id = auth.uid()::text);
CREATE POLICY "invoices_agent" ON invoices FOR ALL USING (agent_id = auth.uid()::text);
CREATE POLICY "payments_agent" ON payments FOR ALL USING (agent_id = auth.uid()::text);
CREATE POLICY "commissions_agent_read" ON commissions FOR SELECT USING (agent_id = auth.uid()::text);
CREATE POLICY "withdrawal_requests_agent" ON withdrawal_requests FOR ALL USING (agent_id = auth.uid()::text);
CREATE POLICY "commission_settings_read" ON commission_settings FOR SELECT USING (true);
```

> **Note:** In the existing Adimat codebase, RLS policies are permissive (`USING (true)`) for prototype convenience. For production agent-portal multi-tenancy, replace with the agent-scoped policies above and harden before exposing untrusted agents (see `SYSTEM_DOCUMENTATION.md` §17 known gap #9).

### 5.2 Local offline schema (Dexie / IndexedDB)

Mirror the cloud tables locally with a `synced` / `dirty` flag on every entity:

| Local field | Purpose |
|-------------|---------|
| `synced` (0/1) | Row has been pushed to Supabase |
| `deleted_at` (nullable) | Soft-delete tombstone for sync |
| `updated_at` | Last-write-wins conflict resolution |

Agents can register store prospects, create invoices, record payments, and request withdrawals entirely offline; changes sync to Supabase when connectivity returns (pull-then-push, auto every 3 minutes or on explicit sync — consistent with existing Adimat sync behavior).


---

## 6. Commission & Balance Calculation Rules

1. **Accrual trigger:** A commission row is created only when a subscription invoice transitions to `paid` (fully settled via Paystack or manual payment). Partial payments accrue commission proportionally or on full settlement — configurable per deployment (recommended: accrue on full payment).
2. **Rate:** Uses the agent's `commission_percentage` at the time the invoice was issued (snapshot on the `commissions` row), so retroactive rate changes don't alter past earnings.
3. **Payable balance:** `SUM(commissions WHERE status='accrued') − SUM(withdrawal_requests WHERE status='paid')`.
4. **Withdrawal eligibility:** Requested amount must be ≤ payable balance and ≥ `min_withdrawal_ghs` (platform setting).
5. **Fee:** `net_amount = amount − withdrawal_fee_ghs`; fee deducted from agent balance at approval time.
6. **Payout destination:** Always the agent's registered MoMo number (snapshot stored on the withdrawal request so later number changes don't alter history).

---

## 7. API Surface

All data access goes through the Supabase client (anon key + RLS). Recommended RPCs/edge functions for server-side logic:

| Action | Endpoint / RPC | Notes |
|--------|---------------|-------|
| Register agent (admin only) | `POST /rest/v1/agents` | Admin creates agent + PIN hash |
| Agent login | Client-side PIN verify against `agents.pin_hash` | No password flow |
| Create prospect | `POST /rest/v1/prospects` | Agent-scoped insert |
| Schedule follow-up | `POST /rest/v1/follow_ups` | Sets `next_follow_up_at` on prospect |
| Create invoice | `POST /rest/v1/invoices` | Generates `#INV-...` number |
| Record payment | `POST /rest/v1/payments` | Recalculates invoice status; triggers commission accrual when paid |
| Verify Paystack payment | `rpc.verify_paystack_payment(reference)` | Confirms with Paystack API before marking paid |
| Activate store | `rpc.activate_store(invoice_id)` | Creates/activates `stores` row after payment confirmation |
| Request withdrawal | `POST /rest/v1/withdrawal_requests` | Validates balance ≥ amount |
| Approve withdrawal | `rpc.approve_withdrawal(id, admin_id, payout_reference)` | Sets `approved`, records payout ref |
| Pay withdrawal | `rpc.pay_withdrawal(id)` | Sets `paid`, stamps `processed_at` |
| Compute agent balance | `rpc.agent_balance(agent_id)` | Returns accrued / withdrawn / payable |
| List overdue follow-ups | `GET /rest/v1/follow_ups?status=eq.scheduled&follow_up_at=lt.now()` | Agent dashboard |

---

## 8. PDF, Notifications & Sharing

- **Invoice PDF:** Generated client-side with `jspdf`/`html2canvas` (consistent with existing Adimat receipt generation). Format: `#INV-YYYYMMDD-XXXX`. Includes agent name, store/prospect details, subscription package, amount, due date, Paystack payment link / MoMo instructions.
- **WhatsApp sharing:** `wa.me` deep link pre-filled with invoice link and message so the store owner can pay.
- **SMS alerts:** Withdrawal status changes (approved/rejected/paid) sent via mNotify using `platform_settings.mnotify_api_key` / `mnotify_sender_id` (same mechanism already used for store alerts).
- **Follow-up reminders:** Surfaced in-app on the agent dashboard; optional SMS reminder on due date.

---

## 9. Security

- Agent PINs hashed before storage (never plain text), consistent with existing Adimat auth.
- Optional WebAuthn biometric unlock for agent login.
- Agents register via admin only — no self-registration, preventing unauthorized agent onboarding.
- Row Level Security on all Supabase tables; agents access only their own prospects, stores, invoices, commissions, and withdrawal requests.
- Withdrawal requests require platform-admin approval before any balance deduction or payout reference is issued.
- MoMo number changes require re-verification; withdrawal requests snapshot the number at request time.
- Role-based access: Agent vs Platform Admin (admin routes separated from the agent PWA).

---

## 10. Operations

- **Build:** `npm run build` → Vite single-file bundle via `vite-plugin-singlefile` → static host `dist/`.
- **Environment variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PAYSTACK_PUBLIC_KEY`, `VITE_MNOTIFY_API_KEY` (optional SMS).
- **Deploy:** Static hosting (Vercel/Netlify or equivalent); PWA install via service worker.
- **Migrations:** New SQL migration files following the `supabase-migrate-*.sql` naming convention for `agents`, `prospects`, `follow_ups`, `stores`, `invoices`, `payments`, `commissions`, `withdrawal_requests`, `commission_settings`.
- **Sync health:** Monitor last sync, pending changes, and errors (reuse existing Adimat Settings → Cloud Sync health patterns).
- **Backups:** Daily local Dexie snapshots; cloud restore from Supabase.

---

## 11. Glossary

| Term | Meaning |
|------|---------|
| Agent | Field sales rep registered by admin; logs in with PIN only; onboards stores, earns commission, requests MoMo withdrawals |
| Platform Admin | Back-office operator who registers agents, approves stores and withdrawals |
| Prospect | A store lead recorded by an agent; tracked through lead → contacted → follow_up → converted / lost |
| Follow-up | A scheduled contact activity with a prospect/store (call, SMS, WhatsApp, visit) |
| Invoice | A subscription payment request issued to a prospect (`#INV-YYYYMMDD-XXXX`) |
| Store | An activated merchant account on the Adimat platform (created after subscription payment) |
| Commission | Percentage of a paid subscription invoice earned by the onboarding agent |
| Payable balance | Accrued commission minus paid-out withdrawals; available to withdraw |
| Withdrawal request | Agent payout request sent to their registered MoMo number, subject to admin approval |
| MoMo | Mobile Money (MTN / Telecel / AirtelTigo) — Ghana's dominant mobile payment method |
| Pesewa | Paystack subunit; `amount = GHS × 100` |
| RLS | Row Level Security (Supabase) |
| Synced flag | Local `0/1` marker indicating whether a row has been pushed to Supabase |

---

## 12. Known Gaps (to address during implementation)

1. No agent-portal tables exist yet — create the migration SQL listed in §5.1.
2. No agent PIN login flow exists yet — extend the existing PIN auth pattern (admin-issued, PIN-only).
3. No invoice PDF template or `#INV-...` numbering exists yet — reuse `src/lib/receiptGenerator.ts` patterns.
4. No commission accrual trigger, store activation RPC, or withdrawal approval RPCs exist yet — add server-side validation.
5. No automated tests or CI workflows in-repo (existing gap).
6. Open RLS policies are unsuitable for untrusted multi-tenant production without hardening (existing gap #9).
7. Paystack webhook/verification for automatic store activation must be implemented against the existing Paystack integration.
8. Withdrawal disbursement to MoMo requires integration with a Mobile Money disbursement provider or manual payout reference recording — define provider before build.

---

**End of agent portal architecture document.**  
For the existing POS system reference, see `README.md` and `SYSTEM_DOCUMENTATION.md`. For authoritative cloud DDL, see `supabase-init.sql`.

