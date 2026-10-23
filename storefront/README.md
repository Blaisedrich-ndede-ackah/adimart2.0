# BONDZTECH storefront for Adimat

This is the custom Ghana storefront. It keeps the BONDZTECH design and reads one Adimat store: products marked **Sell online**, the store name, logo, phone, and address. Checkout writes `online_orders` and `online_order_items` in the same Supabase project, so the order shows up in Adimat under **Online shop**.

Catalog and stock stay in Adimat. This app does not keep a second product database.

## Run

```bash
cd storefront
npm install
cp .env.example .env.local
npm run dev
```

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Adimat project URL, `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Adimat anon key |
| `VITE_ADIMAT_STORE_SLUG` | This store’s e-commerce slug from Adimat |
| `VITE_PAYSTACK_PUBLIC_KEY` | Optional. Cash on delivery still works without it. |
| `VITE_GEMINI_API_KEY` | Optional shopping assistant |

In Adimat, turn e-commerce on, set the same slug, and mark the products that should appear here as **Sell online**. Fulfill or cancel the order in Adimat. Stock is deducted there when the order is fulfilled.

Deploy this folder as its own site. Add the public URL in Adimat under Online shop → links if you want the POS to share it.
