# Recent Adimat features

This short guide covers the newer customer checkout, pickup, and stock tools. Availability can depend on the store plan and administrator settings.

## Customer Scan and Pay

Customers can open a store's public **Scan and Pay** link, scan or search for products, build a cart, and pay online with Paystack. The page shows product and price details, checks stock, and provides a pickup code after checkout. The customer can download a QR pickup pass to show at the store. Orders made while offline are saved on the device and queued to sync when the connection returns; Paystack checkout itself requires an internet connection.

## Verify a pickup

At the store, staff open **Verify Pickup**, scan the customer's pass or enter its code, and confirm the order before releasing it. Codes are checked for validity and prior use, and successful releases are recorded in the pickup verification history. If an authorized exception is needed, an owner can approve an override with their PIN and a reason. Staff should verify the displayed order before handing over goods.

## Bundles

Owners can create named product bundles and set their component products and quantities. Cashiers can add a bundle from POS; checkout charges the bundle price and deducts the included quantities from stock. Review bundle contents and prices when products or costs change.

## Stock write-offs

When stock is expired, damaged, or otherwise unusable, authorized staff can record a write-off with quantity, reason, note, and optional photo. A write-off reduces available stock and appears in the dated write-off review, which can be printed or exported as CSV. The feature must be enabled for the store; cashiers also need the relevant permission.

## Digital receipts and customer display

After a sale, checkout can create a QR code for the customer to scan and save the receipt. The customer display can show the receipt QR alongside checkout information. Customers can open the receipt online and print or share it. Receipt QR availability depends on network access to publish or look up the receipt; if sync is pending, sync the store when online so the customer can access it.

## Administrator setup

The database migrations for these features are `supabase-migrate-pickup-verification.sql` and `supabase-migrate-stock-bundles-receipts.sql`. Apply the relevant migration to the Supabase project before enabling the matching features. Store-level pickup, bundle, and write-off controls are managed from the authenticated administrator portal where available.
