# Deployment architecture and release checklist

Phase 7 release candidates use Courier SW cache v13, app.js v11, styles v6 and
browser-data v2. Deploy these together with the backend status-filter fix and shared
modules. Protocol courier-api-v1, invoice schema 2/3, calculation courier-v1, browser
vault v1 and backup format v1/schema 5 are unchanged. The strengthened static-host
example denies private paths; actual host configuration still requires validation.
See [release gates](release-readiness-checklist.md) before any production action.

## Audited requirements

The app is static HTML/CSS/plain JavaScript plus a long-lived Express process and MongoDB. There is no frontend compilation, container manifest or configured hosting provider. The production browser calls same-origin `/api`; local development calls port 5000 on the same hostname. Serve both surfaces behind one HTTPS origin. Deploy the shared browser modules with the backend: backend services import them directly.

The supported proxy arrangement is a local TLS reverse proxy forwarding to loopback Node. `TRUST_PROXY=loopback` trusts only loopback; the proxy must overwrite forwarded headers and public clients must not reach Node directly. Production cookies are Secure, HttpOnly, SameSite=Lax and use the `__Host-` name. An unrelated remote TLS load balancer is **not automatically supported** by this trust setting; validate its actual topology before deployment. Do not set unrestricted proxy trust to make cookies work.

The server now binds `127.0.0.1` by default. `BIND_HOST=0.0.0.0` is permitted only with explicit firewall/network controls. The example [Nginx configuration](../ops/nginx.example.conf) is not installed or verified on a host; real TLS paths, domain, asset path and access-log policy require review. `npm run dev` is a development static server, not a production hosting recommendation. The old index export must not be treated as a verified serverless deployment: startup now returns the long-lived runtime promise.

MongoDB-backed sessions use **operator_sessions**, with native expiry TTL. Business indexes include unique invoice number, client shipper, legacy shipper/destination/type, and invoice/rate request-ID indexes. Startup initializes required model indexes before listening. Existing duplicate records can prevent startup; investigate non-destructively, never auto-delete to make an index build pass. Absolute session expiry is enforced even before TTL cleanup. Business records have no TTL deletion.

Replica-set support is required for the consistent logical backup transaction; regular individual invoice/rate writes remain single-document atomic. The archive limit is **64 MiB**, retained rate versions **40 per shipper**, request JSON **1 MiB**, PDF **10 MiB**, and one AI upload operation per process. Use one app instance for the intended operator: in-process rate limiting and metrics are not shared across replicas.

## Environment checklist

| Variables | Requirement / handling |
| --- | --- |
| MONGO_URI | Required application database URI; provision in a secret store, never CI |
| NODE_ENV | Explicit `production` on the host; tests reserve `test` |
| ADMIN_USERNAME, ADMIN_PASSWORD_HASH | Required single operator and generated scrypt hash; no plaintext password |
| SESSION_SECRET | Required independent random base64url secret; production rejects obvious weak/test placeholders |
| BROWSER_DRAFT_KEY | Required stable independent 32-byte base64 key; production rejects obvious repeated-byte keys; keep a protected recovery copy |
| SESSION_TTL_MINUTES | 5–1440; default 480; absolute lifetime |
| ALLOWED_ORIGINS | Explicit HTTPS origins in production, no wildcard/path/trailing slash |
| TRUST_PROXY | `false` or `loopback`; match the verified proxy topology |
| PORT, BIND_HOST | Default 5000 and 127.0.0.1; frontend development still expects port 5000 |
| SHUTDOWN_TIMEOUT_MS | HTTP drain deadline 1000–30000, default 10000 |
| GEMINI_API_KEY | Optional; parsing unavailable without it |
| GEMINI_MODEL, GEMINI_TIMEOUT_MS, GEMINI_RETRIES | Optional documented model, 1000–10000ms attempt timeout, 0–2 retries; model entitlement remains staging verification |
| BACKUP_SOURCE_URI, BACKUP_SOURCE_DB | Separate explicit read-only backup source; never falls back to MONGO_URI |
| RESTORE_MONGO_URI | Explicit isolated loopback target only; no credentials/database/options |
| BACKUP_JOB_APPROVED, BACKUP_LOCAL_DIR, BACKUP_COPY_DIR, BACKUP_KEY_FILE | Operator-approved scheduler environment; not loaded automatically by the app |
| BACKUP_RETAIN_COUNT, BACKUP_MAX_AGE_HOURS, BACKUP_MIN_FREE_MB | Planning-only copy count 1–366 (default 7), age 1–168h (default 24), free-space floor at least 128 MiB (default 256) |
| MONITOR_BASE_URL, BACKUP_STATUS_FILE | Monitor HTTPS origin (loopback HTTP allowed for development) and protected job receipt location |
| TEST_DB_MODE, E2E_API_PORT | Harness-only memory databases/ports; never production configuration |

Tests reject application/test MongoDB URIs and strip secrets, NODE_OPTIONS and binary overrides. The frontend has no environment injection/bundle mechanism. BROWSER_DRAFT_KEY is intentionally delivered only to an authenticated, CSRF-validated browser request with no-store caching; it is not in static assets or logs. This design protects logged-out retained data, not an active session or compromised OS; see [privacy limits](browser-data-privacy.md).

## Coordinated rollout (operator approval required)

1. Run `npm ci`, `npm ci --prefix server`, `npm run check`, `npm run check:secrets`, `npm test`, `npm run test:coverage`, both audits and `npm run test:operations` against the exact proposed revision.
2. Complete [staging acceptance](staging-checklist.md). Confirm original/current rate semantics, key custody, actual backup capacity and index compatibility.
3. Obtain explicit production deployment/maintenance approval. Securely export browser drafts and create/verify a business archive before release. Keep the previous release and database untouched.
4. Prepare a separate versioned release directory. Configure secrets outside that directory/repository. Do not overwrite the browser encryption key or existing environment file.
5. Stop accepting writes, drain the old Node process, and deploy backend/shared modules plus matching static files as one release. Activate the approved service supervisor; the basic foreground command is `npm start --prefix server`. No supervisor/service was installed by this task.
6. Verify `/api/health/live` and `/api/health/ready`, TLS/cookies/login/logout/CSRF, exact allowed origin and no private API caching. A public readiness response reveals only ready/unavailable.
7. Reload the browser and check service-worker activation. Phase 6 uses cache v12 and auth asset v5. Only obsolete Courier caches are removed; unrelated origin caches are retained. Open tabs should complete or export drafts and refresh before writes.
8. Run an approved non-customer staging smoke invoice save/finalize/print and rate publication/retry. Do not create fake production financial invoices without the operator's explicit process.
9. Watch safe error counters, readiness, backup age/copy presence and storage; retain the prior release until acceptance. Follow [rollback](rollback.md) on failure.

`X-Courier-Protocol: courier-api-v1` guards new clients against incompatible write protocols; mismatches return 409 and preserve retry drafts. Responses advertise release/protocol and server-generated request IDs. Missing headers remain compatible with existing clients, so these headers are a guard, **not** a substitute for coordinated rollout or proof that any arbitrary old client is safe.
