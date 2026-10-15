# Learn Adimat guides

The store app provides role-specific learning:

- Signed-in store owners see owner lessons only.
- Signed-in cashiers see cashier lessons only. Cash Book and online order lessons appear only when that cashier has the relevant permission.
- Platform administrators see administrator and technical operations guidance in the authenticated Admin portal's **Learn** tab.

The owner and cashier PDF guides are generated from their matching sources:

- [Store owner guide source](./ADIMAT_STORE_OWNER_GUIDE.md)
- [Cashier guide source](./ADIMAT_CASHIER_GUIDE.md)
- [Store owner PDF](../public/guides/adimat-store-owner-guide.pdf)
- [Cashier PDF](../public/guides/adimat-cashier-guide.pdf)
- [Administrator and technical staff guide source](./ADIMAT_ADMIN_TECHNICAL_GUIDE.md)
- [Administrator and technical staff PDF](../public/guides/adimat-admin-technical-guide.pdf)

The developer and operations reference is [SYSTEM_DOCUMENTATION.md](../SYSTEM_DOCUMENTATION.md). Regenerate the downloadable PDFs with `npm run docs:pdf`.
