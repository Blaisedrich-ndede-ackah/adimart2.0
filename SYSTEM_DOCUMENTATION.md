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
| POS | Scan/search products, cart, stock checks, cash / Paystack / split checkout, discounts with owner PIN gate, PDF/WhatsApp receipts, Bluetooth print |
| Inventory | Product CRUD, categories, stock adjust, CSV import, barcode labels, low/out-of-stock views |
| Reports | Period filters, revenue mix, charts, product performance, expenses, net profit, CSV/PDF export |
| Staff & security | Owner/cashier roles, 4-digit PIN auth, biometric unlock, discount authorization |
| Ops | Store setup or cloud restore, bidirectional/auto sync, PWA install + offline shell |

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
4. Main navigation is **in-memory page state** (`pos` | `inventory` | `reports` | `settings`), not URL routing
5. Cashiers are forced to `pos`; owner-only items appear in `BottomNav`

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
| POS | `POSPage` | Owner + cashier |
| Inventory | `InventoryPage` | Owner (nav) |
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

- 4-digit PIN → `hashPin()` → match active user in current store
- Optional WebAuthn biometric: credential id + `userId` in `localStorage` key `adimat_biometric_credential`
- Signed-in user is persisted in IndexedDB (`app_config.current_user_id`) so a refresh stays on the till unless idle timeout has elapsed
- Roles:
  - **owner** — full navigation and admin actions
  - **cashier** — POS + switch user; settings/inventory/reports hidden in nav; Cash Book only if the owner enabled **Can open cash book**

### 6.4 POS / checkout

1. Scan barcode (ZXing, prefers rear camera, debounce ~2s) or search/manual entry  
2. Cart quantity with stock validation + scan beeps (`scanBeep.ts`)  
3. Checkout overlay steps: payment method → discount → optional owner PIN → split/Paystack → processing → success  
4. Payment methods: `cash` | `paystack` | `split`  
5. On success: stock deducted locally, receipt `#ADM-YYYYMMDD-XXXX`, optional Bluetooth print, PDF/share/WhatsApp, auto-sync trigger

### 6.5 Inventory (owner)

- Product CRUD with categories: Food, Beverages, Dairy, Household, Electronics, Clothing, Health, Other
- Activate/deactivate products
- Stock adjust: set / add / subtract (UI collects reason; reason is **not persisted**)
- CSV import
- Barcode label print or PDF
- Dashboard: SKUs, out of stock, low stock (`stock_level < 5`), inventory value
- Auto-refresh ~30s

### 6.6 Reports (owner)

- Periods: today / week / month
- Tabs: overview / products / expenses
- Revenue cash vs Paystack, 7-day chart, top/slow movers, category & cashier stats
- Net profit ≈ revenue − COGS − expenses
- Expense categories: Rent, Utilities, Supplier, Salaries, Transport, Other
- Export CSV / PDF

### 6.7 Settings (owner)

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
**Schema versions:** v2 base tables; v3 adds `expenses`  
**Module:** `src/lib/dexie.ts`

| Table | Primary key | Notable indexes / fields |
|-------|-------------|--------------------------|
| `stores` | `id` | name, address, support_number, discount_cap_percentage, pin_on_discount_enabled (0/1), created_at, synced |
| `users` | `id` | store_id, name, role (`owner`\|`cashier`), pin_hash, is_active (0/1), can_access_cashbook, created_at, synced |
| `products` | `id` | store_id, name, category, sku_type, barcode, cost_price, selling_price, stock_level, is_active, created_at, updated_at, synced |
| `transactions` | `id` | store_id, receipt_number, cashier_id/name, totals, payment_method, cash/paystack amounts, paystack_reference, status, created_at, synced |
| `transaction_items` | `id` | store_id, transaction_id, product_id, product_name, quantity, unit_price, subtotal, synced |
| `expenses` | `id` | store_id, description, category, amount, notes, created_at, updated_at, synced |
| `sync_meta` | `id` | `last_sync` → `last_synced_at` |
| `app_config` | `id` (`main`) | current_store_id, current_user_id |

Booleans are stored as integers `0|1` locally and mapped to real booleans when syncing.

**Helpers:**

- `generateId()` — UUID v4  
- `generateReceiptNumber()` — `#ADM-YYYYMMDD-XXXX` (random 4-digit seq)  
- `hashPin(pin)` — salted string hash → base36 (client-side; not bcrypt/argon2)

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
```

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

1. PIN hashing is a lightweight client hash — suitable for local UX friction, not high-assurance secret storage  
2. Supabase RLS is enabled, but policies are open (`USING (true)` / `WITH CHECK (true)`), so the anon key can read/write all tables  
3. Anon key and Paystack public key ship in the client bundle (expected for public keys; RLS must enforce tenancy for real multi-tenant security)  
4. Role restrictions are enforced in the UI, not by a server authority  
5. Session is restored from IndexedDB `app_config.current_user_id` on refresh; idle timeout (see 9.4) refuses that restore when the till has been inactive too long  
6. Biometric unlock does not re-verify PIN against a remote identity provider  

Operators deploying multi-tenant cloud sync should harden RLS before production exposure.

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
- PDF generation (jsPDF), text share, WhatsApp deep link, optional auto-print when Bluetooth connected

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
| `src/pages/POSPage.tsx` | Selling surface |
| `src/pages/InventoryPage.tsx` | Catalog & stock ops |
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
| `ChangePinModal.tsx` / `ResetUserPinModal.tsx` | PIN management |
| `PWAInstallBanner.tsx` | Install guidance |

### 14.3 Libraries

| File | Purpose |
|------|---------|
| `dexie.ts` | Schema, CRUD, receipt/id helpers, push/pull/restore |
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
3. Inventory → add products (or CSV import)  
4. Optional: connect printer, enable biometrics, configure Supabase env + sync  

### 15.2 Move store to another device

1. Ensure source device has synced (Settings → full sync)  
2. On new device: Store setup → Restore → Store ID + owner PIN  
3. Verify products/users/transactions pulled  

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
