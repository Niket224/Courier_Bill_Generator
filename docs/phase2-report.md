# Phase 2 implementation report

Completed on `fix/production-hardening`. No commit, push, merge, deployment,
production database connection, destructive migration, real credential use or
existing business-data modification was performed. No dependencies or environment
variables were added. Phase 1 authentication, sessions, CSRF, CORS, headers and
rate limits remain enabled.

## Final verification

| Final command/suite | Passed | Failed | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: |
| npm test: unit | 30 | 0 | 0 | 0 |
| npm test: isolated API/integration | 45 | 0 | 0 | 0 |
| npm test: desktop/mobile Chromium | 54 | 0 | 0 | 0 |
| npm test total | 129 | 0 | 0 | 0 |
| npm run test:coverage | 75 | 0 | 0 | 0 |

Every passing test name and outcome is in [the full results](phase2-test-results.txt).
The [coverage report](phase2-coverage.txt) measures loaded backend modules:
**90.53% lines, 85.43% branches, 91.67% functions**. Invoice persistence has 93.18%
line coverage; invoice validation has 99.11%. Frontend coverage is not included in
those percentages. Browser behavior is exercised separately. Editor diagnostics
and `git diff --check` reported no errors.

All Phase 0/1 scenarios were rerun. The old test that upserted PAID over an invoice
was intentionally adapted to the explicit lifecycle endpoint; preserving that old
overwrite behavior would contradict Phase 2. Existing calculation, auth/session,
CSRF, CORS, upload limits, password hashing, safe-error and browser regressions pass.
The intentional failing assertion fixture remains a passing check that QA returns
exit code 1 on failure; it is not an ignored failure.

Earlier runs exposed a lowercase expected invoice number versus canonical uppercase
and two browser assertions reading audit operations from a newly lightweight list
response. Expectations were corrected to use canonical identity and the detail
endpoint. Those runs failed as reported; the final full run above passed. Tests
were not disabled, skipped or weakened by removing security guards.

Commands actually executed include `npm run test:unit`, `npm run test:integration`,
`npm run test:e2e`, `npm test`, `npm run test:coverage`, Git branch/status/diff checks
and editor diagnostics. Final full and coverage output was retained in the linked
text reports. MongoDB tests used harness-owned random databases; Gemini was mocked.

## Persistence flow and lifecycle

Validate -> persist exact local retry envelope -> send authenticated/CSRF-protected
request -> require a matching successful receipt -> mark Saved -> allow final print.
Duplicate clicks share no second request. Timeout is 15 seconds. Unknown outcomes
retain the same request ID/payload across refresh; retries cannot duplicate a
record or mutate finalized history. Definite validation/conflict rejections allow
corrected data with a new ID. Unsaved work is retained on failure.

Draft updates require the exact revision. Finalization makes billing contents
immutable. PAID and CANCELLED are explicit versioned actions with reasons, recorded
atomically beside the original contents. Corrections use new invoice numbers and
link to the original; originals are not rewritten. A unique invoice-number index
and a globally unique partial operation-ID index protect concurrent requests.

History exposes Open, Download record, Mark paid, Cancel and Create correction as
appropriate. New Bill archives the current local draft before clearing it and does
not modify old server invoices. Tools can restore local archives. Full snapshots
preserve invoice/business metadata, artwork, rate context, shipment details, notes,
due dates, fuel and split-tax breakdowns. List responses exclude large snapshots;
detail/download retains them.

## Browser/privacy QA

Browser plugin not available; Playwright was used at http://127.0.0.1:4187 with
1280x720 desktop and 390x844 mobile Chromium. Live API tests forwarded only to the
dedicated isolated API on 4188. Other cases deliberately mocked failures.

| Check | Observed result |
| --- | --- |
| Page identity, meaningful UI, baseline console health | Passed original checks |
| Save acknowledgement before print | Passed; no print before confirmation |
| Backend rejection / HTTP 200 success:false / offline / timeout | Failed/Offline state, preserved draft, no final print |
| Duplicate clicks and uncertain committed save | One request/operation; exact request replay after simulated response loss |
| Draft -> finalized -> paid -> cancelled -> correction | Passed live-database workflow on both viewports |
| History amount reconstruction | Printed recorded totals, not recalculated totals |
| New Bill, archive restore, quota failure, refresh | Old work preserved; blocked destructive replacement on archive failure |
| Initial unauthenticated view and logout/expiry | No private working state or populated invoice/review DOM |
| Visual inspection | Desktop/mobile history controls readable and wrapping; invoice layout retained |

Existing screenshot capture paths in the OS temporary directory are named
`courier-phase1-desktop.png` and `courier-phase1-mobile.png`; the final run refreshed
them with Phase 2 history controls and synthetic data. No screenshots or customer
backups were added to source control. Print dialogs are stubbed; physical print/PDF
and installed service-worker behavior require manual staging verification.

LocalStorage remains unencrypted and is not erased on logout. The app now reads it
only after authentication and removes private DOM/working state on logout, rather
than merely hiding navigation. This does not prevent an OS/browser owner from
reading raw storage. Corrupt drafts are preserved for authenticated download;
cross-tab conflicts archive local work instead of silently replacing another tab.
Storage eviction/quota and private backup practices remain explicit limits.

## Compatibility and calculation concerns

- Legacy database records remain readable and untouched but are read-only without
  the new schema/revision history. Missing historical details are not invented.
- Legacy records without complete snapshots download as original records; a linked
  correction starts an empty draft for manual completion.
- Updated write clients must send requestId and expectedVersion. Direct PAID save
  and blind upsert behavior are intentionally rejected. Browser/API rollout must
  be coordinated and old tabs refreshed.
- New indexes are additive. No historical document rewrite or index-dropping
  migration runs. Existing duplicate data/index build failures require separate
  review, never automatic deletion.
- Supplied finite amounts are recorded, not independently priced. The existing
  browser and backend pricing contracts still differ. `totalsVerified` stays false;
  the UI says so. No historical recalculation or new pricing formula was introduced.
- The 1 MiB body limit remains; large artwork may require explicit reduction.
  Unsupported input is rejected rather than silently truncated or dropped.

## Changed-file inventory

Backend:

- [Invoice model](../server/models/Invoice.js), [Shipment model](../server/models/Shipment.js)
- [Invoice routes](../server/routes/invoiceRoutes.js)
- [Validation service](../server/services/invoiceValidation.js)
- [Atomic persistence service](../server/services/invoicePersistence.js)

Frontend:

- [App](../mobile-bill-app/app.js), [authentication helper](../mobile-bill-app/auth.js)
- [Payload adapter](../mobile-bill-app/persistence.js)
- [HTML](../mobile-bill-app/index.html), [styles](../mobile-bill-app/styles.css), [service worker](../mobile-bill-app/sw.js)

Tests:

- [API/integration tests](../server/test/integration/api.test.js)
- [Billing characterization](../tests/unit/billing.test.cjs)
- [Invoice validation units](../tests/unit/invoice-validation.test.cjs)
- [Authenticated browser workflows](../tests/e2e/auth.spec.cjs)
- [Persistence/failure/privacy browser tests](../tests/e2e/persistence.spec.cjs)

Documentation:

- [Architecture](architecture.md), [testing](testing.md), [security guide](security-and-authentication.md), [hardening plan](production-hardening-plan.md)
- [Persistence/lifecycle/migration guide](invoice-persistence.md), this report,
  [per-test results](phase2-test-results.txt), [coverage output](phase2-coverage.txt)

## Manual staging and remaining work

Follow the full [manual checklist](invoice-persistence.md#manual-staging-verification):
save/reopen drafts; double-click print; simulate lost acknowledgements; finalize,
pay, cancel and correct; inspect legacy recovery; verify physical PDF output;
exercise local archive/quota/two-tab behavior; expire sessions; and review MongoDB
index permissions and write concern on the deployment topology. Use synthetic data
and obtain approval before any production action.

Remaining work: the authoritative billing contract and rounding/weight/tax rules;
new-period timezone defaults; production backup/restore and archive retention;
privacy policy for shared devices; real HTTPS/proxy/service-worker rollout checks;
rate-save fallback feedback (outside invoice persistence). Tests are not a
production replica-set outage drill. No Phase 3 work or deployment was started.
