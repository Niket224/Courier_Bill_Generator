# Testing and local setup

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

Playwright starts a dedicated static server on 4187 and refuses to reuse an
existing server. Each test gets a fresh context seeded with synthetic state.
Service workers are blocked; API requests are fulfilled in-process and all other
non-test-origin traffic is blocked. Browser E2E verifies UI behavior, not a live
browser-to-database roundtrip. Supertest covers the real API/database path separately.
Screenshots/results are ignored; do not use customer data in fixtures or reports.

## Launching locally

Copy [server/.env.example](../server/.env.example) to server/.env only if that file
does not already exist. Configure a development database and optional Gemini key
locally. Do not copy production credentials. In two terminals:

```sh
npm run dev
npm start --prefix server
```

The frontend works locally without backend secrets; history and AI require the
backend. Tests use no Gemini key and never call Gemini. NODE_ENV=test is reserved
for the harness; it cannot start the normal backend. Environment values in the
shell override dotenv. See the root and server examples for all application variables.

## Limitations

Browser tests block service workers, so offline caching needs a separate future
suite. Real AI extraction, physical printing, restore/export roundtrips and a
live UI/API/database roundtrip are not covered yet. Backend coverage does
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
