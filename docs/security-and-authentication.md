# Phase 1: single-operator security

## Design and scope

One operator is configured through server-only environment settings. There is no
signup, user table, role system, external identity service, or billing-schema
change. The existing HTML/CSS/JavaScript UI is preserved behind a login panel.

Passwords use Node's maintained crypto.scrypt implementation: N=131072, r=8, p=1,
16 random salt bytes and a 64-byte derived key, compared with timingSafeEqual.
Only the encoded hash is configured; the real password is never written to disk
by the application or setup helper. Login necessarily handles the submitted
password transiently in memory. Synthetic test credentials are not operator
credentials. Parameters follow [OWASP's scrypt guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)
using [Node crypto](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).

[express-session](https://expressjs.com/en/resources/middleware/session/) manages
signed opaque cookie IDs; [connect-mongo](https://github.com/jdesboeufs/connect-mongo)
stores sessions in `operator_sessions` through the existing Mongoose client.
Database session IDs are SHA-256 digests. MongoDB gets a TTL index; the API also
checks absolute expiry itself, so delayed TTL cleanup does not extend access.
The default lifetime is eight hours, with no sliding extension. Login regenerates
the session ID and CSRF token. Logout destroys the session. Changing the username
or password hash invalidates old sessions on their next request; rotating the
session secret invalidates their signed cookies. Keep a stable secret across
ordinary restarts.

The development cookie is `courier.sid`; production uses `__Host-courier.sid`.
Both are HttpOnly, SameSite=Lax, Path=/ with no Domain attribute. Production always
sets Secure. Same-origin HTTPS is the supported deployment; cross-site cookie
hosting and SameSite=None are deliberately not introduced.

## Endpoints and CSRF

| Endpoint | Access |
| --- | --- |
| GET /api/health | Public minimal process health |
| GET /api/auth/csrf | Public, rate-limited pre-login CSRF session |
| POST /api/auth/login | JSON credentials plus session-bound X-CSRF-Token |
| GET /api/auth/session | Authenticated; returns expiry and current CSRF token |
| POST /api/auth/logout | Authenticated plus CSRF token |
| All /api/invoices and /api/rates endpoints | Authenticated, including search, calculation and Gemini parsing |

Every unsafe private request requires X-CSRF-Token. This includes login CSRF
protection before authentication. Tokens live only in the server session and a
frontend closure, never localStorage. Requests use credentials:include. A 401,
CSRF invalidation, or expiry timer returns the UI to sign-in; drafts remain intact.
No silent retry repeats a write. No CORS wildcard or Vercel suffix exemption remains.
Requests with an Origin must match ALLOWED_ORIGINS exactly. Requests without Origin
still require authentication and CSRF for private writes.

## Initial credentials and environment

Install with `npm ci` and `npm ci --prefix server`. Copy
[server/.env.example](../server/.env.example) to server/.env only when no real file
already exists. Do not overwrite an existing configuration. In a private interactive
terminal run:

```sh
npm run admin:hash --prefix server
```

Enter a unique password of at least 12 characters. Input is hidden, is not a command
argument, and is not echoed. The helper prints an encoded hash and independently
generated random session secret. Put those in the server's secret configuration;
preserve the single quotes around the hash in dotenv. Do not paste generated output
into chat, tickets, source code, frontend files, or committed documentation.
The helper refuses piped/noninteractive plaintext input. It does not edit .env.

| Variable | Requirement |
| --- | --- |
| ADMIN_USERNAME | Required; 1-128 letters/digits/underscore/dot/@/hyphen |
| ADMIN_PASSWORD_HASH | Required; generated scrypt encoding, never plaintext |
| SESSION_SECRET | Required; random base64url, 43-128 characters |
| SESSION_TTL_MINUTES | Optional; 5-1440, default 480; absolute expiry |
| TRUST_PROXY | Optional; false by default, or loopback for a trusted local proxy |
| ALLOWED_ORIGINS | Explicit UI origins, comma-separated; HTTPS and nonempty in production |
| NODE_ENV | Set production on deployment; development for local HTTP |

Existing MONGO_URI and optional GEMINI_API_KEY remain server-only. PORT defaults
to 5000. In development use the same hostname in both browser and API: the browser
now calls port 5000 on its own localhost/127.0.0.1 hostname. The example permits
both local frontend origins on port 4173. Do not change SameSite to work around a
localhost-versus-127.0.0.1 mismatch.

## Deployment and migration

1. Set the required credentials, stable session secret, NODE_ENV=production and
   the exact HTTPS UI origin. Missing/invalid configuration fails startup.
2. Serve static files and /api through the same HTTPS origin. Forward /api to
   Express. The static development server is not the production server.
3. If the reverse proxy runs on this host, set TRUST_PROXY=loopback, make the
   backend port inaccessible publicly, and have the proxy overwrite forwarded
   headers. Do not enable blanket trust. A remote proxy needs a separately reviewed
   trusted-address configuration; it is not supported by this phase's env switch.
4. The existing MongoDB identity needs permission to use `operator_sessions` and
   create its TTL index. Startup waits for database/session-store initialization.
   There is no invoice/rate migration and no production data modification in this work.
5. Deploy the frontend, new auth script and service-worker version together.
   The worker removes older caches during activation and caches only allowlisted
   static assets; API/auth responses are never cached. Existing open tabs should
   reload once to receive the login UI. API guards remain authoritative meanwhile.
6. Keep one Node process for this single-operator deployment. Rate-limit counters
   and hashing concurrency guards are process-local and reset on restart. Sessions
   persist in MongoDB. Multiple replicas require a shared limiter store or an edge
   limiter before deployment; this phase adds no Redis or other infrastructure.

Helmet protects API responses. Configure security headers on the static hosting
origin too, including HSTS after HTTPS is verified and a CSP such as
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
Inline review-table event handlers were removed to permit script-src 'self'.
Imported image sources are restricted to the bundled logo or PNG/JPEG/WebP/GIF
data URLs; external/SVG sources are not rendered. Existing stored drafts are not
rewritten. Re-upload unsupported artwork as a supported raster image if needed.

Login is limited to 10 requests/IP/15 minutes and 30 requests globally/15 minutes;
one password derivation runs at a time. CSRF bootstrap is limited to 60/IP/15
minutes. Authenticated PDF parsing is limited to 10 requests/hour for this operator.
Authentication JSON is limited to 4 KiB, invoice JSON to 1 MiB, form bodies to
16 KiB/50 parameters, and uploads to one 10 MiB file with bounded form parts.
Reverse-proxy limits should allow the multipart overhead of a 10 MiB PDF.

## Error and privacy boundaries

The API returns fixed safe errors for parser, database and unexpected failures.
Provider stack traces, URLs/keys and PDF output are not returned or logged. Session
store errors fail closed. The browser does not persist authentication material.
No real credentials, customer documents or production database were used in tests.

Existing billing drafts and images remain in localStorage by design. Logging out
hides the UI but does not erase or encrypt them. Someone with access to the OS
account/browser storage can read those drafts; use a dedicated operator device and
OS account. Server authentication is not local disk encryption. A future explicit
draft-retention policy can change this without silently deleting business data.

## Manual verification (development or approved staging only)

1. Install dependencies and configure a development database and generated admin
   settings. Start `npm start --prefix server` and `npm run dev`. Open
   http://127.0.0.1:4173. Verify billing controls are hidden before login.
2. Submit an incorrect password, then the correct one. Verify useful errors,
   password-field clearing, and the unchanged billing workspace after success.
3. Edit a synthetic shipment, preview/print an invoice and open History. Confirm
   its saved amount. Never use production invoices for verification.
4. Inspect the cookie: HttpOnly, SameSite=Lax, Path=/; in HTTPS production staging,
   also Secure and the __Host- prefix. No auth token should appear in localStorage.
5. Sign out, then request /api/invoices: expect 401. Replay an old cookie: expect
   401. Sign in, remove X-CSRF-Token from a write request: expect 403.
6. Set a five-minute session lifetime in development and restart. Verify expiry
   returns to sign-in, the draft remains, and private API calls return 401.
7. Send an Origin outside ALLOWED_ORIGINS: expect 403 with no allow-origin header.
   Repeated login/PDF requests should reach 429 and include Retry-After.
8. Inspect CacheStorage after service-worker activation: only static assets should
   remain. Verify the new worker replaces the previous cache. Automated UI tests
   disable service workers; a unit test covers the API exclusion decision.

## Remaining blockers and next work

Production HTTPS/proxy behavior, actual operator provisioning, a real Gemini
extraction, and a full installed-service-worker upgrade need approved staging
verification. No production start was attempted using existing credentials.
The existing print flow still starts persistence before print validation and does
not wait for save completion; local fallback can still overstate rate-save success.
Billing consistency, stronger domain/import/search validation, immutable invoice
history, backup/restore drills and operational readiness remain future phases.
No complete calculation refactor or invoice schema change is included here.
