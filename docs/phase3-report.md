# Phase 3 implementation report

Completed on `fix/production-hardening`. No production database connection,
real-secret use, issued-invoice rewrite, automatic migration, commit, push,
merge or deployment was performed. No new production dependencies were added.

## Contract and architecture

The pre-edit inspection and adopted formulas are recorded in
[billing-calculation-contract.md](billing-calculation-contract.md). One pure
[billing engine](../mobile-bill-app/billing.js) now serves the browser and Node.
It depends on neither Express/MongoDB nor DOM/storage and uses BigInt exact decimal
products with integer-paise component rounding.

[Server verification](../server/services/billingVerification.js) reads published
exact-destination cards, derives lines, fuel and selected taxes, and compares all
claimed amounts before finalization. Mismatches return structured 422 reconciliation
without a write. New finals require explicit weights, financial claims and tax
configuration; null is not silently interpreted as zero or one.

The rate model adds optional baseRate/revision. Publishing local cards is explicit
and authenticated; finalization cannot silently promote client rate data. Load
published rates archives the old local draft before replacing its rate table.
The rate quote endpoint keeps its old lookup hierarchy but calls the shared engine.
Cards without explicit baseRate are marked legacy estimates and cannot certify
new final invoices until reviewed.

New invoice writes use schema 3. Verified finals store the engine version, server
rate IDs/revisions, exact input snapshots, manual-override markers, tax configuration,
integer-paise results and words. Phase 2 revision/idempotency checks occur before
current-rate lookup, so an issued invoice is never repriced on retry. Existing
schema-2 invoices remain readable/immutable and are not retroactively certified.
The Phase 2 canonical hash is checked against a value captured from its committed
validator. Frozen legacy claim normalization exists only for old hashes/unverified
drafts; it is not a second authority for new finalization.

## Before/after differences

| Case | Before | After |
| --- | --- | --- |
| Base 3 kg/Rs 50, extra Rs 15, weight 4 kg | Browser 65; backend 60 | Shared contract 65 |
| Base 3 kg/Rs 45, extra Rs 15, 4.5 kg, two pieces | Browser 135; backend omitted pieces | Shared contract 135 |
| Half-paise boundary | Binary floating point plus EPSILON | Exact half-up to paise at documented boundaries |
| Manual 25.50, two pieces | Browser whole-row override | Same 25.50; explicitly recorded and verified |
| Sub-paise manual override | Could survive into later rounding | Rejected for explicit operator review |
| Fuel and split tax | Browser configurable; persistence could default 18% | Same configured browser pipeline; explicit final claims/config, independent check |
| IGST / no-tax | No explicit mode selector | Explicit configurable modes; no legal/geographic inference |
| Words for 1.999 | Could show one rupee plus 100 paise | New engine rounds to 2.00 and says TWO |
| Existing final invoice | Unverified snapshot | Original amounts/format retained; no migration or recertification |

Zero weight still incurs the base charge. No dimensional-weight rule, slab ceiling,
weight increment, automatic rate migration or legal tax classification was invented.
The existing default split percentages and fuel setting remain the starting values.

## Actual tests and commands

| Final suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Unit | 66 | 0 | 0 |
| Isolated API/integration | 56 | 0 | 0 |
| Desktop/mobile Playwright | 72 | 0 | 0 |
| **npm test total** | **194** | **0** | **0** |
| Coverage rerun (unit + API) | 122 | 0 | 0 |

All 129 earlier scenarios remain covered. Existing persistence fixtures now supply
explicit tax settings/claims and published rates or explicit manual overrides;
old successful-unverified-final expectations were updated to the new requirement.
No authentication, CSRF, rate-limit, immutable-history or database-isolation check
was removed to make tests pass.

Executed `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`,
`npm run test:e2e -- --grep 'D: rate changes'`, `npm test`, `npm run test:coverage`,
`npm run test:performance`, editor diagnostics and `git diff --check`.
[Full per-test results](phase3-test-results.txt) and [coverage output](phase3-coverage.txt)
record the final successful runs.

An earlier new browser reprint test failed because its assertion read the previous
print's text and ended before the second request finished, producing a disposed
response during teardown. The assertion now clears that text and waits for a second
print event before checking the new output. The focused rerun and final full suite
passed. Later explicit-null tests confirmed invalid null weights/quantities/rate
inputs are rejected. No test is silently skipped. The deliberate assertion-failure
fixture remains a passing test of nonzero QA exit behavior.

## Coverage and measured performance

Backend plus shared-engine coverage: **91.21% lines, 86.61% branches, 93.13% functions**.
The shared engine itself: **99.00% lines, 91.84% branches, 100% functions**. The
uncovered engine line is the browser export branch under Node's file instrumentation;
the browser-loaded module is separately exercised in a parity test and Playwright.
These percentages do not measure the rest of the frontend DOM code.

Final warm benchmark, Node v24.22.1 / Windows, 50 samples per size:

| Shipments | Mean ms | P95 ms |
| ---: | ---: | ---: |
| 100 | 0.188 | 0.349 |
| 500 | 0.691 | 1.318 |
| 1,000 | 1.419 | 2.231 |

Every sample checks an explicit expected total. These measure pure calculation,
not DOM, MongoDB or network latency. See [raw measurements](phase3-performance.txt)
and [golden test cases](billing-test-cases.md). A 100-row live browser workflow also
verifies every saved shipment and printed total.

## Browser QA

Browser plugin not available; repository Playwright used Chromium at
http://127.0.0.1:4187, desktop 1280x720 and mobile 390x844. The original isolated
test API remains on 4188; the financial suite uses another harness-owned database
and API on 4189, preserving normal authentication limits instead of weakening them.
This is test infrastructure only, not a new production service.

All nine requested financial workflows passed on both viewports: multiple
destinations, fractional rounding, rate edits/publication, immutable history,
tampering reconciliation, 100-row bills, outages, manual overrides, and real IGST
selector/authenticated verification. Existing identity/content, session expiry,
CSRF, retries, storage privacy and safe-print checks also pass. Prints are stubbed;
physical print/PDF and installed service-worker behavior still require staging.

Desktop/mobile invoice screenshots were inspected from the OS temporary files
`courier-phase3-desktop.png` and `courier-phase3-mobile.png`. Controls wrap on mobile,
the invoice design is retained, and the saved state reports server verification.
Screenshots contain only synthetic invoice details and were not added to Git.

## Changed-file inventory

- Shared/frontend: [billing.js](../mobile-bill-app/billing.js),
  [app.js](../mobile-bill-app/app.js), [persistence.js](../mobile-bill-app/persistence.js),
  [auth.js](../mobile-bill-app/auth.js), [index.html](../mobile-bill-app/index.html),
  [sw.js](../mobile-bill-app/sw.js).
- Backend: [billingVerification.js](../server/services/billingVerification.js),
  [invoicePersistence.js](../server/services/invoicePersistence.js),
  [invoiceValidation.js](../server/services/invoiceValidation.js),
  [invoiceRoutes.js](../server/routes/invoiceRoutes.js), [rateRoutes.js](../server/routes/rateRoutes.js),
  [Invoice.js](../server/models/Invoice.js), [Rate.js](../server/models/Rate.js).
- Test infrastructure: [package.json](../package.json), [Playwright config](../playwright.config.cjs),
  [test runner](../scripts/run-tests.mjs), [isolated API](../scripts/e2e-api.cjs),
  [benchmark](../scripts/benchmark-billing.cjs).
- Tests/fixtures: [billing engine units](../tests/unit/billing-engine.test.cjs),
  [existing billing units](../tests/unit/billing.test.cjs),
  [invoice-validation units](../tests/unit/invoice-validation.test.cjs),
  [golden fixture](../tests/fixtures/billing-golden.json),
  [API tests](../server/test/integration/api.test.js),
  [financial browser tests](../tests/e2e/financial.spec.cjs),
  [persistence browser fixture](../tests/e2e/persistence.spec.cjs).
- Documentation: [calculation contract](billing-calculation-contract.md),
  [test cases](billing-test-cases.md), [testing](testing.md),
  [hardening plan](production-hardening-plan.md), [architecture](architecture.md),
  [persistence guide](invoice-persistence.md), [security guide](security-and-authentication.md),
  this report, and the three linked test/coverage/performance outputs.

## Review, rollout and remaining blockers

Operator/accountant review is still needed for the existing weight-times-pieces
interpretation, zero-weight base charging, fuel taxability, tax modes/percentages,
manual override policy and rounding agreement. Verification establishes arithmetic
against selected inputs/cards, not legal tax correctness or commercial approval.

Deploy frontend/API/shared asset together, retaining the repository-relative engine
path in the backend deployment. Review and explicitly publish legacy/local cards.
Do not automatically infer approved base charges. New schema-3 invoices must never
be downgraded. Rollback requires a read-only write gate first: older Phase 2 code
can create unverified invoices even though it refuses schema-3 updates. The detailed
[deployment and rollback plan](billing-calculation-contract.md#compatibility-deployment-and-rollback)
requires no automatic production migration.

Remaining production work: approve the contract/rate cards; verify real printing,
HTTPS/proxy/service-worker rollout and database permissions; rehearse private
backup/restore; address browser storage retention/privacy and bundled legacy
customer-like defaults; validate Gemini availability and rate-import review.
No Phase 4 work or production action was started.
