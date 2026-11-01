# Testing and local setup

## Phase 6 operations and CI checks

Run `npm run check` for all source JavaScript syntax and workflow JSON/YAML safety
policy, `npm run check:secrets` for source-only secret/private-artifact checks,
`npm test`, `npm run test:coverage`, both moderate-threshold npm audits, and
`npm run test:operations` for the measured disposable replica-set recovery drill.
Clean lockfile installation of both dependency trees and Chromium installation
were executed. No linter is configured and none is silently invented.

The existing 294 scenarios remain represented. Phase 6 adds 13 unit cases, two API
cases and one protocol-compatibility browser case run on desktop/mobile: 311 total.
See [actual named results](phase6-test-results.txt), [coverage](phase6-coverage.txt),
[local drill evidence](phase6-drill-results.txt), and [report](phase6-report.md).

New checks cover readiness dependency failure, real graceful/forced HTTP shutdown,
startup failure, privacy-safe logs, production secret/proxy validation, CI mutations
that must fail, backup-job authorization/failure/age/capacity/retention safeguards,
missing archive/copy detection, session-collection exclusion, protocol mismatch,
and service-worker cleanup limited to this app's obsolete caches. Existing tests
cover sessions, expiry, CSRF, browser keys, offline retry and historical recovery.

The operations drill separately measures actual local capture/encryption/file
verification/restore, API latency and RSS using synthetic clients, six invoices
(including a draft, generated, paid, cancelled and linked correction), shipments
and two approved rate versions. It verifies indexes, original totals, corruption,
wrong keys, quarantine, and restart persistence. Existing 100-shipment Chromium
tests record rendering, print-text capture and actual three-page PDF generation;
they do not measure physical printing. The final enhanced PDF subset passed on
desktop/mobile after the full 311-case run; those two cases are not double-counted.

The workflow has not run on GitHub and representative hosted staging is blocked.
Local Windows checks must not be described as a successful Ubuntu hosted CI run.

## Phase 5 recovery and privacy

The baseline 251 scenarios remain covered. Phase 5 adds 25 unit cases, 8 isolated
integration cases and 5 browser cases executed on desktop/mobile: **294 tests**
(123 unit, 75 API, 96 browser). Full named results are retained in
[Phase 5 test output](phase5-test-results.txt); [coverage output](phase5-coverage.txt)
includes the backend, billing/rate-card contracts and new browser data/vault modules.
Browser-only DOM controllers are not included in Node coverage.

The restore integration suite provisions an owned single-node MongoDB replica set,
captures all business collections consistently, encrypts/decrypts the archive,
restores into fresh loopback databases and verifies exact records and indexes.
The browser API on **4190** serves a genuinely restored synthetic database for
historical search/print tests. Existing APIs 4188/4189 retain their original isolation.
All harnesses strip production credentials; Gemini remains mocked. No new dependencies
were needed. Run the existing clean-checkout commands below, then `npm test` and
`npm run test:coverage`.

Additional checks cover wrong/lost keys, corrupt archives, schema/count/checksum
mismatches, broken references, interrupted backup and restore, quarantined startup,
real encrypted-file write/readback, collision refusal, storage quota, browser migration,
refresh/expiry, strict legacy import, prototype/secret-field rejection, cross-tab conflicts,
and 41 publication attempts without history deletion. The encrypted-file test checks
its resolved temporary directory before removing only synthetic test files.

The first unit regression run exposed missing vault mocks in five old characterization
cases; those fixtures were updated. An initial restore assertion compared JSON key order
instead of record equality (74 passed/1 failed); it now checks all record values deeply.
The first new browser subset had 8 passes/2 failures because its expiry URL matcher
missed the nested history endpoint; the matcher was corrected. Final results and
remaining operational limits are in [the Phase 5 report](phase5-report.md).

Production backup scheduling, actual Atlas tier, off-device storage durability and live
provider recovery remain unverified. Use the [runbook](disaster-recovery-runbook.md)
for separately authorized staging/production procedures; CLI commands are not test
credentials and never fall back to application MONGO_URI.

## Current Phase 4 verification

`npm test`: **251 passed** (98 unit, 67 isolated API, 86 Chromium desktop/mobile),
zero failed/skipped. All 194 baseline cases remain represented; rate publication
fixtures now follow the explicit approval workflow. See [full named results](phase4-test-results.txt).
`npm run test:coverage`: 165 passed; 91.72% lines, 87.72% branches, 91.15% functions
over loaded backend/shared modules, including the new rate-card contract (98.63% lines).
Browser UI execution is not included in this metric. See [coverage output](phase4-coverage.txt).

New cases cover strict extraction schema, actual synthetic PDFs, deterministic
provider faults, approval/CSRF, atomic publication, concurrent conflicts, rollback,
idempotent lost-response recovery, unresolved fields, session recovery and stored XSS.
Historical-invoice preservation is exercised by the existing financial browser suite
against the new publication flow. No live Gemini calls, real keys or production DBs.

Phase 4 dependency commands executed:

```sh
npm install --prefix server --save-exact @google/genai pdf-lib
npm uninstall --prefix server @google/generative-ai
npm audit --prefix server --omit=dev
npm audit
```

Both audits reported zero vulnerabilities. A transitive node-domexception deprecation
warning was emitted during installation. Use the locked clean-checkout commands below.
The initial focused browser run had 12 passes/2 failures caused by a shared test cookie
invalidated by the reauthentication case; retaining its rotated cookie fixed the fixture.
A later mobile sizing assertion measured an animated 19.68px bounding box rather than
the configured 20px width (250 passed/1 failed); it now checks stable computed CSS.
The final complete run passed without retries. Browser plugin not available; the existing
Playwright runner supplied rendered desktop/mobile interaction and screenshot checks.

See [Phase 4 report](phase4-report.md) and [manual staging checklist](rate-card-publication.md).

Phase 3 adds the shared exact billing engine and independent financial fixtures.
See [billing test cases](billing-test-cases.md) and [the Phase 3 report](phase3-report.md).
Run `npm test`, `npm run test:coverage`, and `npm run test:performance` from root.
Coverage now includes the shared billing module in addition to backend modules.
The new financial browser suite uses another disposable API on 4189 with normal
authentication limits; neither test API accepts production connection settings.

Phase 2 results and all executed test names are recorded in
[the Phase 2 report](phase2-report.md) and [test output](phase2-test-results.txt).
The original Phase 0 verification below is historical. Invoice tests now use
request IDs/revisions and explicit lifecycle actions rather than unsafe upserts.
New browser cases simulate rejected responses, timeout/offline transport, lost
acknowledgements after real commits, duplicate clicks, archival recovery and
clearing private DOM. No Phase 1 protection is bypassed in live API tests.

## Clean checkout

Use Node.js 24 (validated with 24.22.1) and npm 11. Run from the repository root:

```sh
npm ci
npm ci --prefix server
npx playwright install chromium
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:coverage
npm test
```

Linux hosts may need `npx playwright install --with-deps chromium` and permission
to install OS browser libraries. First integration execution downloads pinned
MongoDB 7.0.24 (large Windows download); subsequent runs use its binary cache.
Internet access is required for first installation/download, not for billing tests.
MongoDB binaries must support the host OS. Download/start failures fail the suite;
they are not silently skipped. Allow Node subprocesses, loopback listeners and
browser launch in restricted environments.

Development dependencies were added with:

```sh
npm install --save-dev --save-exact @playwright/test supertest mongodb-memory-server
```

Both package lockfiles must remain tracked. No linter is configured, so there is
no lint command. Server package test scripts delegate to root scripts.

## Commands and scope

| Command | Scope |
| --- | --- |
| npm test | Unit, integration, then browser suites; stops on failure |
| npm run test:unit | Environment, safety guards, and actual browser billing functions |
| npm run test:integration | Express API with Supertest and a fresh MongoDB process |
| npm run test:e2e | Chromium desktop 1280x720 and mobile 390x844; API traffic intercepted |
| npm run test:coverage | Unit + integration with Node coverage of loaded backend modules; not whole-product coverage |
| node scripts/qa_mobile_app.mjs | Same Playwright suite and exit status as test:e2e |

Unit billing tests execute the existing browser script in a VM, suppressing only
the final DOM initialization. This avoids extracting or duplicating business logic
in Phase 0. DOM behavior is separately covered in Playwright. Do not assert known
bugs as desired behavior; track them in the hardening plan.

## Isolation guarantees

The Node test launcher passes an allowlisted OS environment, removing MONGO_URI,
GEMINI_API_KEY, NODE_OPTIONS, dotenv settings and MongoDB override variables. It
sets NODE_ENV=test and TEST_DB_MODE=memory explicitly. No tests load .env files.
Direct integration invocation without those settings fails before connecting.
Supplied MONGO_URI or TEST_MONGO_URI is rejected, not accepted as a test database.

The integration harness starts its own MongoDB on 127.0.0.1 with a random port and
`courier_test_<UUID>` database. It checks the generated URI before connecting,
disconnects Mongoose and stops that process in teardown. It never drops a database
on an existing server. Missing configuration and unsupported/download-failed
MongoDB fail the command. No production credentials or existing invoice data are
required or modified.

Playwright starts a dedicated static server on 4187 and a disposable MongoDB-backed
API on 4188, refusing to reuse existing servers. Each test gets a fresh context
seeded with synthetic state. Service workers are blocked. Baseline tests mock API
responses; authentication tests forward only the expected local API requests to
4188 and exercise real sessions, CSRF and saved history. Other external traffic is
blocked. Provider tests mock the Gemini SDK before extraction and never call Gemini.
Screenshots/results are ignored; do not use customer data in fixtures or reports.

## Launching locally

Copy [server/.env.example](../server/.env.example) to server/.env only if that file
does not already exist. Configure a development database and optional Gemini key
locally. Do not copy production credentials. In two terminals:

```sh
npm run dev
npm start --prefix server
```

The frontend now requires operator login through the backend; initialize credentials
using [the security setup guide](security-and-authentication.md). Tests use only
synthetic credentials and mocked Gemini responses. NODE_ENV=test is reserved
for the harness; it cannot start the normal backend. Environment values in the
shell override dotenv. See the root and server examples for all application variables.

## Limitations

Browser tests block service workers, so offline caching needs a separate future
suite. Real AI extraction, physical printing and restore/export roundtrips are
not covered yet. The authenticated UI/API/database path is now tested. Backend coverage does
not measure the VM browser script or modules that were never loaded.
Do not treat it as total application coverage. Test failures propagate as nonzero exits; no unconditional
process.exit(0) remains in the QA wrapper.

## Phase 0 verification record

Validated on Windows with Node 24.22.1 and npm 11.19.1:

- `npm install --save-dev --save-exact @playwright/test supertest mongodb-memory-server`: completed.
- `npm ci --prefix server`: completed; Multer 1 deprecation warning remains.
- `npx playwright install chromium`: completed.
- `npm test`: 18 unit, 3 integration, 4 browser tests passed; zero failed/skipped.
- `npm run test:coverage`: 21 unit/integration tests passed. Loaded backend modules:
  69.14% lines, 72.22% branches, 57.89% functions. Environment and isolation
  validators: 100%; invoice routes: 88.77% lines; rate routes: 92.16% lines.
- `git diff --check`: passed. Ignore checks confirmed real .env variants are
  ignored and the three .env.example files are trackable.

Earlier attempts failed because sandboxing blocked subprocesses, the first MongoDB
download exceeded the initial three-minute timeout, and the first URI guard
expected a trailing question mark that this library does not emit. Subprocess
permission, a fifteen-minute setup timeout with cancellation cleanup, and the
correct strict URI pattern resolved those failures. The final full run passed.
The intentional failing QA fixture is asserted by a passing unit test; it is not
a skipped test or a failure hidden by the main suite.

The browser launched the existing static app and Supertest exercised listening
Express instances against disposable MongoDB. The normal `npm start --prefix server`
command was not run against existing dotenv configuration. Real AI, production
hosting, offline caching and production readiness remain unverified.
