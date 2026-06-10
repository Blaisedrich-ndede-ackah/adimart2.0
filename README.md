# Adimat POS

A mobile-first Point of Sale (POS) and inventory management Progressive Web App (PWA) designed for SMEs in Ghana.

![Adimat POS](public/logo.png)

## Features

### 🛒 Point of Sale
- **Barcode Scanning** — Camera-based scanning using ZXing library with back camera preference
- **Manual Entry** — Search products by name or enter barcodes manually
- **Real-time Cart** — Add, remove, and adjust quantities with instant totals
- **Stock Validation** — Prevents selling out-of-stock items, warns on low stock
- **Flexible Payments** — Cash, Paystack (Mobile Money/Card/QR), or split payments
- **Discount Management** — Apply discounts with optional owner PIN authorization for amounts exceeding the configured cap
- **PDF Receipts** — Generate, download, and share receipts as PDF files

### 📦 Inventory Management
- **Product Catalog** — Full CRUD operations for products with categories
- **Stock Tracking** — Automatic stock deduction on sales, low stock and out-of-stock alerts
- **Stock Adjustment** — Manually add, remove, or set stock levels with reason tracking
- **Barcode Assignment** — Scan barcodes directly when adding products
- **Profit Margin Calculator** — Auto-calculates margin based on cost and selling price
- **Dashboard Cards** — Total SKUs, out of stock count, low stock count, total inventory value
- **Auto-Refresh** — Inventory updates automatically every 30 seconds

### 📊 Reports & Analytics
- **Period Filtering** — Today, This Week, This Month views
- **Revenue Breakdown** — Cash vs Paystack isolation
- **7-Day Rolling Chart** — Visual revenue trend using bar charts
- **Transaction Register** — Chronological audit log with expandable item details

### ⚙️ Settings
- **Store Profile** — Configure store name, address, and support number
- **Discount Controls** — Set discount cap percentage and toggle PIN enforcement
- **User Management** — Add/remove cashiers and owners with 4-digit PINs
- **Thermal Printer** — Connect Bluetooth thermal printers for receipt printing
- **Cloud Sync** — Manual sync to Supabase with last-synced timestamp

### 📱 PWA & Offline Support
- **Installable** — Add to home screen on mobile devices
- **Offline-First** — All data stored locally in IndexedDB via Dexie.js
- **Background Sync** — Sync to Supabase when online
- **Mobile Optimized** — Touch-friendly targets, bottom navigation, portrait orientation

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 |
| State | Zustand |
| Local Database | Dexie.js (IndexedDB) |
| Backend | Supabase (PostgreSQL + Auth) |
| Payments | Paystack |
| Charts | Recharts |
| Barcode Scanning | BarcodeDetector API |
| Printing | Web Bluetooth API (ESC/POS) |

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd adimat-pos

# Install dependencies
npm install

# Start development server
npm run dev
```

### Environment Variables

Create a `.env` file in the root directory:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Paystack Configuration
VITE_PAYSTACK_PUBLIC_KEY=pk_live_your-public-key
```

> **Note:** The app works fully offline without Supabase configured. Cloud sync features will be disabled until credentials are provided.

### First-Time Setup

On first launch, you'll be guided through a setup wizard:

1. **Enter your store name** (e.g., "Kofi's Mini Mart")
2. **Create owner account** with your name and a 4-digit PIN
3. You're ready to go!

Each store has its own isolated data - products, users, and transactions are all scoped to your store.

### Setting Up Your Store

1. Login with the default PIN (1234)
2. Go to **Settings**
3. Fill in your store profile (name, address, phone)
4. Configure discount controls
5. Add staff members with their own PINs
6. Optionally set up biometric login
7. Connect a Bluetooth thermal printer
8. Go to **Inventory** and add your products

## Database Setup (Supabase)

1. Create a new Supabase project
2. Navigate to the SQL Editor
3. Run the contents of `supabase-init.sql` to create all tables with RLS policies

### Database Schema

| Table | Description |
|-------|-------------|
| `stores` | Business/store profiles with settings |
| `users` | Store staff linked to a store, with roles and PIN hashes |
| `products` | Product catalog linked to a store |
| `transactions` | Completed sales linked to a store |
| `transaction_items` | Line items for each transaction |

**Multi-tenant Architecture:** All data is scoped to a specific store via `store_id` foreign keys. This ensures complete data isolation between different businesses using the app.

## Building for Production

```bash
# Build the application
npm run build

# Preview the production build
npm run preview
```

The build output is a single `index.html` file in the `dist/` directory, optimized for deployment.

## Deployment

### Vercel (Recommended)

1. Connect your repository to Vercel
2. Add environment variables in the Vercel dashboard
3. Deploy

### Static Hosting

The built `dist/index.html` can be deployed to any static hosting service:

- Netlify
- GitHub Pages
- Cloudflare Pages
- AWS S3 + CloudFront

## Hardware Integration

### Barcode Scanner

The app uses the `@zxing/library` for reliable cross-browser barcode scanning. Supported formats:
- EAN-13, EAN-8
- UPC-A, UPC-E
- Code 128, Code 39, Code 93
- QR Code, Data Matrix, Aztec
- ITF, Codabar, RSS-14

**Tips for reliable scanning:**
- Ensure good lighting
- Hold the barcode steady within the scanning frame
- Keep the barcode flat and not crumpled
- The back camera is automatically selected when available

### Thermal Printer

Connect via Web Bluetooth to ESC/POS compatible thermal printers. Tested with:
- Generic 58mm Bluetooth thermal printers
- Most printers using the `000018f0-0000-1000-8000-00805f9b34fb` service UUID

To connect:
1. Go to Settings → Thermal Printer
2. Click "Connect Printer"
3. Select your printer from the Bluetooth device list

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── AddProduct.tsx
│   ├── BarcodeScanner.tsx
│   ├── BottomNav.tsx
│   ├── CheckoutOverlay.tsx
│   └── PWAInstallBanner.tsx
├── lib/                 # Core utilities
│   ├── bluetoothPrinter.ts
│   ├── dexie.ts
│   ├── paystack.ts
│   └── supabase.ts
├── pages/               # Page components
│   ├── InventoryPage.tsx
│   ├── LoginPage.tsx
│   ├── POSPage.tsx
│   ├── ReportsPage.tsx
│   └── SettingsPage.tsx
├── store/               # Zustand stores
│   ├── useAuthStore.ts
│   └── useCartStore.ts
├── types/               # TypeScript declarations
│   └── web-bluetooth.d.ts
├── App.tsx              # Main application
├── main.tsx             # Entry point
└── index.css            # Global styles
```

## Receipt Format

Receipts are generated with the format `#ADM-YYYYMMDD-XXXX`:
- `ADM` — Adimat prefix
- `YYYYMMDD` — Date
- `XXXX` — 4-digit sequential number

Example: `#ADM-20240115-0042`

## Security

- PINs are hashed before storage (not plain text)
- Row Level Security (RLS) enabled on all Supabase tables
- Discount overrides require owner PIN verification
- Role-based access control (cashiers vs owners)

## Browser Support

- Chrome 83+ (Desktop & Android)
- Edge 83+
- Safari 14.1+ (iOS & macOS)
- Firefox (limited — no Web Bluetooth)

## iOS Installation

To install on iPhone or iPad:

1. Open the app in **Safari** (required - other browsers don't support PWA installation)
2. Tap the **Share** button (square with arrow at bottom of screen)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **"Add"** in the top right corner
5. Adimat will now appear as an app on your home screen

**Note:** The app will show an install banner with step-by-step instructions when opened in Safari on iOS.

### iOS-Specific Features

- Full-screen standalone mode (no Safari UI)
- Home screen icon
- Splash screen on launch
- Works offline after first load
- Safe area support for notched devices (iPhone X and later)

## License

MIT License — see LICENSE file for details.

## Support

For issues and feature requests, please open a GitHub issue.

---

**Built with ❤️ for Ghana SMEs**
