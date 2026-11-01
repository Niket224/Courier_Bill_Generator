# Phase 6 implementation and verification report

Branch: `fix/production-hardening`. Earlier Phase 5 work was preserved. No commit, push, merge, deployment, production scheduler, external alert, cloud resource or production database operation was performed. Real environment/credential files were not read or modified. All execution evidence below uses synthetic local resources.

## Delivered architecture and audit findings

The deployment remains minimal: same-origin static frontend and long-lived Node/Express behind HTTPS, MongoDB-backed sessions and business records, and a separate operator-controlled encrypted backup job. No framework, microservice or hosting-provider assumption was introduced. [Deployment](deployment.md) specifies actual environment, proxy, index/TTL, resource and release requirements.

One concrete Phase 5 defect was found and fixed: the real session collection is `operator_sessions`, but capture's exclusion list recognized only legacy `sessions`. Backups now explicitly exclude both, and tests seed/check both so real session storage cannot block business capture or leak into a restored database.

New operational controls include:

- Independent liveness and bounded MongoDB/session-store readiness endpoints; legacy health remains compatible.
- Server-generated request IDs, safe fixed-category structured logs and authenticated process-local counters.
- Pre-listen model/session initialization, bounded connection/request waits, graceful/forced HTTP drain, database disconnect and safe startup errors.
- Stronger production checks for obvious weak/test/reused keys, explicit bind address and shutdown deadline.
- Client/server protocol headers that reject incompatible new writes and prevent false browser save/print confirmation; existing headerless clients remain compatible and still require coordinated rollout.
- Service-worker v12/auth v5 rollout; obsolete Courier caches are removed without deleting unrelated origin caches.
- Guarded backup-job and monitoring scripts, capacity checks, exclusive lock, authenticated local/copy verification, success/failure receipts, age and archive-presence alerts. Retention is planning-only; no archive deletion is enabled.
- SHA-pinned, read-only GitHub Actions CI with clean installs, syntax/workflow policy, source safety scanning, regressions, coverage, audits and a disposable recovery drill. No deployment job exists.

## Actual commands and results

| Command / check | Actual result |
| --- | --- |
| `npm ci` | Root lockfile install succeeded; 94 packages installed, zero audit vulnerabilities |
| `npm ci --prefix server` | Server lockfile install succeeded; 156 packages installed, zero audit vulnerabilities |
| `npx playwright install chromium` | Succeeded |
| `npm run check` | 81 JavaScript files passed syntax; workflow JSON/YAML and safety policy passed; no linter configured |
| `npm run check:secrets` | Passed; ignored real environment files were not read |
| `npm test` unit | **136 passed, 0 failed, 0 skipped** |
| `npm test` isolated API/integration | **77 passed, 0 failed, 0 skipped** |
| `npm test` Chromium desktop/mobile | **98 passed, 0 failed, 0 skipped** |
| **Full regression suite** | **311 passed, 0 failed, 0 skipped**; all 294 baseline scenarios retained |
| `npm run test:coverage` | **213 passed, 0 failed, 0 skipped**; repeated unit/API subset |
| `npm audit --audit-level=moderate` | Zero vulnerabilities |
| `npm audit --prefix server --audit-level=moderate` | Zero vulnerabilities |
| `npm run test:operations` | Passed against a real disposable local replica set and HTTP app |
| Follow-up 100-shipment PDF browser subset | Two existing cases enhanced and rerun: **2 passed**; these are not added to the 311 count |
| Editor diagnostics / `git diff --check` | No reported implementation diagnostics; whitespace check passed |

Coverage: **93.11% lines, 86.32% branches, 90.68% functions** over loaded backend/shared modules. Operations logging/readiness, backup operations and monitor modules have 100% measured line coverage; runtime 97.56%, billing 99%. Browser DOM execution is tested by Playwright but is not included in Node coverage. Production entry points and live external services are deliberately not exercised with production configuration.

Evidence: [all named tests](phase6-test-results.txt), [coverage](phase6-coverage.txt), [drill output](phase6-drill-results.txt), [local CI/audit checks](phase6-ci-checks.txt), and [machine-readable performance measurements](phase6-performance.json). Root/server installs emitted npm lifecycle-script approval notices; server also emitted the existing transitive node-domexception deprecation warning. No install-script approval was silently granted. Tests/drill subsequently ran successfully using explicit harness startup.

Earlier failures were resolved, not hidden: the source scan initially flagged an exact dummy URI and then its own exception literal; a narrowly scoped synthetic exception fixed that without broad directory exemptions. The first drill's extra draft had a mismatched snapshot invoice number and was rejected correctly; the fixture was corrected. A full run had two protocol-mock failures because CORS did not expose the mock header, plus one browser teardown race; the mock and completion wait were corrected, the four affected cases passed, and the final full suite passed. The initial added PDF measurement captured the post-dialog guard page; it now reproduces only the temporary authorized print-rendering interval after asserting real authenticated finalization. No production auth/CSRF/print protections were disabled.

## CI and staging status

**Local CI-equivalent checks: PASS.** Workflow syntax/policy tests reject missing tests, write permissions, mutable action refs and ignored failures. GitHub action SHAs were checked against official public tags. Existing tests verify a genuine failed QA assertion returns nonzero.

**GitHub-hosted CI: BLOCKED / NOT RUN.** No branch was pushed and no remote job was triggered. Ubuntu runner downloads, repository permissions and actual hosted timing remain to be verified after explicit publication approval.

**Local isolated recovery: VERIFIED.** **Representative hosted staging: BLOCKED / UNVERIFIED.** No designated staging host, TLS origin, staging credentials, off-host storage mount, scheduler or alert destination was available. Local tests are not substituted for those checks. See [staging checklist](staging-checklist.md).

## Backup, restart and recovery evidence

The measured drill seeds two clients, six invoices (including draft, generated, paid, cancelled and correction), embedded and standalone shipments, two draft cards and two approved historical versions in one RateBook. It creates a **200,222-byte encrypted archive**, authenticates it, restores to a fresh generated database and verifies records, indexes, references and original financial totals. The original invoice stays at 63.72/base charge 45 while current pricing uses base charge 90. Wrong keys and corrupt archives are rejected; interrupted targets stay quarantined. Sessions and persisted invoices survive application restart. Existing browser tests serve an actually restored database and print historical invoices after clearing browser storage.

Cleanup affects only harness-owned temporary directories/databases after path checks. No retention cleanup or destructive production restore ran. An arbitrary old-version deployment rollback remains a host/operator acceptance exercise; local tests cover compatible restart, protocol mismatch, cache transition and non-destructive data recovery.

## Measured performance, not estimates

Windows, Node 24.22.1, local disposable MongoDB 7.0.24 replica set. HTTP measurements include Supertest/local listener overhead; memory figures cover the Node drill process, not MongoDB/Chromium or peak deployment RSS. Dataset is small and synthetic.

| Operation | Measurement |
| --- | --- |
| Create 100-shipment draft | 68.469 ms, one sample |
| Finalize 100-shipment invoice | 62.745 ms, one sample |
| Readiness | 4.566 ms mean / 6.519 ms p95, 20 samples |
| Invoice search | 18.193 ms mean / 23.800 ms p95, 20 samples |
| Read 100-shipment invoice | 10.312 ms mean / 12.304 ms p95, 20 samples |
| Consistent capture / encryption / verified file write | 28.422 / 5.345 / 38.267 ms, one sample each |
| Restore and verify | 1,023.088 ms, one sample |
| Graceful shutdown / restart | 3.242 / 16.565 ms, one sample each |
| Node RSS before backup / after restore | 172,515,328 / 180,203,520 bytes; not peak memory |
| Exact invoice-number query | 1 key and 1 document examined, 1 returned |
| Substring search | 6 documents examined, 2 returned; collection-scan growth risk remains |
| 100-row desktop rendering / A4 PDF | 47.1 / 276.1 ms; 3 pages, 64,388 bytes |
| 100-row mobile rendering / A4 PDF | 47.3 / 253.3 ms; 3 pages, 64,546 bytes |

Browser values are one sample per viewport, including two animation frames for rendering. PDF generation is actual Chromium output from a confirmed synthetic invoice; native dialog/physical printer time is not measured. No RPO/RTO result is invented: proposed 24-hour RPO/4-business-hour RTO still needs a timed representative human recovery drill. The existing 64 MiB archive and 40-version limits remain unchanged.

## Phase 6 changed-file inventory

New implementation/configuration:

- [CI workflow](../.github/workflows/ci.yml)
- [operational logging/readiness](../server/operations.js), [runtime lifecycle](../server/runtime.js)
- [backup operations](../server/services/backupOperations.js), [guarded job](../server/scripts/backup-job.js), [monitor CLI](../server/scripts/monitor.js)
- [source/workflow checks](../scripts/check.cjs), [source safety scan](../scripts/scan-secrets.cjs)
- [disposable drill](../scripts/operations-drill.cjs), [sanitized drill launcher](../scripts/run-operations-drill.mjs)
- [proxy example](../ops/nginx.example.conf), [unactivated backup environment example](../ops/backup-job.env.example)
- [operations unit tests](../tests/unit/operations.test.cjs)

Updated implementation/tests:

- [root scripts](../package.json), [root environment example](../.env.example), [server environment example](../server/.env.example)
- [Express factory](../server/app.js), [startup](../server/server.js), [MongoDB connector](../server/config/db.js), [environment](../server/config/env.js), [security configuration](../server/config/security.js)
- [backup CLI timeouts](../server/scripts/business-backup.js), [actual session exclusion](../server/services/businessRecovery.js)
- [browser auth/protocol guard](../mobile-bill-app/auth.js), [HTML asset version](../mobile-bill-app/index.html), [service-worker transition](../mobile-bill-app/sw.js)
- [environment tests](../server/test/env.test.js), [API regression tests](../server/test/integration/api.test.js), [restore regression tests](../server/test/integration/recovery.test.js), [synthetic recovery fixture](../tests/fixtures/recovery.cjs)
- [financial/PDF browser test](../tests/e2e/financial.spec.cjs), [protocol browser test](../tests/e2e/persistence.spec.cjs), [draft recovery completion wait](../tests/e2e/rate-review.spec.cjs)

Documentation:

- New [deployment](deployment.md), [operations](operations.md), [monitoring](monitoring.md), [CI/CD](ci-cd.md), [staging checklist](staging-checklist.md), [rollback](rollback.md), this report and its five linked evidence files
- Updated [architecture](architecture.md), [backup inventory](backup-and-recovery.md), [disaster runbook](disaster-recovery-runbook.md), [testing](testing.md), [hardening plan](production-hardening-plan.md)

## Remaining P0/P1/P2 gates and recommendation

**P0 — production release gates:** actual HTTPS/same-origin/proxy/secret custody verification, independent verified business backups, and representative restore acceptance are not complete. Production backup scheduling is **not activated**. Do not deploy to the real business on the strength of local tests alone.

**P1 — operational verification:** GitHub-hosted CI has not run; external alert delivery/supervisor behavior, real storage durability/capacity, model entitlement and actual hosted performance are unverified. Raw browser decryption keys are intentionally delivered only after authentication/CSRF and cannot protect against an active compromised session/OS. Coordinate release assets and preserve the stable key. Proxy configurations other than the supported local trusted proxy require explicit design/verification, not broad trust.

**P2 — capacity/maintenance:** substring search can scan growing history; in-process counters/limits reset on restart and assume one instance; retention planning is non-destructive and still needs operator-approved policy. Plan capacity before the 64 MiB backup or 40-version append cap. The lightweight secret scan is not an exhaustive history/PII audit. Address these based on measured business usage rather than adding enterprise infrastructure prematurely.

**Recommendation:** ready to request an explicitly authorized hosted staging and operational acceptance drill; **not approved for production deployment yet**. Required approvals include branch/PR publication to run hosted CI, any staging resources/costs, backup destinations/key custody, scheduler/alert activation, retention deletion and eventual deployment/cutover. No approval was assumed or action activated. Stop after Phase 6.
