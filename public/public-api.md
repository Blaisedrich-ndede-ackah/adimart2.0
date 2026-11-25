# Adimat Public API

Base URL: `https://YOUR-ADIMAT-DOMAIN/api/integrations`

Send the store API key in `X-API-Key`. Keys are shown only once. Keep them on a trusted server and revoke them from Adimat if exposed. Requests are limited to 120 per minute per key.

## Resources

All responses are JSON and all queries are limited to the key's store.

| Method | Query parameters | Scope | Result |
| --- | --- | --- | --- |
| `GET` | `resource=products` or `customers` or `transactions` or `stores`; optional `id`, `limit` | `<resource>:read` | `{ "data": [...] }` |
| `POST` | `resource=products` or `customers` | `<resource>:write` | Creates a record and returns `{ "data": {...} }` |
| `PUT` / `PATCH` | `resource=products` or `customers`, required `id` | `<resource>:write` | Updates allowed fields and returns `{ "data": {...} }` |
| `DELETE` | `resource=products` or `customers`, required `id` | `<resource>:write` | Deactivates the record and returns `{ "ok": true }` |

Product create/update fields: `name`, `category`, `barcode`, `selling_price`, `cost_price`, `reorder_level`, `is_active`. Stock quantity is read-only through this API so inventory changes continue through Adimat's stock ledger.

Customer create/update fields: `name`, `phone`, `location_id`, `is_active`.

Transactions and stores are read-only. `limit` defaults to 50 and is capped at 100. Unsupported write fields are ignored.

## Errors

Errors use `{ "error": "..." }`. Common status codes: `400` invalid request, `401` missing/invalid key, `403` missing scope, `404` record missing, `405` method/resource is read-only, `429` rate limit reached, and `500` server/database configuration error.

## Webhooks

Configured events are sent as JSON with `X-Adimat-Event`, `X-Adimat-Delivery`, and `X-Adimat-Signature: sha256=<hex>`. Verify the signature as HMAC-SHA256 over the exact raw request body, using the webhook secret shown once at creation. Respond with `2xx` to acknowledge delivery.

Currently emitted events: `sale.created`, `stock.low`, `order.online`, and `customer.created` when the matching event is emitted by an Adimat workflow.
