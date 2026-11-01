# Architecture (Phases 0–1)

## Actual stack and entry points

The application is plain JavaScript, HTML and CSS. There is no React, Next.js,
TypeScript, bundler, linter, or frontend package dependency. The root development
command starts [the static server](../scripts/serve_mobile_app.mjs) on loopback,
port 4173 by default. [index.html](../mobile-bill-app/index.html) loads
[app.js](../mobile-bill-app/app.js) and [styles.css](../mobile-bill-app/styles.css).
The manifest and service worker provide installability and asset caching.

The backend is CommonJS Express 4 with cors, dotenv, Mongoose 8, Multer 2,
express-session/connect-mongo, Helmet, express-rate-limit and Google Generative AI SDK.
[server.js](../server/server.js) loads server/.env,
validates configuration, connects MongoDB, then listens on port 5000.
[index.js](../server/index.js) re-exports that entry point. Phase 0 moves Express
assembly into [createApp](../server/app.js), which opens no connection or listener
and reads no environment files. It now requires validated security configuration
and an explicit session store. Private routes require operator authentication and CSRF.
The normal entry and production database connector reject test mode.

No deployment manifest, CI workflow, container definition,
or reverse-proxy configuration is present. Do not infer a working serverless
deployment from the index export. The Vercel suffix CORS exception was removed.

## Browser/API communication

On localhost or 127.0.0.1 the browser calls port 5000 on the same hostname; elsewhere
it calls /api on the same origin. Production therefore needs an HTTPS reverse
proxy serving the static frontend and forwarding /api to Express. Changing the
backend PORT alone does not update the browser's local API address.

| Endpoint | Purpose |
| --- | --- |
| GET /api/health | Process health, not database readiness |
| GET/POST /api/rates | List and upsert rates |
| POST /api/rates/calculate | City, state/custom-zone, region, default fallback |
| POST /api/rates/parse-pdf | In-memory PDF upload, Gemini parsing and retries |
| POST /api/invoices/save | Upsert invoice and embedded shipments |
| GET /api/invoices | Paginated listing |
| GET /api/invoices/search | Text/AWB/date search |
| GET /api/invoices/:id | ID or invoice-number lookup |

The UI uses [auth.js](../mobile-bill-app/auth.js) for cookie authentication,
memory-only CSRF tokens, login/logout and session expiry. All API fetches include
credentials and pass through this helper. The UI uses PDF parsing, reviewed-rate saves, invoice history, and invoice save.
It calculates current bills locally rather than calling /rates/calculate.

## Data ownership

| Store | Contents and lifecycle |
| --- | --- |
| localStorage `courier-bill-app-v2` | Current bill and business/customer fields, rates, shipments, uploaded logo/signature data URLs. Saved on edits; JSON export/import covers this state. New bill clears shipments and advances numbering/period. |
| MongoDB Rate | Shipper, target name/type, minimum kg, per-kg rate; compound unique key. Reviewed AI rates are saved here and locally. Ordinary local edits are not synchronized. |
| MongoDB Invoice | Unique invoice number, shipper/client details, embedded shipment snapshots, totals, tax, dates, status and notes. Save is an upsert. History reads these documents. |
| MongoDB Client | Unique shipper code, name, GST and address. Model exists; no client API in this repository. |
| MongoDB Shipment | Standalone model plus reusable embedded schema; invoice routes use embedded shipments, not standalone shipment writes. |
| MongoDB operator_sessions | Signed-cookie server sessions with hashed IDs, absolute expiry and a TTL index. No plaintext operator password. |
| Service-worker cache | Allowlisted versioned static assets only; API/auth responses are excluded. |

No automatic reconciliation connects browser drafts and database history.
Existing default data contains business/customer-like information. Tests use only
new synthetic fixtures and fresh browser contexts, never a personal browser profile.

## Billing boundaries and decisions

Browser billing uses `(baseRate + max(0, weight - baseKg) * perKgRate) * pieces`,
with manual overrides, then fuel, then separate CGST and SGST rounded to two decimals.
Backend rate calculation uses `max(weight, baseKg) * perKgRate`; its model has no
baseRate or pieces. Invoice save accepts totals from the caller or computes subtotal
and combined tax from shipment amounts. These are distinct existing contracts,
not a single authoritative calculation. Phase 0 characterizes valid inputs without
endorsing their inconsistencies or invalid-input coercion.

Tests use Node's built-in runner, Supertest, disposable MongoDB, and Playwright.
No frontend rewrite or business-data migration is included. See
[security and authentication](security-and-authentication.md) for Phase 1 design,
credential provisioning, limits, cookie/proxy configuration and remaining risks.
