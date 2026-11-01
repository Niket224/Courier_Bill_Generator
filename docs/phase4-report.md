# Phase 4 implementation report

Branch: `fix/production-hardening`. Changes remain uncommitted. Earlier Phase 3 work was already present in the working tree and was preserved. No production database connection, real customer data, credential modification, migration, commit, push, merge or deployment was performed.

## Result and architecture

PDF → bounded validation → mocked-in-tests Gemini adapter → strict shared schema → editable human review → server draft → explicit approval → atomic publication. Independent base charges are preserved. Unresolved charges block saving/publication rather than becoming zero. Final calculations read approved server versions; immutable invoice snapshots retain their original figures and provenance.

Draft and publication requests use UUID idempotency keys and optimistic revisions. A single per-shipper MongoDB document atomically stores each approved snapshot, receipt and active pointer. Concurrent conflicts return 409. Lost-response retries cannot create a second publication. Rollback appends another approved version without changing history. Authentication, CSRF, strict CORS, session cookies, upload rate limiting and no-store responses remain enabled.

Browser review edits and pending requests survive session expiry and refresh, with private DOM cleared on logout. Backend success is required before displaying publication success or installing active rates locally. Extracted text is escaped, including values round-tripped through stored drafts. The existing invoice layout and workflow are retained; the review table scrolls horizontally with readable fields on mobile.

## Executed validation

| Command / run | Actual result |
| --- | --- |
| Existing unit/API/browser runs during implementation | 66 / 56 / 72 baseline cases passed |
| `npm run test:unit` after contract tests | 97 passed |
| `npm run test:integration` after new API cases | 67 passed |
| Focused new browser run | Initially 12 passed, 2 failed from stale shared test cookies after reauthentication; fixture corrected |
| Mobile readability regression run | 250 passed, 1 failed from measuring width during the modal scale animation; assertion now checks stable CSS width |
| `npm test` | 98 unit + 67 isolated API + 86 browser = **251 passed**, zero failed/skipped |
| `npm run test:coverage` | **165 passed**, zero failed/skipped |
| `npm audit --prefix server --omit=dev` | Zero vulnerabilities |
| `npm audit` | Zero vulnerabilities |
| `git diff --check` | Passed; only line-ending conversion notices |

All test names and statuses are retained in [full test output](phase4-test-results.txt); [coverage output](phase4-coverage.txt) includes every measured module. Coverage is **91.72% lines, 87.72% branches, 91.15% functions** across loaded backend/shared modules. Billing remains **99% lines**; rate-card contract **98.63%**. Browser-only scripts are exercised by E2E but not included in Node coverage. Production boot/DB connector and real SDK invocation are intentionally not exercised against real services.

The 194 baseline cases remain represented, with unsafe legacy-write expectations replaced by explicit approved fixtures. Phase 1 authentication/security and Phase 2 persistence/printing regressions all pass. Scenario E (new publication does not change issued invoices) and H (persistence/printing) are covered by existing financial/persistence browser cases now using the new publication flow. New browser cases cover scenarios A–D, F–G and stored XSS on both desktop and mobile. Synthetic PDF bytes, deterministic provider responses and randomized disposable MongoDB instances are used throughout. The intentional assertion-failure fixture is checked to return exit 1.

Browser plugin not available; the existing Playwright runner was used. Screenshots of the confirmed publication view were inspected at 1280×720 and 390×844; the final readability assertions check minimum pricing field width and compact approval checkbox width. No framework was introduced.

## Phase 4 changed-file inventory

New implementation:

- [shared rate-card contract](../mobile-bill-app/rate-card.js)
- [review/publication browser controller](../mobile-bill-app/rate-review.js)
- [draft model](../server/models/RateCardDraft.js), [approved ledger model](../server/models/RateBook.js)
- [publication API](../server/routes/rateCardRoutes.js), [versioning service](../server/services/rateCards.js)
- [provider adapter](../server/services/geminiParser.js), [PDF validation](../server/services/pdfValidation.js), [validation worker](../server/services/pdf-worker.js)

Updated integration/UI/configuration:

- [app controller](../mobile-bill-app/app.js), [HTML](../mobile-bill-app/index.html), [styles](../mobile-bill-app/styles.css), [service worker](../mobile-bill-app/sw.js)
- [Express factory](../server/app.js), [server entry](../server/server.js), [environment validator](../server/config/env.js)
- [AI route](../server/routes/aiRoutes.js), [rate routes](../server/routes/rateRoutes.js), [invoice rate verification](../server/services/billingVerification.js)
- [server dependencies](../server/package.json), [server lockfile](../server/package-lock.json)
- [root environment example](../.env.example), [server environment example](../server/.env.example)

Tests/harness:

- [new contract/provider/PDF unit tests](../tests/unit/rate-card.test.cjs), [new review browser tests](../tests/e2e/rate-review.spec.cjs), [synthetic fixtures](../tests/fixtures/rate-card.cjs)
- [API integration tests](../server/test/integration/api.test.js), [environment tests](../server/test/env.test.js), [financial browser regressions](../tests/e2e/financial.spec.cjs)
- [disposable browser API](../scripts/e2e-api.cjs), [coverage runner](../scripts/run-tests.mjs)

Documentation: [AI contract](ai-rate-card-contract.md), [publication guide](rate-card-publication.md), [architecture](architecture.md), [testing](testing.md), [hardening plan](production-hardening-plan.md), this report and the two linked result files. Other dirty files shown by Git belong to earlier phase work; they were not discarded or committed.

## Configuration and compatibility

New optional variables: `GEMINI_MODEL=gemini-2.5-flash`, `GEMINI_TIMEOUT_MS=8000` (1000–10000), `GEMINI_RETRIES=2` (0–2). The existing server-only optional `GEMINI_API_KEY` remains required to enable extraction. Existing environment files were not modified. The maintained SDK is pinned at `@google/genai` 2.32.0, PDF parser at `pdf-lib` 1.17.1. Installation emitted a transitive node-domexception deprecation warning; no vulnerabilities were reported by the executed audits.

Executed dependency changes:

```sh
npm install --prefix server --save-exact @google/genai pdf-lib
npm uninstall --prefix server @google/generative-ai
```

Clean-checkout installation and test commands are in [testing](testing.md). Deploy server, frontend and shared files together. Legacy POST rate upserts now fail with `PUBLICATION_REQUIRED`; callers must use draft/publish endpoints. Existing legacy records remain intact and estimate-readable, but require explicit approval before new rate-derived finalizations. No automatic conversion is run.

## Remaining production blockers and manual verification

- **Live Gemini extraction is unverified.** Google documents account restrictions for the default 2.5 model; confirm entitlement or configure another documented supported model in a separately authorized staging check.
- Conservative PDF acceptance excludes encrypted, interactive and compressed-object/xref-stream files; validate representative quotations and re-export guidance.
- The operator must verify source quotations and commercial assumptions. Exact CITY matching drives final invoices; broader destinations, special conditions and fuel reference do not silently introduce new calculation rules. Explicit manual overrides retain the prior policy.
- Validate HTTPS/proxy/session behavior, updated service-worker assets, request/body limits and memory on actual hosting. Automated tests do not certify production replica-set durability or backup restore.
- Local drafts are retained unencrypted on the operator's secured browser profile. Approved ledgers stop at 40 versions per shipper without deleting history; plan an approved archive/storage extension before that limit.

Follow the detailed [manual staging checklist](rate-card-publication.md). Recommended next phase: operational staging, backup/restore and deployment checks, followed by explicit support for any unsupported business pricing rules. Stop here pending the operator's next instruction; no deployment has occurred.
