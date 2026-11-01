# Phase 1 implementation report

Completed on `fix/production-hardening`, 2026-11-01. No commit, push, merge or
deployment was performed. Existing environment credentials were not read or
modified. Tests used only synthetic credentials, disposable MongoDB databases and
mocked Gemini responses. No invoice schema or billing formula was changed.

## Implemented

- One configured operator with salted scrypt hashes and a hidden-input setup helper.
- MongoDB-backed HttpOnly sessions, production Secure cookies, SameSite=Lax,
  rotation on login, absolute expiry, logout invalidation and credential-version revocation.
- Login/logout/session-check and pre-login CSRF endpoints. All private invoice,
  rate and Gemini routes require authentication; unsafe requests require CSRF.
- Explicit-origin credentialed CORS, Helmet, bounded bodies/uploads, login and PDF
  rate limits, bounded password-hashing concurrency, safe API errors and provider-log redaction.
- Matching login/sign-out UI, authenticated fetch helper, session-expiry handling,
  memory-only CSRF token, API cache exclusion and targeted HTML/image input hardening.
- Real authenticated browser-to-API-to-disposable-MongoDB billing tests, alongside
  the original characterization tests. No microservice or extra production datastore.

## Actual test results

| Command/suite | Passed | Failed | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: |
| npm test: unit stage | 25 | 0 | 0 | 0 |
| npm test: isolated API stage | 32 | 0 | 0 | 0 |
| npm test: desktop/mobile Chromium stage | 14 | 0 | 0 | 0 |
| npm test total | 71 | 0 | 0 | 0 |
| npm run test:coverage (unit + API rerun) | 57 | 0 | 0 | 0 |

Every executed test name and outcome appears in
[the full test results](phase1-test-results.txt). The deliberate failing assertion
fixture is run inside a passing exit-status regression; it is not a hidden suite
failure. All original 25 Phase 0 tests remain; their fixtures now authenticate
where required, and the old wildcard CORS expectation was replaced by explicit origins.

[Backend coverage](phase1-coverage.txt): **89.25% lines, 77.88% branches,
87.88% functions** across loaded backend modules. Auth, password and session-store
modules have 100% line coverage. This does not measure frontend JavaScript or prove
the interactive password prompt/production boot path; those remain partly uncovered.

The first sandboxed unit attempt returned EPERM before tests could start. The
approved subprocess run resolved it. Early API runs warned about many listeners
because tests construct many apps sharing one disposable store; the test-only
listener limit was raised explicitly. Final runs had no failed or skipped tests.

## Security requirement coverage

The result log includes successful login, wrong password/unknown username, missing
credentials, invalid/expired sessions, logout and replay rejection; unauthenticated
invoice read/search/detail/write, rate list/create/calculate and PDF parsing;
CSRF missing/wrong/other-session/stale-token rejection; allowed/disallowed/null
CORS origins; login/global/concurrency/PDF limits; malformed and oversized JSON;
excess/oversized uploads; production cookie flags/security headers; provider and
database/store error redaction. Browser tests exercise successful login, saved
billing history, logout, wrong-password feedback, API expiry and the absolute timer.

## Browser QA

Browser plugin not available; the repository Playwright runner was used. Chromium
ran at http://127.0.0.1:4187 in 1280x720 desktop and 390x844 mobile viewports, with
API traffic forwarded exclusively to the isolated test API on port 4188.

| Check | Result |
| --- | --- |
| Page identity and meaningful UI | Passed baseline title/content assertions |
| Login and authenticated controls | Passed |
| Runtime errors | No page errors in successful authenticated flow |
| Console | Baseline clean; deliberate 401 tests produce expected HTTP-error messages |
| Interaction | Login → weight edit → invoice save/print stub → persisted history → logout passed |
| Session expiry | API 401 and absolute timer both returned to login; draft retained |
| Visual evidence | Desktop/mobile history screenshots inspected; controls and synthetic invoice readable |

Screenshots were saved in the OS temporary directory as
`courier-phase1-desktop.png` and `courier-phase1-mobile.png`, outside source control.
Service workers were blocked in browser tests; their private-response exclusion
was unit-tested. Real installed-worker upgrade behavior remains a manual staging check.

## Dependency audit and commands

Executed:

```sh
npm install --prefix server --save-exact express-session connect-mongo helmet express-rate-limit multer@latest
npm audit --prefix server --json
npm audit fix --prefix server
npm pkg set overrides.qs=6.16.2 --prefix server
npm install --prefix server
npm audit --json
npm audit --prefix server --json
npm run test:unit
npm run test:integration
npm run test:e2e
npm test
npm run test:coverage
git diff --check
```

Final npm audits returned **zero advisories** in both the root/test dependency tree
and backend tree. The initial backend audit found body-parser (high), proxy-addr
(critical) and qs (moderate). Compatible fixes updated body-parser to 1.20.9 and
proxy-addr to 2.0.8. Express 4 retained a vulnerable qs constraint, so a documented
6.16.2 override resolves it without moving to Express 5. Multer is now 2.5.0;
upload-limit compatibility tests passed. No `--force` upgrade was used. An audit
snapshot is not a guarantee against undisclosed vulnerabilities.

New packages: express-session 1.19.0, connect-mongo 6.0.0, Helmet 8.3.0,
express-rate-limit 8.7.2. The backend lockfile pins the resolved dependency graph.
For clean checkouts use `npm ci`, `npm ci --prefix server`, then
`npx playwright install chromium`. No real credentials are needed to run tests.

## Changed-file inventory

- Environment: [.env.example](../.env.example), [server/.env.example](../server/.env.example).
- Backend: [app.js](../server/app.js), [server.js](../server/server.js),
  [env.js](../server/config/env.js), [security config](../server/config/security.js),
  [auth](../server/security/auth.js), [password hashing](../server/security/password.js),
  [session store](../server/security/store.js), [credential helper](../server/scripts/hash-admin-password.js),
  [AI routes](../server/routes/aiRoutes.js), [package.json](../server/package.json),
  [package-lock.json](../server/package-lock.json).
- Frontend: [auth.js](../mobile-bill-app/auth.js), [app.js](../mobile-bill-app/app.js),
  [index.html](../mobile-bill-app/index.html), [styles.css](../mobile-bill-app/styles.css),
  [sw.js](../mobile-bill-app/sw.js).
- Tests: [Playwright config](../playwright.config.cjs), [isolated browser API](../scripts/e2e-api.cjs),
  [env tests](../server/test/env.test.js), [API tests](../server/test/integration/api.test.js),
  [auth fixture](../tests/fixtures/auth.cjs), [security units](../tests/unit/security.test.cjs),
  [billing units](../tests/unit/billing.test.cjs), [auth browser tests](../tests/e2e/auth.spec.cjs),
  [billing browser tests](../tests/e2e/billing.spec.cjs).
- Documentation: [architecture](architecture.md), [testing](testing.md),
  [hardening plan](production-hardening-plan.md), [security/setup guide](security-and-authentication.md),
  this report, [test results](phase1-test-results.txt), [coverage](phase1-coverage.txt).

The unrelated untracked `tatus` file was left untouched. No real .env or invoice
data files were edited.

## Deployment, manual checks and remaining blockers

New variables: ADMIN_USERNAME, ADMIN_PASSWORD_HASH, SESSION_SECRET,
SESSION_TTL_MINUTES and TRUST_PROXY. ALLOWED_ORIGINS is now strict and mandatory
in production. Follow [the setup and manual verification guide](security-and-authentication.md)
for hidden-input credential generation, cookie checks, CSRF/CORS checks and expiry.

Before production use, configure HTTPS on one origin, protected proxy forwarding,
static-host security headers and MongoDB session/TTL permissions. Provision the
actual operator privately and verify Secure cookies in approved staging. This work
does not approve or perform deployment.

Remaining blockers: real HTTPS/proxy and worker-upgrade verification; actual
Gemini availability; localStorage draft privacy on shared devices; print/save
completion and failure feedback; billing-contract inconsistencies; domain/search/
import validation; tested backup/restore and operational readiness. Rate limiting
is process-local and intended for one Node instance. Recommended next phase is
reliable invoice persistence/feedback, followed by the agreed billing contract.
