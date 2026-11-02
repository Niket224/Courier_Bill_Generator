# Final production acceptance — Phase 7

## Executive decision

**NO-GO for real daily production use.** The complete local application passes the final synthetic business, security, persistence, recovery and PDF checks after the targeted fixes below. Required hosted CI/staging, durable scheduled backups, alert delivery, real secret/key custody, business/accountant approvals and physical-print evidence remain missing. Optional live Gemini parsing is also unaccepted unless separately verified or explicitly excluded from the release.

This audit reviewed base commit **d782749cc210db86c15f8f228d6c8595e7aedc08**, branch **fix/production-hardening**, and the **uncommitted Phase 7 diff** listed below. The working tree was clean at the start; the base SHA alone does not include these fixes. Evidence was collected locally on 2026-11-01/02. No commit, push, merge, deployment, cloud resource, production access, real customer test data, secret rotation, live paid AI request or production scheduler activation occurred.

Detailed traceability, security controls, staging commands, operator push/PR steps, business approvals and the **MANUAL PHYSICAL PRINT** checklist are in [release readiness](release-readiness-checklist.md). The remaining release gates are recorded in [production GO/NO-GO](production-go-no-go.md).

## Architecture and configuration reviewed

The actual stack remains plain browser JavaScript/HTML/CSS, a long-lived Express/Mongoose server, MongoDB-backed single-admin cookie sessions, exact-decimal/integer-paise billing, immutable invoice snapshots and revision/idempotency guards, approved versioned RateBooks, a bounded mocked-in-tests Gemini boundary, encrypted browser drafts, authenticated-encrypted business archives, and separate unactivated job/monitor scripts.

Reviewed components include frontend rendering/save/print/history/auth/vault/import/SW, every Express route family and model, invoice normalization/persistence/calculation, rate review/publication/rollback, PDF/provider limits, backup capture/manifest/file/restore/quarantine, session TTL/indexes, runtime/readiness/logging, environment validation, CI and deployment/rollback documents. No framework, hosting provider or managed-backup entitlement was assumed.

Production requires same-origin HTTPS routing, the verified proxy boundary, stable independent browser/session keys, MongoDB session/index permissions and a coordinated static/shared/backend release. Consistent logical capture requires replica-set support and remains capped at **64 MiB**. Rate history remains capped at **40 approved appends per shipper**, including rollback appends; nothing is automatically deleted. Source records and schemas were not migrated.

The server enforces Secure/HttpOnly/SameSite cookies, exact CORS, CSRF and route guards. BROWSER_DRAFT_KEY is intentionally delivered only through an authenticated CSRF-protected no-store endpoint, imported into Web Crypto and kept in memory. This is protection for logged-out retained drafts, not against a compromised OS or active authenticated session. No production configuration or key custody was inspected. The optional GEMINI_API_KEY/model configuration was not read or exercised live.

## Findings and corrections

| ID / priority | Confirmed finding | Correction and evidence |
| --- | --- | --- |
| F01 / P1 | `/invoices/search` validated status but ignored it | Status now combines with text/date conditions; a small History selector exposes the existing filter. API/browser cases verify PAID excludes other lifecycles and operator-style injection is rejected |
| F02 / P1 | History recovery could finish asynchronous archival after expiry and repopulate private global memory | Immediate epoch/auth checks before replacing state; forced-expiry browser case waits for the old action to finish, then requires null state/history, locked vault and cleared DOM |
| F03 / P1 | Development static server accepted a sibling path sharing its prefix; malformed URL decoding could reject outside its handler | Safe relative-path boundary and explicit public asset allowlist; encoded traversal/private paths/malformed URLs are rejected. Proxy example also denies private static paths while preserving Express API identifiers |
| F04 / P1 | Cancelled history had no accepted labelled print path | Read-only server-confirmed cancelled copies now print with a CANCELLED historical-record label; corrections show their original invoice link. Revision/status checks remain enforced; no financial data is rewritten |
| F05 / P2 | Historical amount-in-words text entered HTML without escaping | Escaped like customer fields. New invoices already derive words internally; this closes a stored/legacy rendering boundary, not evidence of an observed production exploit |
| F06 / P2 | Safe GIF images accepted elsewhere were rejected by browser backup validation | Legacy GIF import/export now matches the existing safe image allowlist; SVG/executable/external sources remain rejected |
| F07 / P2 | Long unbroken fields and separated print footer could compromise acceptance layout | Fixed table columns/wrapping, print-only spacing, A4 margins, repeated table headings and an intact totals/signature block. One-page and three-page outputs were text/bounds checked and raster inspected |
| F08 / P2 | CI reported coverage without a minimum and install could download an unused unpinned MongoDB binary | Enforced 90% line / 80% branch / 85% function floors; a real passing-assertion/low-coverage fixture proves exit failure. Install-only MONGOMS_DISABLE_POSTINSTALL=1 avoids the unused download while tests retain pinned 7.0.24 |

No confirmed application P0 is left unresolved by these local checks. **P0 release gates remain**, as specified in the decision document. No financial formula, destructive invoice schema change, public registration or new infrastructure service was introduced.

## Final executed results

| Suite/check | Passed | Failed | Skipped | Scope |
| --- | ---: | ---: | ---: | --- |
| `npm test` unit | 138 | 0 | 0 | Existing units plus static-path/coverage-gate acceptance |
| `npm test` API/integration | 80 | 0 | 0 | Owned MongoDB only; status search, proxy/cookies and competing finalization added |
| `npm test` Playwright | 108 | 0 | 0 | Desktop and mobile; five new acceptance cases per viewport |
| **Full regression suite** | **326** | **0** | **0** | All prior 311 scenarios retained; 15 new cases |
| `npm run test:coverage` | 218 | 0 | 0 | Repeated unit/API subset, not additional unique cases |

Coverage is **93.12% lines, 86.43% branches, 90.68% functions** over the existing loaded backend/shared-module scope. All enforced floors passed. Billing engine line coverage remains **99%**. This does not measure all browser DOM code or prove hosted behavior.

Additional commands actually executed: root and server `npm ci`; installation-only root retry with MONGOMS_DISABLE_POSTINSTALL=1; focused unit/API/browser checks; `npm run check`; `npm run check:secrets`; both `npm audit --audit-level=moderate` variants; `npm run test:operations`; `npm run test:performance`; Poppler PDF verification/raster rendering; editor diagnostics and Git whitespace checking. No linter is configured. No application dependency was added or upgraded.

Root/server locked installation succeeded, and both fresh advisory audits reported **zero vulnerabilities**. Existing node-domexception deprecation and npm lifecycle-script review notices remain. The first normal root install completed after a slow default MongoDB 8.2.6 download; the attempt to stop its downloader safely refused when its lock had already disappeared. No unrelated process was stopped. The install-only skip retry completed without that download; actual database tests still started their pinned binary.

Final evidence: [named test output](phase7-test-results.txt), [coverage output](phase7-coverage.txt), [CI/audit checks](phase7-ci-checks.txt), [drill evidence](phase7-drill-results.txt), [calculation timings](phase7-calculation-performance.txt), [combined measurements](phase7-performance.json), and [PDF inspection](phase7-pdf-inspection.json).

Earlier failed development checks were resolved rather than skipped: the first coverage negative fixture inherited the parent test context and unexpectedly exited 0; its child now uses the sanitized harness environment and a separate covered module. The first focused layout run had six passes/two failures because keeping the footer intact produced four pages; print-only row spacing now preserves the intended three-page result. The initial long-AWB text check used column-interleaved layout extraction; raw order confirmed the entire wrapped value and the checker was corrected. No security control was disabled to make these pass. External blocked checks are not hidden as zero skipped Node tests.

## Independent monthly business acceptance

The [worked fixture](../tests/fixtures/monthly-acceptance.cjs) specifies four line results independently of production code:

| Destination / input | Approved synthetic quotation | Expected line |
| --- | --- | ---: |
| PATNA, 1 kg, 1 piece | Base 3 kg / Rs 45, extra Rs 15/kg | 45.00 |
| PATNA, 3.333 kg, 1 piece | Same card; half-up currency rounding | 50.00 |
| RANCHI, 2.75 kg, 2 pieces | Base 2 kg / Rs 60, extra Rs 20/kg | 150.00 |
| DELHI, 0.5 kg, 1 piece | Base 1 kg / Rs 100, extra Rs 25/kg | 100.00 |

Twenty-five groups give gross **8625.00**; 12.5% fuel rounds to **1078.13**; subtotal **9703.13**; each synthetic 9% tax component rounds to **873.28**; final **11449.69**. Every one of the 100 persisted line amounts and all integer-paise components are checked against these constants. The expected totals were not generated by a second call to the same billing engine.

The actual browser-to-Express-to-Mongo cycle publishes the reviewed card explicitly, saves a draft, finalizes and prints, rejects an overwrite, logs out/in and retrieves history, creates a separately numbered linked correction, marks the original paid, searches AWB/customer/invoice/date/status, publishes changed base charges, and confirms the original calculation snapshot/total stay unchanged. A simulated backend 503 retains the same encrypted finalization request; a subsequent real commit with lost response replays once without duplicates. Cancellation then yields a labelled historical PDF. A separate actual API race permits one of two competing finalizations, rejects the other and retains exactly one generated revision.

These are arithmetic/workflow acceptance fixtures, **not commercial or GST approval**. Weight-per-piece interpretation, quotation rules, overrides, fuel basis, tax mode/eligibility, invoice particulars/numbering and correction policy still require the operator/accountant checklist.

## Security and failure-injection disposition

The [C1–C25 security matrix](release-readiness-checklist.md) maps authentication, salted hashing, fixation/expiry/logout, CSRF/CORS/route guards, login/AI limits, field/operator injection, stored customer/AI/history XSS, safe errors/logs, backup access/encryption, browser privacy/key custody, headers, advisories, proxy forwarding, SW exclusions and sensitive-file hosting to code/tests and limitations.

Local checks also retain database-disconnection, runtime restart, failed saves, lost acknowledgements, idempotent duplicates, concurrent writes, refresh/corruption/quota, missing keys, expiry, invalid CSRF, provider timeout/invalid output, publication conflict, interrupted backup, corrupt/wrong-key archives, restore quarantine, capacity failure, invalid configuration and protocol/cache transition cases. Mocked provider/storage fault injection tests failure handling; they do not prove external infrastructure. Actual MongoDB capture/restore/restart tests run against real owned local processes.

The loopback proxy test verifies Express's Secure-cookie/CSRF behavior under trusted forwarded TLS and rejection of untrusted forwarding. It does not verify a hosted certificate, firewall or reverse proxy. Static file denials were checked on the actual local development server; the strengthened Nginx example is not an installed or host-validated configuration.

## Recovery evidence and measured resource use

The separate measured drill uses a disposable MongoDB 7.0.24 replica set, two clients, six invoices including a draft/generated/paid/cancelled/correction, embedded and standalone shipments, two draft rate cards and two approved versions. The **200,222-byte** encrypted archive excludes both operator_sessions and legacy sessions. A fresh restore verifies counts, raw record checksums, required indexes, client/correction/rate references and original amounts. The original Rs 63.72 invoice retains its base charge 45 after active pricing becomes 90. Wrong keys, corrupted archives and interrupted restoration are rejected/quarantined; session/invoice persistence survives a restart.

Windows / Node 24.22.1 measurements are local observations; other QA activity can contend on the machine. HTTP samples include Supertest/listener and local database overhead. No hosted latency, physical printer timing, production peak memory or end-to-end human RTO is inferred.

| Measurement | Actual value / samples |
| --- | --- |
| Login | 459.674 ms, 1 sample |
| Draft creation, 100 shipments | 87.912 ms, 1 sample |
| Finalization, 100 shipments | 132.500 ms, 1 sample |
| Search | 41.175 ms mean / 57.719 ms p95, 20 samples |
| Read 100-shipment invoice | 23.151 ms mean / 33.019 ms p95, 20 samples |
| Backup capture/encrypt/file/readback | 171.824 ms total, 1 sample |
| Fresh restore and verification | 1452.270 ms, 1 sample |
| Node RSS before backup / after restore | 170,397,696 / 175,656,960 bytes; point samples, not peak |
| Local mongod memory | serverStatus reported resident 138 MB / virtual 4509 MB; virtual is not physical RAM use |
| Pure 100-line calculation | 0.240 ms mean / 0.469 ms p95, 50 warm samples |
| Pure 500-line calculation | 0.730 ms mean / 1.404 ms p95, 50 warm samples |
| Pure 1000-line calculation | 1.283 ms mean / 1.976 ms p95, 50 warm samples |
| Exact invoice-number query | 1 key/document examined, 1 returned |
| Substring search | 6 documents examined, 2 returned; growth risk remains |
| Browser rendering / PDF | Final per-viewport samples and PDF sizes are in the combined JSON; native/physical printer is NOT VERIFIED |

The performance drill's 100-row single-destination invoice is a separate dataset from the mixed-destination monthly golden case. Calculation-only timings exclude network, database and DOM. Single samples are not statistical SLA evidence. The proposed 24-hour RPO/4-business-hour RTO, independent storage, actual schedule, failure notifications and key recovery still require approved operational drills. No retention cleanup or production job ran; the 40-version and 64 MiB policies were not changed.

## PDF acceptance artifacts

All eight synthetic PDFs passed Poppler text/count/bounds checks. Each 100-row artifact contains every AWB exactly once, correct totals and the applicable correction/cancellation labels. Each viewport yields one single-page sample and three three-page samples, **20 pages total**. Raster sheets of all pages and detailed long-field/footer/label pages were visually inspected: no observed clipping, overlap or detached signature/totals block in these fixtures. The wrapped long AWB is preserved fully. Cancellation/correction labels occur on the first page; repeated continuation-page watermarks are not claimed.

| Synthetic sample | Desktop | Mobile |
| --- | --- | --- |
| Monthly 100 rows | [3-page PDF](../output/pdf/synthetic-monthly-100-desktop.pdf) | [3-page PDF](../output/pdf/synthetic-monthly-100-mobile.pdf) |
| Linked correction | [3-page PDF](../output/pdf/synthetic-correction-100-desktop.pdf) | [3-page PDF](../output/pdf/synthetic-correction-100-mobile.pdf) |
| Cancelled historical copy | [3-page PDF](../output/pdf/synthetic-cancelled-100-desktop.pdf) | [3-page PDF](../output/pdf/synthetic-cancelled-100-mobile.pdf) |
| Long address/AWB and drawn synthetic signature | [1-page PDF](../output/pdf/synthetic-single-long-fields-desktop.pdf) | [1-page PDF](../output/pdf/synthetic-single-long-fields-mobile.pdf) |

These artifacts are generated/ignored locally, contain no real customer data and are not committed. The [eight-PDF sample pack](../output/pdf/synthetic-acceptance-pack.zip) is available for the manual checklist. Final re-rasterization produced 20 pages byte-identical to the PNGs visually reviewed. Portable Windows Poppler 26.09.0 was downloaded from its [published release](https://github.com/oschwartz10612/poppler-windows/releases/tag/v26.09.0-0) and SHA-256 checked against the release digest; it is a temporary QA tool, not an app dependency. **MANUAL PHYSICAL PRINT NOT VERIFIED**: a human must complete the actual-printer checklist.

## External checks and remaining decision gates

| Check | Final status |
| --- | --- |
| Hosted Actions for this proposed diff | **HOSTED CI NOT VERIFIED**; no push/remote run. Public metadata lookup was unavailable; no authenticated run evidence was obtained |
| Representative hosted staging/TLS/mobile access/rollback | **BLOCKED / NOT VERIFIED**; no designated authorized resources |
| Off-host backup durability, active schedule and alert delivery | **NOT VERIFIED / INACTIVE**; no production job or alert was activated |
| Production configuration/key custody | **NOT VERIFIED**; values were not inspected, changed or rotated |
| Gemini entitlement/key/live extraction | **LIVE GEMINI VERIFICATION BLOCKED / NOT EXECUTED**; no paid call authorization. Core billing does not require the optional key |
| Business/accountant assumptions | **Approval missing**; arithmetic is not proof of GST/legal compliance |
| Actual printer output | **MANUAL PHYSICAL PRINT NOT VERIFIED / NOT EXECUTED** |

P0: required hosted staging/CI, durable operational backups/recovery/key custody and business release approvals remain blocking under the decision rules. P1: prove real TLS/proxy/static security enforcement, notification delivery and any included live AI feature; accept physical-print/recovery behavior. P2: plan for scan growth, 64 MiB/40-version capacity and single-instance counters; the inherited static release header is a coarse marker, so use the exact Git revision/artifact for release identity. Pattern-based secret scanning is not an exhaustive history/PII audit. P3: optional richer continuation-page identity/watermarks and additional performance samples after real workload observation.

Coordinated rollout/rollback procedures are prepared in [deployment](deployment.md), [rollback](rollback.md) and the new readiness checklist. API protocol courier-api-v1, invoice schema 2/3, calculation courier-v1, browser vault v1 and backup format v1/schema 5 remain compatible; current assets are SW v13, app v11, styles v6 and browser-data v2. Rolling back to a build with corrected defects reintroduced is not automatically safe even when formats match. No actual hosted cutover or version rollback is claimed.

## Complete Phase 7 file inventory

Updated implementation/configuration:

- [invoice route/status filtering](../server/routes/invoiceRoutes.js)
- [frontend history/print/privacy fixes](../mobile-bill-app/app.js), [safe image backup compatibility](../mobile-bill-app/browser-data.js), [status selector/asset versions](../mobile-bill-app/index.html), [print layout](../mobile-bill-app/styles.css), [service-worker assets](../mobile-bill-app/sw.js)
- [development static server](../scripts/serve_mobile_app.mjs), [coverage floors](../scripts/run-tests.mjs), [additional measurements](../scripts/operations-drill.cjs)
- [CI install/PDF checks](../.github/workflows/ci.yml), [private-path proxy example](../ops/nginx.example.conf), [generated PDF/scratch ignore rules](../.gitignore)

New implementation/test tooling and updated tests:

- [public static path resolver](../scripts/static-path.cjs), [PDF verifier](../scripts/verify-acceptance-pdfs.cjs)
- [acceptance units](../tests/unit/acceptance.test.cjs), [monthly golden fixture](../tests/fixtures/monthly-acceptance.cjs), [complete browser acceptance](../tests/e2e/acceptance.spec.cjs)
- [API search/proxy/finalization acceptance](../server/test/integration/api.test.js), [current SW rollout fixture](../tests/unit/operations.test.cjs), [legacy GIF compatibility assertion](../tests/unit/recovery.test.cjs)

New requested documents: this report, [release readiness](release-readiness-checklist.md), [production decision](production-go-no-go.md), plus seven linked evidence/measurement files and eight ignored synthetic PDFs. Updated documents: [architecture](architecture.md), [CI/CD](ci-cd.md), [testing](testing.md), [deployment](deployment.md), [rollback](rollback.md), [hardening plan](production-hardening-plan.md).

**Final recommendation:** complete the explicitly authorized hosted, operational, business and physical acceptance gates before production. Local acceptance is complete; production is **NO-GO**. Stop after Phase 7.
