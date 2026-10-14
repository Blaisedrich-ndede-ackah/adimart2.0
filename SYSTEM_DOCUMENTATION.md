# Adimat POS — Full System Documentation

**Product:** Adimat POS (short name: Adimat)  
**Repository:** `Blaisedrich-ndede-ackah/adimart2.0`  
**Document type:** System architecture, data, operations, and developer reference  
**Audience:** Developers, operators, and technical stakeholders  
**Currency / locale:** Ghana Cedi (GHS / GH₵), dates styled for `en-GH`

---

## 1. Executive Overview

Adimat POS is a **mobile-first, offline-first Point of Sale and inventory Progressive Web App (PWA)** built for SMEs in Ghana. It runs entirely in the browser as a static client:

- **Local source of truth:** IndexedDB via Dexie.js (`AdimatPOS` database)
- **Optional cloud backup/sync:** Supabase (PostgreSQL) over the anon key
- **Payments:** Paystack Inline (Mobile Money, card, bank, USSD, QR)
- **Hardware:** Camera barcode scanning (ZXing), Web Bluetooth ESC/POS thermal printing, WebAuthn biometrics

There is **no first-party application server**. Production deployment is static hosting of a Vite-built single-file bundle.

### Primary capabilities

| Area | Capabilities |
|------|----------------|
| POS | Scan/search products, cart, stock checks, cash / Paystack / split / registered-customer credit checkout, discounts with owner PIN gate, PDF/WhatsApp receipts, Bluetooth print |
| Customers | Owner-managed customer book, consolidated opening and credit-sale balances, cash/MoMo/cheque/split repayments with receipts, wallet/store credit, and active/archive status |
| Returns | Owner-only return processing with receipt/item validation, cash refunds, wallet credit, debt offsets, optional photo evidence, and automatic inventory restocking |
| Inventory | Product CRUD, owner-managed product categories, stock adjust, CSV import, barcode labels, reorder suggestions, stock audit/export |
| Purchasing | Supplier directory, purchase orders, partial receipts, stock/cost updates |
| Reports | Period filters, revenue mix, charts, product performance, expenses, net profit, CSV/PDF export |
| Staff & security | Owner/cashier roles, 4-digit PIN auth, biometric unlock, discount authorization |
| Ops | Store setup or cloud restore, bidirectional/auto sync, daily local backups + sync health, PWA install + offline shell |

---

## 2. System Context

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Device Browser (PWA)                      │
│  React UI  →  Zustand stores  →  Dexie (IndexedDB)               │
│       │              │                 │                         │
│       ├─ Camera / ZXing barcode                                      │
│       ├─ Web Bluetooth ESC/POS printer                               │
│       ├─ WebAuthn biometric                                          │
│       ├─ Paystack Inline JS  ──────────────► Paystack               │
│       ├─ WhatsApp deep link (wa.me)                                  │
│       └─ Supabase JS client  ──────────────► Supabase Postgres      │
│                                                                  │
│  Service Worker (public/sw.js) — network-first asset cache       │
└─────────────────────────────────────────────────────────────────┘
```

### External systems

| System | Role | Client module |
|--------|------|---------------|
| Supabase | Optional multi-tenant PostgreSQL sync/restore | `src/lib/supabase.ts`, `src/lib/dexie.ts`, `src/lib/sync.ts` |
| Paystack | Card / MoMo / bank / USSD / QR checkout | `src/lib/paystack.ts` |
| WhatsApp | Share text receipts via `wa.me` | `src/lib/receiptGenerator.ts`, checkout UI |
| Browser APIs | Camera, Bluetooth, WebAuthn, Share, Clipboard, Audio | Various `src/lib/*` |

---

## 3. Technology Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| UI framework | React 19.2 + TypeScript 5.9 | SPA, no React Router usage in app shell |
| Build | Vite 7 + `@vitejs/plugin-react` + `vite-plugin-singlefile` | Single-file `dist` output |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) | Theme tokens in `src/index.css` |
| Client state | Zustand 5 | Auth + cart |
| Local DB | Dexie.js 4 / IndexedDB | DB name `AdimatPOS` |
| Cloud DB | Supabase JS → PostgreSQL | Schema in `supabase-init.sql` |
| Charts | Recharts 3 | Reports |
| Barcodes | `@zxing/library` (`BrowserMultiFormatReader`) | Camera scanning |
| PDF | jsPDF | Receipts, labels, reports |
| Icons | lucide-react | UI |
| PWA | Custom service worker + Web Manifest | `public/sw.js`, `public/manifest.json` |

**Declared but unused in `src/` (as of this doc):** `react-router-dom`, `html2canvas`, `dexie-react-hooks`, `@zxing/browser`.

---

## 4. Repository Structure

```text
/
├── index.html                 # SPA shell, PWA/iOS meta
├── package.json               # Scripts & dependencies
├── vite.config.ts             # React + Tailwind + singlefile; alias `@` → `src`
├── tsconfig.json              # Strict TS; paths `@/*`
├── supabase-init.sql          # Cloud Postgres schema, RLS, triggers
├── README.md                  # Product overview / quick start
├── SYSTEM_DOCUMENTATION.md    # This document
├── public/
│   ├── manifest.json          # PWA manifest
│   ├── sw.js                  # Service worker (cache `adimat-v1`)
│   ├── splash.html
│   └── icons / logo assets
└── src/
    ├── main.tsx               # Entry: register SW, mount React
    ├── App.tsx                # Auth gate + page switcher
    ├── index.css              # Global theme / mobile layout
    ├── vite-env.d.ts          # Env typings
    ├── components/            # Modals, scanner, nav, checkout
    ├── lib/                   # Domain logic (DB, sync, payments, hardware)
    ├── pages/                 # Full screens
    ├── store/                 # Zustand stores
    ├── types/                 # Web Bluetooth typings
    └── utils/cn.ts            # className helper
```

---

## 5. Application Architecture

### 5.1 Bootstrap and navigation

Entry: `index.html` → `src/main.tsx` → `<App />`.

`App.tsx` flow:

1. `useAuthStore.initialize()` — detect store / session readiness  
2. `initAutoSync()` — start background sync if Supabase is configured  
3. Gate screens:
   - Loading splash
   - `StoreSetupPage` if no local store
   - `LoginPage` if store exists but user not authenticated
   - Main shell otherwise
4. Main navigation is **in-memory page state**, not URL routing. Owners land on Home; cashiers are forced to POS.
5. Owners can open Home, POS, inventory, purchasing, reports, and settings.

> Note: Manifest shortcut `/?page=pos` is not currently read by `App.tsx`.

### 5.2 Layering

| Layer | Responsibility | Key files |
|-------|----------------|-----------|
| Pages | Screen composition | `src/pages/*` |
| Components | Reusable overlays/modals | `src/components/*` |
| Stores | Auth session + cart UX state | `src/store/*` |
| Lib / domain | Persistence, sync, payments, hardware, analytics | `src/lib/*` |
| Browser storage | IndexedDB + localStorage/sessionStorage | Dexie + keys below |

### 5.3 Multi-tenancy model

Logical isolation is by **`store_id`**:

- Every user, product, transaction, line item, and expense belongs to a store
- Active store is tracked in Dexie `app_config` (`id = 'main'`, field `current_store_id`)
- Cloud restore clears local business tables and pulls one store’s dataset

One browser profile typically holds one active store at a time.

---

## 6. Screens and User Flows

### 6.1 Screen map

| Screen | Component | Access |
|--------|-----------|--------|
| Store setup / restore | `StoreSetupPage` | No local store |
| Login | `LoginPage` | Store present, unauthenticated |
| Home dashboard | `OwnerHomePage` | Owner |
| POS | `POSPage` | Owner + cashier |
| Inventory | `InventoryPage` | Owner (nav) |
| Purchasing | `PurchasingPage` | Owner (nav) |
| Reports | `ReportsPage` | Owner (nav) |
| Settings | `SettingsPage` | Owner (nav) |

### 6.2 First-time setup

1. Choose **Create store** or **Restore from cloud**
2. Create: store name → owner name → 4-digit PIN → local store + owner user created
3. Restore: enter Store ID + owner PIN → local tables wiped → pull from Supabase → set current store

Default store settings on create:

- `discount_cap_percentage = 10`
- `pin_on_discount_enabled = 1` (true)
- `session_timeout_minutes = 5` (idle PIN lock; 0 = never)

### 6.3 Authentication

- Account 4-digit PINs use PBKDF2-SHA-256 (600,000 iterations, per-PIN random salt); successful login upgrades legacy `hashPin()` values.
- After five incorrect local PIN attempts, account PIN login and owner-PIN checks are locked for 5 minutes. This IndexedDB/device lockout is not server-enforced and can be cleared with browser data.
- Optional WebAuthn biometric: credential id + `userId` in `localStorage` key `adimat_biometric_credential`
- Signed-in user is persisted in IndexedDB (`app_config.current_user_id`) so a refresh stays on the till unless idle timeout has elapsed
- Roles:
  - **owner** — full navigation and admin actions
  - **cashier** — POS + switch user; settings/inventory/reports hidden in nav; Cash Book only if the owner enabled **Can open cash book**

### 6.4 POS / checkout

1. Scan barcode (ZXing, prefers rear camera, debounce ~2s) or search/manual entry. Search supports typo-tolerant product names, partial barcode matches, recent/frequently sold ranking, and browser-supported speech input.
2. Cart quantity with stock validation + scan beeps (`scanBeep.ts`)  
3. Checkout overlay steps: payment method → discount → optional owner PIN → payment details → processing → success
4. Payment methods: `cash` | `paystack` | `split` | manual MTN/Telecel/AirtelTigo MoMo | bank transfer | card terminal | `credit` | `wallet`. Manual methods record a required reference offline; they do not initiate a provider payment. Credit sales require a registered customer and store the outstanding balance. Owners record cash, MoMo, cheque, or split account repayments in Customers; payments apply to the oldest outstanding debt, and a receipt records the paid amount and resulting balance. Customer wallet credit can pay a full sale or combine with cash. Manual collections are kept separate from Paystack payout totals.
5. Cashiers can hold a cart and resume it later in the same POS session. Resuming another held sale holds the active cart automatically.
6. On success: stock deducted locally, receipt `#ADM-YYYYMMDD-XXXX`, optional Bluetooth print, PDF/share/WhatsApp, auto-sync trigger

### 6.5 Inventory (owner)

- Product CRUD with store-specific categories; owners can add, rename, and delete categories. Renaming updates products, and deleting moves assigned products to Other.
- Loading skeleton and guided empty/error states
- Activate/deactivate products
- Stock adjust: set / add / subtract (UI collects reason; reason is **not persisted**)
- CSV import
- Barcode label print or PDF
- Dashboard: SKUs, out of stock, low stock (`stock_level < 5`), inventory value
- Auto-refresh ~30s

### 6.6 Reports (owner)

- Periods: today / week / month
- Loading, retryable error, and no-data states
- Tabs: overview / products / expenses
- Revenue cash vs non-cash (online and manual), 7-day chart, top/slow movers, category & cashier stats
- Net profit ≈ revenue − COGS − expenses
- Expense categories: Rent, Utilities, Supplier, Salaries, Transport, Other
- Expenses support receipt photos, recurring monthly templates, and monthly category budgets with over-budget warnings. Due recurring expenses are generated idempotently when the app is active or the Expenses screen is opened.
- Export CSV / PDF

### 6.7 Owner home

The owner landing screen summarizes today's completed sales, cash and non-cash payment amounts, and low-stock count. Quick actions open New Sale, Add Product, and Add Expense. Cashiers continue to land directly on POS.

### 6.8 Settings (owner)

- Store profile (name, address, support number)
- Discount cap + PIN-on-discount toggle
- Change PIN, biometrics
- Automatic session timeout (idle minutes before the PIN screen; default 5, or Never)
- Staff add / delete / reset PIN
- Bluetooth printer connect/disconnect
- Display Store ID
- Auto-sync toggle + manual push / pull / full sync

---

## 7. Data Model

### 7.1 Local database (Dexie)

**Database name:** `AdimatPOS`  
**Schema versions:** v2 base tables; v8 adds cash book, warehouse, supplier/purchasing, and backup snapshot tables; v9 adds expense workflows; v10 adds local PIN lockout storage; v12 adds product categories; v13 adds credit payment history; v14 adds the customer book; v15 adds customer-linked credit sales; v16 adds account payment receipts and sales returns
**Module:** `src/lib/dexie.ts`

| Table | Primary key | Notable indexes / fields |
|-------|-------------|--------------------------|
| `stores` | `id` | name, address, support_number, discount_cap_percentage, pin_on_discount_enabled (0/1), created_at, synced |
| `users` | `id` | store_id, name, role (`owner`\|`cashier`), pin_hash, is_active (0/1), can_access_cashbook, created_at, synced |
| `products` | `id` | store_id, name, category, sku_type, barcode, cost_price, selling_price, stock_level, is_active, created_at, updated_at, synced |
| `product_categories` | `id` | store_id, name, is_active, created_at, updated_at, synced |
| `transactions` | `id` | store_id, receipt_number, cashier_id/name, totals, payment_method, cash/paystack amounts, customer details, credit paid/balance, status, created_at, synced |
| `transaction_items` | `id` | store_id, transaction_id, product_id, product_name, quantity, unit_price, subtotal, synced |
| `customers` | `id` | store_id, name, phone, opening balance and remaining balance, wallet balance, is_active, timestamps |
| `customer_opening_payments` | `id` | store_id, customer_id, entry_type, amount, tender breakdown, optional account receipt, created_at, synced |
| `customer_account_receipts` | `id` | store_id, customer_id, receipt_number, amount, cash/MoMo/cheque amounts, balance before/after, created_at, synced |
| `customer_wallet_transactions` | `id` | store_id, customer_id, return credit or sale debit, amount, balance after, source reference, created_at, synced |
| `credit_payments` | `id` | store_id, customer_id, transaction_id, account receipt, amount, tender breakdown, created_at, synced |
| `sales_returns` | `id` | store_id, transaction/item/product, returned and restocked quantities, reason, refund method and amount, debt/wallet allocation, optional photo data URL, location, created_at, synced |
| `expenses` | `id` | store_id, description, category, amount, notes, receipt image, recurring template/month, created_at, updated_at, synced |
| `cash_book_entries` | `id` | store_id, entry_type, category, Cash/Bank account, amount, entry_date, created_at, synced |
| `recurring_expenses` | `id` | store_id, category, amount, due_day, is_active, synced |
| `expense_budgets` | `id` | store_id, category, monthly_limit, synced |
| `pin_attempts` | `store_id` | failed_attempts, locked_until, updated_at; local-only account PIN lockout state |
| `suppliers` | `id` | store_id, contact details, is_active, created_at, synced |
| `purchase_orders` | `id` | store_id, supplier_id, order_number, status, `items_json` (ordered/received quantities and unit costs), totals, timestamps, synced |
| `backup_snapshots` | `id` | store_id, created_at, `data_json` (daily local store backup; up to seven retained) |
| `sync_meta` | `id` | `last_sync` → `last_synced_at` |
| `app_config` | `id` (`main`) | current_store_id, current_user_id |

Booleans are stored as integers `0|1` locally and mapped to real booleans when syncing.

**Helpers:**

- `generateId()` — UUID v4  
- `generateReceiptNumber()` — `#ADM-YYYYMMDD-XXXX` (random 4-digit seq)  
- `hashUserPin(pin)` — PBKDF2-SHA-256 account PIN hash; successful auth upgrades older hashes
- `hashPin(pin)` — legacy helper still used for warehouse access PINs

### 7.2 Cloud database (Supabase / PostgreSQL)

**Script:** `supabase-init.sql`

Tables mirror local entities: `stores`, `users`, `products`, `transactions`, `transaction_items`, `expenses`.

Additional server behavior:

- `updated_at` triggers on stores, users, products, expenses
- Unique index on `(store_id, receipt_number)`
- Trigger `auto_deduct_stock` on `transaction_items` INSERT (server-side stock deduction; client also deducts locally)
- `stores.transactions_cleared_at` — super-admin trial-sales wipe; devices drop local ledger rows at or before this timestamp on sync

### 7.3 Entity relationships

```text
stores 1──* users
stores 1──* products
stores 1──* transactions 1──* transaction_items (*──? products)
stores 1──* expenses
stores 1──* suppliers 1──* purchase_orders
```

Products also have `reorder_level` (0 disables configurable restock suggestions). Receiving a purchase order adds stock batches and stock-movement records, and updates product cost price to the order’s unit cost.

---

## 8. Sync Architecture

**Modules:** `src/lib/sync.ts`, sync helpers in `src/lib/dexie.ts`

### 8.1 Sync flags

Local rows carry `synced: 0 | 1`. Unsynced rows are candidates for push.

### 8.2 Modes

| Mode | Behavior |
|------|----------|
| Push | Upsert local unsynced rows to Supabase by `id` |
| Pull | Select remote rows for current `store_id`; merge products/expenses by `updated_at` when local is unsynced |
| Bidirectional | Pull, then push |
| Restore | Wipe local business data, pull store dataset, set current store |

### 8.3 Auto-sync

| Trigger | Detail |
|---------|--------|
| Interval | Every 3 minutes |
| Online event | When browser comes online |
| Startup | On app init |
| After sale | `triggerAutoSync('sale')` |
| Debounce | Auto reason skipped if last auto sync < 30s ago |
| Toggle | `localStorage` key `adimat_auto_sync` (`'false'` disables; default enabled) |

Requires: Supabase configured + `navigator.onLine` + auto-sync enabled + no sync already in progress.

### 8.4 Configuration detection

Supabase is considered configured when URL/key env vars are present and the anon key length is > 20 (`src/lib/supabase.ts`). Without configuration the app remains fully local.

### 8.5 Purchasing and inventory history

`src/lib/purchasing.ts` validates supplier/order ownership and line quantities. Receipts are processed in a Dexie transaction, support partial quantities, create stock batches and `stock_movements` entries, and update product cost. Open orders may be cancelled; received orders cannot be cancelled or received again. Owners set product reorder levels in the product editor. Inventory suggestions flag stock at/below a positive reorder level and target twice that level.

The Inventory stock-audit view pulls cloud `stock_movements` when configured, displays the latest 500 local/cloud records, and exports all locally available movements to CSV. Audit notes include receiving/adjustment context; older activity is not retroactively reconstructable.

### 8.6 Store backups and sync health

Authenticated app sessions attempt a daily, store-scoped IndexedDB snapshot and retain up to seven snapshots in `backup_snapshots`. Settings supports full JSON download, latest-snapshot download, and local restore. Snapshot failures are logged and exposed in Settings. The sync-health panel counts unsynced business rows and shows the last successful sync and recorded sync error. Sync and backup issue text is stored in browser `localStorage`.

Snapshots are on-device only and cannot protect against device loss, browser-data clearing, or storage failure. Download backups to a separate secure location. Exported backups include user rows and therefore PIN hashes; treat them as sensitive credentials. Backups over 50 MB are rejected. Restore replaces local data for the selected store on that device; rows marked unsynced in the backup may be uploaded on the next cloud sync, while synced local rows can be reconciled with the cloud copy.

---

## 9. Authentication, Authorization, and Client Security

### 9.1 Auth model

- **Not** Supabase Auth sessions (`persistSession: false` on client)
- Local PIN verification against Dexie `users.pin_hash`
- Owner PIN re-check for discounts above configured cap (when PIN-on-discount enabled)
- Biometric credential maps to a local user id (no server attestation path)

### 9.2 Authorization

| Action | Owner | Cashier |
|--------|-------|---------|
| POS sales | Yes | Yes |
| Inventory / reports / settings UI | Yes | No (nav hidden; client-only gate) |
| Staff management | Yes | No |
| Sync controls | Yes | No |
| Discount above cap | Requires owner PIN when enabled | Requires owner PIN when enabled |

### 9.3 Security considerations (current behavior)

Documented as implemented today:

1. Account PINs are hashed locally with PBKDF2-SHA-256; the lockout is device-local and can be bypassed by clearing browser data. Warehouse access PINs still use the legacy `hashPin()` helper.
2. Supabase RLS is enabled, but policies are open (`USING (true)` / `WITH CHECK (true)`), so the anon key can read/write all tables.
3. Anon key and Paystack public key ship in the client bundle (expected for public keys; RLS must enforce tenancy for real multi-tenant security).
4. Role restrictions are enforced in the UI, not by a server authority.
5. Cloud restore still relies on Store ID plus owner PIN; it does not yet have independent server-side authorization.
6. Session is restored from IndexedDB `app_config.current_user_id` on refresh; idle timeout (see 9.4) refuses that restore when the till has been inactive too long.
7. Biometric unlock does not re-verify PIN against a remote identity provider.

Server-side RLS and stronger cloud-restore authorization are deferred. Operators deploying multi-tenant cloud sync should harden both before production exposure.

### 9.4 Automatic session timeout

Store owners set **Settings → Security → Automatic session timeout** (`stores.session_timeout_minutes`). Options: Never, 1, 2, 5 (default), 10, 15, or 30 minutes.

- `SessionTimeoutGuard` watches pointer, key, touch, click, and wheel activity (barcode HID scans usually count as `keydown`)
- Last activity is stored per store in `localStorage` key `adimat_last_activity_{storeId}` so a refresh cannot restore a stale signed-in user
- 30 seconds before lock, a warning overlay offers **Stay signed in**
- On lock: cart is cleared, `current_user_id` is cleared, and the PIN screen shows an inactivity message (`adimat_idle_lock` in sessionStorage)
- Super-admin portal sessions are not affected

---

## 10. Integrations

### 10.1 Paystack

- Script: `https://js.paystack.co/v1/inline.js`
- Public key env: `VITE_PAYSTACK_PUBLIC_KEY` (must start with `pk_`)
- Amounts: GHS × 100 (pesewas)
- Channels: mobile_money, card, bank, ussd, qr
- Fallback customer email pattern: `customer+{ref}@adimatpos.com`
- Rejects placeholder email domains such as `.pos` / `.local` / `.test`

### 10.2 Bluetooth thermal printing

- Module: `src/lib/bluetoothPrinter.ts`
- Web Bluetooth GATT service UUID `000018f0-...`, characteristic `00002af1-...`
- Payload chunking (~100 bytes)
- ESC/POS receipts; barcode labels via `barcodeLabels.ts` (Code128)
- Connection is in-memory for the session (reconnect from Settings as needed)
- Receipts include the Adimat company logo and services contact.
- When no Bluetooth printer is connected, checkout and receipt reprints open the computer's native print dialog so a system printer can be selected.
- Unattended Windows printing can use Chrome's `--kiosk-printing` launch flag and the Windows default printer. This is computer/browser configuration, not an app setting. Android Chrome retains the system print UI unless deployed in a managed kiosk/native printing environment.

### 10.3 Barcode scanning

- Module: `src/components/BarcodeScanner.tsx` (+ product add flow)
- Library: `@zxing/library`
- Prefers rear camera; supports common 1D/2D formats (EAN, UPC, Code 128/39/93, QR, etc.)

### 10.4 Biometrics

- Module: `src/lib/biometric.ts`
- Platform authenticator via WebAuthn
- Credential metadata stored in `localStorage`

### 10.5 Receipts & sharing

- Module: `src/lib/receiptGenerator.ts`
- PDF generation (jsPDF), text share, WhatsApp deep link, ESC/POS printing over Bluetooth, or computer-printer selection from the browser print dialog when Bluetooth is disconnected. Standard web pages cannot save a printer destination or suppress the dialog; unattended printing requires supported kiosk/browser configuration.

---

## 11. Configuration Reference

### 11.1 Environment variables

Create `.env` at repo root (gitignored):

| Variable | Required for | Description |
|----------|--------------|-------------|
| `VITE_SUPABASE_URL` | Cloud sync / restore | Project URL (normalized; placeholder if missing) |
| `VITE_SUPABASE_ANON_KEY` | Cloud sync / restore | Anon/public key |
| `VITE_PAYSTACK_PUBLIC_KEY` | Card/MoMo checkout | Public key (`pk_...`) |

Typed in `src/vite-env.d.ts`. App runs offline without them.

### 11.2 Browser storage keys

| Key | Storage | Purpose |
|-----|---------|---------|
| `adimat_auto_sync` | localStorage | Auto-sync enable/disable |
| `adimat_last_sync_error` | localStorage | Most recent recorded sync issue |
| `adimat_backup_error` | localStorage | Most recent automatic backup issue |
| `adimat_biometric_credential` | localStorage | WebAuthn credential + userId |
| `adimat_last_activity_{storeId}` | localStorage | Last till activity (idle timeout) |
| `adimat_idle_lock` | sessionStorage | PIN-screen notice after idle lock |
| `pwa-banner-dismissed` | sessionStorage | Install banner dismissal |

### 11.3 Theme tokens

Primary brand green `#065f46` (also PWA `theme_color`), amber accent, mobile safe-area styles in `src/index.css`.

---

## 12. PWA and Offline Behavior

| Item | Detail |
|------|--------|
| Manifest | `public/manifest.json` — name Adimat POS, portrait, standalone |
| Service worker | `public/sw.js` — cache name `adimat-v1`, network-first |
| Registration | `src/main.tsx` on load |
| Install UX | `PWAInstallBanner` — Android `beforeinstallprompt`, iOS Safari instructions |
| Offline data | Full business data in IndexedDB; UI shell cached by SW after first load |
| iOS install | Safari → Share → Add to Home Screen |

---

## 13. Build, Run, and Deploy

### 13.1 Prerequisites

- Node.js 18+
- npm

### 13.2 Development

```bash
npm install
npm run dev
```

### 13.3 Production build

```bash
npm run build      # vite build → single-file dist via vite-plugin-singlefile
npm run preview
```

### 13.4 Supabase setup

1. Create a Supabase project  
2. Run `supabase-init.sql` in the SQL Editor  
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`  
4. Optionally harden RLS before multi-tenant production use  

For an existing cloud project, run `supabase-migrate-purchasing-reorder.sql` before syncing reorder levels, suppliers, or purchase orders. Run `supabase-migrate-expense-workflows.sql` in the Supabase SQL Editor before syncing receipt photos, recurring expenses, or category budgets; it creates the required tables and requests a PostgREST schema-cache refresh. If sync still reports `PGRST205`, verify both tables exist in the `public` schema and rerun the migration. Run `supabase-migrate-manual-payments.sql` before syncing manually recorded payment methods, `supabase-migrate-credit-sales-bank-categories.sql` before syncing credit sales, product categories, or Cash/Bank cash-book entries, and then `supabase-migrate-customers-book.sql` before syncing registered customers, opening balances, or customer-linked credit sales. The customer migration links existing credit sales to registered customers where customer details were recorded. Apply `supabase-migrate-customer-repayments-returns.sql` after the customer-book migration before syncing consolidated repayment receipts or sale returns.

### 13.5 Hosting

Deploy `dist` to any static host (Vercel recommended in README): Netlify, Cloudflare Pages, GitHub Pages, S3 + CloudFront, etc. Configure the same `VITE_*` env vars in the host dashboard.

### 13.6 Scripts currently defined

| Script | Command |
|--------|---------|
| `dev` | `vite` |
| `build` | `vite build` |
| `preview` | `vite preview` |

No lint/test/CI scripts are present in-repo.

---

## 14. Module Reference

### 14.1 Pages

| File | Purpose |
|------|---------|
| `src/pages/StoreSetupPage.tsx` | Create store or restore from cloud |
| `src/pages/LoginPage.tsx` | PIN / biometric login |
| `src/pages/OwnerHomePage.tsx` | Owner sales/stock dashboard and quick actions |
| `src/pages/POSPage.tsx` | Selling surface |
| `src/pages/InventoryPage.tsx` | Catalog & stock ops |
| `src/pages/PurchasingPage.tsx` | Supplier records and purchase-order receiving |
| `src/pages/ReportsPage.tsx` | Analytics & expenses |
| `src/pages/SettingsPage.tsx` | Store, staff, printer, sync |

### 14.2 Components

| File | Purpose |
|------|---------|
| `AddProduct.tsx` | Product create/edit |
| `BarcodeScanner.tsx` | Camera scanner overlay |
| `BottomNav.tsx` | Role-aware navigation |
| `CheckoutOverlay.tsx` | Multi-step checkout |
| `CsvImportModal.tsx` | Bulk product import |
| `StockAdjustment.tsx` | Manual stock changes |
| `InventoryInsights.tsx` | Restock suggestions and stock movement audit/export |
| `BackupSyncTools.tsx` | Local backups, restore, and sync-health status |
| `ChangePinModal.tsx` / `ResetUserPinModal.tsx` | PIN management |
| `PWAInstallBanner.tsx` | Install guidance |

### 14.3 Libraries

| File | Purpose |
|------|---------|
| `dexie.ts` | Schema, CRUD, receipt/id helpers, push/pull/restore |
| `purchasing.ts` | Supplier and purchase-order validation/receipt workflow |
| `storeBackup.ts` | Store-scoped export/restore, daily snapshots, sync-health counts |
| `sync.ts` | Auto-sync scheduler & triggers |
| `supabase.ts` | Client init & configuration checks |
| `paystack.ts` | Inline payment wrapper |
| `receiptGenerator.ts` | PDF/text/WhatsApp receipts |
| `bluetoothPrinter.ts` | ESC/POS Bluetooth I/O |
| `barcodeLabels.ts` | Label generation / print helpers |
| `biometric.ts` | WebAuthn helpers |
| `csvImport.ts` | CSV parsing/import |
| `reportAnalytics.ts` | Aggregations for reports |
| `adminPortal.ts` | Super-admin cloud dashboard, grants, store wipe |
| `storeLedgerClear.ts` | Apply `transactions_cleared_at` locally so trial sales cannot re-sync |
| `scanBeep.ts` | Success/fail audio feedback |

### 14.4 Stores

| File | Purpose |
|------|---------|
| `useAuthStore.ts` | Initialize, login/logout, current user/store |
| `useCartStore.ts` | Cart lines, checkout orchestration, post-sale sync |

---

## 15. Operational Runbooks

### 15.1 New store on a device

1. Open app → Create store → owner PIN  
2. Settings → complete profile, discount rules, staff  
3. Inventory → add products (or CSV import), set reorder levels as needed
4. Optional: Purchasing → add suppliers and create purchase orders
5. Optional: connect printer, enable biometrics, configure Supabase env + sync

### 15.2 Move store to another device

1. Ensure source device has synced (Settings → full sync)  
2. On new device: Store setup → Restore → Store ID + owner PIN  
3. Verify products/users/transactions pulled  
4. Download a separate backup from **Settings → Backup & sync health** for device-loss protection

### 15.3 Offline selling day

1. App already installed / previously loaded  
2. Sell as normal (cash works fully offline)  
3. Paystack requires connectivity  
4. When online again, auto-sync (if enabled) or manual sync  

### 15.4 Cashier shift

1. Login with cashier PIN  
2. POS only  
3. Switch user / logout from POS controls when shift ends  

### 15.5 Clear trial sales (platform admin)

After a store has practised on Adimat, the super-admin can reset that store’s trading history without deleting the shop:

1. Open **Administrator portal → Stores → tap the store**  
2. Under **Clear trial sales**, type the store name and confirm  
3. Cloud sales, expenses, cash book, and payout records for that store are deleted; `stores.transactions_cleared_at` is stamped  
4. Ask the store to **sync** (Settings → full sync), then close and reopen **Sales** / **Reports**. The device drops local copies that are gone from the cloud (already-synced trial sales) and any unsynced rows from before the wipe.  
5. Products, staff, inventory, and subscriptions are not removed. If the phone still shows old sales, update the app (pull to refresh the PWA) and sync again. 

If the cloud project predates this column, run `supabase-migrate-clear-store-ledger.sql`.

---

## 16. Browser and Hardware Support

| Capability | Support notes |
|------------|---------------|
| Chrome / Edge (Android & desktop) | Full feature set expected |
| Safari iOS/macOS | PWA install via Safari; limited/no Web Bluetooth |
| Firefox | Limited — no Web Bluetooth |
| Camera scanning | Requires permission + adequate lighting |
| Thermal printers | ESC/POS Bluetooth printers exposing service `000018f0-...` (commonly 58mm generics) |

---

## 17. Known Gaps and Implementation Notes

These are important for maintainers; several differ from older README claims:

1. Navigation is state-based; `react-router-dom` is unused  
2. Barcode stack is ZXing, not the BarcodeDetector API  
3. Features beyond the original README include expenses, CSV import, bidirectional/auto sync, cloud restore, WhatsApp receipts, barcode labels, scan beeps  
4. Owner PIN is chosen at setup (not a global hardcoded `1234`)  
5. Low-stock threshold is hardcoded at `< 5`  
6. Stock adjustment reason is collected in UI but not stored  
7. Build output is a single HTML file via `vite-plugin-singlefile`  
8. No automated tests or CI workflows in-repo  
9. Open Supabase RLS policies are unsuitable for untrusted multi-tenant production without hardening  
10. Manifest screenshot / splash assets referenced may not all exist on disk  

---

## 18. Glossary

| Term | Meaning |
|------|---------|
| Store | A business tenant (shop) with isolated catalog, staff, and sales |
| Owner | Role with admin access to inventory, reports, settings |
| Cashier | Role limited to POS selling |
| Synced flag | Local `0/1` marker indicating whether a row has been pushed |
| Split payment | Checkout combining cash + Paystack portions |
| Pesewa | Paystack subunit; `amount = GHS * 100` |
| ESC/POS | Common thermal printer command language |

---

## 19. Quick Reference Card

```text
Local DB:     IndexedDB / Dexie → AdimatPOS
Cloud DB:     Supabase Postgres (optional)
Auth:         Local 4-digit PIN (+ optional WebAuthn)
Payments:     Cash | Paystack | Split
Receipts:     #ADM-YYYYMMDD-XXXX
Sync:         Pull then push; auto every 3m / online / after sale
Deploy:       npm run build → static host dist/
Env:          VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_PAYSTACK_PUBLIC_KEY
```

---

**End of system documentation.**  
For quick start and marketing-oriented feature lists, see `README.md`. For authoritative cloud DDL, see `supabase-init.sql`.
