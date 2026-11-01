# Phase 5 implementation report

Branch: `fix/production-hardening`. The working tree was clean when Phase 5 began. This phase is uncommitted. No production credentials/database, actual browser drafts or customer records were accessed or changed. No migration, deployment, scheduler, automatic retention cleanup, commit, push or merge was executed. Test data and temporary encrypted archives were synthetic.

## Architecture delivered

- **Business backup:** a separate operator CLI captures clients, invoices, embedded/standalone shipments, legacy rates, reviewed drafts and approved rate ledgers in one majority-committed MongoDB snapshot transaction. It preserves original totals, snapshots, status, correction/payment/cancellation operations and idempotency receipts. Unknown collections fail for review. Sessions and secrets are excluded.
- **Integrity/encryption:** versioned BSON Extended JSON manifest, UTC timestamp, app/schema versions, counts/indexes and SHA-256 record checksums, wrapped in AES-256-GCM with a fresh 96-bit IV and authenticated header. A separate 32-byte key file is never embedded. File write/sync/readback verification precedes non-overwriting promotion from `.partial` to `.cbackup`.
- **Restore:** only an explicit isolated loopback client is accepted; each attempt creates a new database. Record checksums/counts, relationships, financial snapshots and required indexes are verified before a `VERIFIED` marker. Failed/interrupted targets remain quarantined; application startup and backup capture refuse them. No production overwrite option exists.
- **Browser privacy:** existing local drafts, recovery archives, reviews and pending status operations migrate to authenticated ciphertext. The stable BROWSER_DRAFT_KEY is delivered only through authenticated POST+CSRF, imported into Web Crypto and retained only in memory. Migration removes plaintext only after a persisted round-trip and exact-byte comparison. Logout clears private memory/DOM; refresh requires authenticated unlocking.
- **Import/export:** versioned browser-only exports include intended local records, exclude known secret fields, and clearly warn that JSON is private/unencrypted and does not back up MongoDB. Imports validate structure, dates, numeric values, image sources and versions, reject prototype pollution, preview/confirm replacement, archive the current state and verify persistence before success. Compatible legacy browser files remain accepted.
- **Retention:** the existing 40-publication cap is unchanged. No versions are deleted; both publication and rollback append operations stop at the cap. The review UI warns from version 35. Retention/deletion recommendations are proposals only.

The complete inventory, failure scenarios and recovery limitations are in [backup architecture](backup-and-recovery.md). Browser-only unsaved edits are still vulnerable to device loss unless saved to MongoDB or exported off-device. Encryption alone is not disaster recovery. The new empty-browser template no longer bundles the former sample business/customer shipments; existing browser records remain intact.

## Actual verification

| Final command | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `npm test` — unit | 123 | 0 | 0 |
| `npm test` — isolated MongoDB/API | 75 | 0 | 0 |
| `npm test` — desktop/mobile Chromium | 96 | 0 | 0 |
| **Full suite** | **294** | **0** | **0** |
| `npm run test:coverage` — unit/API | 198 | 0 | 0 |

All 251 baseline scenarios remain represented. New cases add 25 unit, 8 integration and 10 browser executions. [Full named test results](phase5-test-results.txt) and [coverage output](phase5-coverage.txt) are retained. Overall measured coverage is **92.31% lines, 86.33% branches, 90.74% functions** across loaded backend/shared modules. Backup archive, verified file writer and recovery service have **100% measured line coverage**; vault has **100%**, browser data contract **98.21%**, billing **99%**. Line coverage does not imply every failure branch is exercised. DOM controllers and hosted production boot are outside this Node metric.

Executed during development: `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, the focused recovery browser subset, `npm test`, `npm run test:coverage`, syntax/diagnostic checks and `git diff --check`. No dependency installation was needed, and no fresh npm advisory audit is claimed for this phase. Editor diagnostics found no errors in inspected implementation files; Git whitespace checking passed with normal Windows line-ending notices.

Earlier failed attempts are recorded honestly: five old unit VM fixtures initially lacked the new vault adapter; the first restore equality check compared JSON field order (74 passed/1 failed); and the first new browser subset used a URL matcher that missed nested history search (8 passed/2 failed). Fixtures/assertions were corrected and rerun. No test was disabled or marked skipped, and security protections were not bypassed in real API tests.

## Restore evidence

The disposable replica-set source contains two synthetic clients, four issued invoices (generated, paid, cancelled and linked correction), embedded shipment/tax/calculation/layout snapshots, one standalone shipment and two approved rate versions. The archive excludes a seeded session. Restore into a fresh database checks the complete document values, original total **63.72**, original base charge **45**, unique invoice/idempotency indexes and the active rate version **2**. A later rate uses base charge **90**; restoring/printing never reprices the original invoice.

The browser server on test port 4190 is started **after** actual encrypted archive restoration. Both desktop and mobile find and print the recovered invoice, including after browser storage deletion. A partial-write injection produces a quarantined target that cannot start the app or become a backup source. A missing marker on a generated recovery database is also rejected. Source-record loss is simulated only in the disposable test database and recovered from the archive. Tests attempt 41 publications and verify exactly 40 retained versions with no deletion or active-pointer change after rejection.

The Browser plugin skill was unavailable; the repository's Playwright runner exercised rendered flows. Screenshots of the recovered invoice were inspected at desktop and mobile sizes. Provider APIs, actual production backup storage, hosted durability and real Gemini remain unverified.

## Complete Phase 5 file inventory

New implementation:

- [backup archive contract/encryption](../server/services/backupArchive.js)
- [verified encrypted-file writer](../server/services/backupFile.js)
- [consistent capture and isolated restoration](../server/services/businessRecovery.js)
- [operator backup CLI](../server/scripts/business-backup.js)
- [browser serialization/import validation](../mobile-bill-app/browser-data.js)
- [encrypted draft vault](../mobile-bill-app/draft-vault.js)

Updated implementation/configuration:

- [app controller](../mobile-bill-app/app.js), [authentication lifecycle](../mobile-bill-app/auth.js), [review controller](../mobile-bill-app/rate-review.js), [HTML](../mobile-bill-app/index.html), [service worker](../mobile-bill-app/sw.js)
- [Express factory/key endpoint](../server/app.js), [database startup guard](../server/config/db.js), [security environment validation](../server/config/security.js)
- [root scripts](../package.json), [ignore rules](../.gitignore), [root environment example](../.env.example), [server environment example](../server/.env.example)

Tests/harness:

- New [recovery unit tests](../tests/unit/recovery.test.cjs), [MongoDB recovery tests](../server/test/integration/recovery.test.js), [browser recovery tests](../tests/e2e/recovery.spec.cjs), [synthetic record seeder](../tests/fixtures/recovery.cjs), [test-only ciphertext reader](../tests/fixtures/read-vault.cjs)
- Updated [auth fixture](../tests/fixtures/auth.cjs), [environment tests](../server/test/env.test.js), [billing unit fixtures](../tests/unit/billing.test.cjs), [security unit fixtures](../tests/unit/security.test.cjs)
- Updated browser regressions: [authentication](../tests/e2e/auth.spec.cjs), [billing](../tests/e2e/billing.spec.cjs), [financial](../tests/e2e/financial.spec.cjs), [persistence](../tests/e2e/persistence.spec.cjs), [rate review](../tests/e2e/rate-review.spec.cjs)
- [Playwright configuration](../playwright.config.cjs), [disposable API/restore harness](../scripts/e2e-api.cjs), [coverage runner](../scripts/run-tests.mjs)

Documentation:

- New [backup architecture](backup-and-recovery.md), [browser privacy](browser-data-privacy.md), [disaster runbook](disaster-recovery-runbook.md), [retention decisions](data-retention.md), this report, [test log](phase5-test-results.txt), [coverage log](phase5-coverage.txt)
- Updated [architecture](architecture.md), [testing](testing.md), [security](security-and-authentication.md), [hardening plan](production-hardening-plan.md)

## Required setup, approvals and remaining risks

1. Provision the new **BROWSER_DRAFT_KEY** before deploying; it is required at startup. Generate a random 32-byte base64 key, store it in the hosting secret store and keep a separate protected recovery copy. Do not rotate it without a verified draft migration/export. Neither real environment file was modified.
2. Deploy frontend/shared scripts, backend and new service-worker asset versions together over HTTPS. Verify actual browser migration with a prior protected export. Existing login, cookie, CSRF and CORS behavior remains enforced.
3. Operator approval is needed for backup destination/media, key custody, scheduler/alerts and any recurring hosting cost. No automated schedule is installed. The proposed RPO/RTO are 24 hours/4 business hours and require an actual timed recovery drill.
4. Check actual Atlas tier and snapshot availability. Logical capture requires replica-set snapshot transactions and caps archives at 64 MiB; larger/unsupported or inconsistent legacy sources require an approved native/provider backup process. Read-only backup permissions and Windows ACLs must be configured on the actual host.
5. Approve retention before deleting anything. The existing 40-version cap also blocks rollback at 40; plan an archival/storage extension before reaching it. This phase verifies the policy rather than silently changing it.
6. Production restore/cutover needs separate explicit authorization and the [runbook](disaster-recovery-runbook.md). Keep the original target untouched until acceptance; do not restore old sessions or merge diverged financial history automatically.
7. Keys and decrypted drafts are temporarily available to an authenticated session. Encryption does not defeat a compromised OS, live-cookie theft, malicious extension or active-session XSS. Local plaintext exports/downloads and old forensic remnants need separate protection. Offline refresh cannot unlock without the backend; an already unlocked tab can continue editing. Pending writes can lose recent keystrokes on sudden power failure, and legacy records without original snapshots cannot regain missing facts.

Recommended next phase: an explicitly authorized operational staging drill covering real backup storage/key recovery, monitoring/scheduling, HTTPS deployment, off-device restore timing and operator usability. Stop after Phase 5; no production action has been performed.
