#  BONDZTECH — Ghana E-Commerce PWA

A production-ready, Progressive Web App (PWA) e-commerce platform built for the Ghanaian market. Features include Paystack payments (Ghana Cedis), Cash on Delivery, AI-powered chatbot, and a full admin panel.

##  Tech Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS 4
- **State Management**: Zustand (persisted cart)
- **Database**: Supabase (PostgreSQL)
- **Image Storage**: Supabase Storage Buckets
- **Auth**: Supabase Auth (admin login)
- **Payments**: Paystack (Ghana) + Cash on Delivery
- **AI Chatbot**: Google Gemini API (gemini-1.5-flash)
- **PWA**: Service Worker + manifest.json (installable)
- **Routing**: React Router v6
- **Currency**: Ghana Cedis (GHS / ₵)

---

##  Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/BONDZTECH.git
cd BONDZTECH
npm install
```

### 2. Set Up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** in your Supabase Dashboard
3. Copy the contents of `supabase/schema.sql` and run it
4. This creates all tables, RLS policies, indexes, and storage buckets

### 3. Create an Admin User

1. Go to **Authentication** > **Users** in Supabase Dashboard
2. Click **Add User** > **Create New User**
3. Enter an email and password
4. This user can log in at `/admin/login`

### 4. Create Storage Buckets

The SQL schema creates these automatically, but verify in **Storage**:
- `product-images` (set to **Public**)
- `store-assets` (set to **Public**)

### 5. Set Environment Variables

```bash
cp .env.local.example .env.local
```

Fill in the values:

| Variable | Where to Find |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Dashboard > Settings > API > Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard > Settings > API > anon/public key |
| `VITE_PAYSTACK_PUBLIC_KEY` | [Paystack Dashboard](https://dashboard.paystack.com/#/settings/developers) > API Keys |
| `VITE_GEMINI_API_KEY` | [Google AI Studio](https://makersuite.google.com/app/apikey) |
| `VITE_SITE_URL` | Your deployed URL (e.g., `https://your-store.vercel.app`) |

### 6. Get Paystack Ghana API Keys

1. Create an account at [paystack.com](https://paystack.com)
2. Select **Ghana** as your country
3. Go to **Settings** > **API Keys & Webhooks**
4. Copy your **Public Key** (`pk_live_...` or `pk_test_...`)

### 7. Get Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key
3. Copy the key — it's used for the AI chatbot

### 8. Run Locally

```bash
npm run dev
```

Visit `http://localhost:5173`

---

##  Deploy to Vercel

### Option A: Auto-deploy via GitHub

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) > **New Project**
3. Import your GitHub repo
4. Vercel will auto-detect Vite
5. Add environment variables in **Settings** > **Environment Variables**
6. Deploy!

Every `git push` to `main` will auto-deploy.

### Option B: Vercel CLI

```bash
npm i -g vercel
vercel --prod
```

### Environment Variables on Vercel

Add these in your Vercel project settings:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PAYSTACK_PUBLIC_KEY`
- `VITE_GEMINI_API_KEY`
- `VITE_SITE_URL`

---

##  PWA Features

-  **Installable** — Add to Home Screen on Android/iOS
-  **Offline support** — Cached pages work without internet
-  **Service Worker** — Network-first with cache fallback
-  **Offline page** — Friendly message when no connection
-  **Manifest** — Proper icons, theme color, orientation

---

##  Project Structure

```
src/
├── App.tsx                    # Main app with routing
├── main.tsx                   # Entry point
├── index.css                  # Tailwind + global styles
├── vite-env.d.ts              # TypeScript env types
├── components/
│   ├── Navbar.tsx             # Responsive nav + mobile bottom bar
│   ├── ProductCard.tsx        # Product card + skeleton
│   ├── ChatBot.tsx            # AI chatbot widget (Gemini)
│   ├── HeroSection.tsx        # Home page hero
│   └── AdminSidebar.tsx       # Admin navigation sidebar
├── pages/
│   ├── HomePage.tsx           # Home with featured + new products
│   ├── ProductsPage.tsx       # Product listing + search + filter
│   ├── ProductDetailPage.tsx  # Single product with image gallery
│   ├── CartPage.tsx           # Shopping cart
│   ├── CheckoutPage.tsx       # Checkout with Paystack + COD
│   └── admin/
│       ├── AdminLoginPage.tsx     # Admin login
│       ├── DashboardPage.tsx      # Dashboard overview
│       ├── AdminProductsPage.tsx  # Product CRUD + image upload
│       ├── AdminOrdersPage.tsx    # Order management
│       └── AdminSettingsPage.tsx  # Store settings
├── layouts/
│   ├── ShopLayout.tsx         # Shop layout (nav + chatbot)
│   └── AdminLayout.tsx        # Admin layout (sidebar + auth)
├── store/
│   ├── cartStore.ts           # Cart state (Zustand + persist)
│   └── authStore.ts           # Auth state (Supabase Auth)
├── lib/
│   ├── supabase.ts            # Supabase client
│   └── types.ts               # TypeScript interfaces
public/
├── manifest.json              # PWA manifest
├── sw.js                      # Service worker
├── offline.html               # Offline fallback page
├── logo-placeholder.png       # Logo placeholder
└── icons/                     # PWA icons
supabase/
└── schema.sql                 # Full database schema
```

---

##  Customization

### Replace the Logo
Update `public/logo-placeholder.png` with your store logo, or update the logo URL in Admin > Settings.

### Change Colors
The color scheme uses Tailwind's orange palette. Modify the classes in components to change to your brand colors.

### Add Categories
Edit the `CATEGORIES` array in `src/pages/admin/AdminProductsPage.tsx`.

---

##  License

MIT License. Build amazing stores! 🇬🇭
