# Production hardening plan for one operator

Phase 7 local acceptance is documented in [the final audit](final-production-acceptance.md),
[readiness checklist](release-readiness-checklist.md) and [NO-GO decision](production-go-no-go.md).
Confirmed local gaps were corrected without changing the billing formula or issued
financial records. No production action, live paid integration, scheduler activation,
secret rotation or remote CI trigger occurred. The next work is an explicitly
authorized representative staging/business/printing acceptance process; do not
infer production readiness from local tests or from the existence of these documents.

Phase 6 adds CI configuration, meaningful health/readiness, graceful runtime
lifecycle, privacy-safe operational events/counters, guarded backup-job and monitor
scripts, and a measured local recovery drill. See [deployment](deployment.md),
[operations](operations.md), [CI](ci-cd.md), [rollback](rollback.md) and
[staging gates](staging-checklist.md). No remote CI run, production scheduler,
external alert, hosted staging resource or deployment was activated.

Release gates remain: approved hosted staging/TLS/proxy verification, real secret
custody, independent backup storage and verified schedule/alert delivery, timed
off-device restore, and operator acceptance. The current recommendation is to
proceed to an authorized staging drill, not directly to production.

Phase 5 adds a verified encrypted logical backup/isolated restore path and encrypted
browser drafts. See [backup architecture](backup-and-recovery.md), [privacy migration](browser-data-privacy.md),
[recovery procedure](disaster-recovery-runbook.md), and [retention decision](data-retention.md).
No production backup, scheduler, alert or retention deletion has been configured.
Before rollout, the operator must provision/recover BROWSER_DRAFT_KEY, approve actual
backup storage/key custody and scheduling, verify hosting snapshot support, and run
a timed recovery drill. Any production restore/cutover requires separate explicit approval.
The next phase should verify operational staging, monitoring, backup cadence and
operator recovery usability on the actual host; do not infer production readiness
from the isolated test evidence alone.

Phase 4 extraction and approval controls are implemented and tested; see
[report](phase4-report.md), [AI contract](ai-rate-card-contract.md) and
[publication/rollout checklist](rate-card-publication.md). Before production:

- Verify configured model entitlement and a separately authorized live synthetic extraction.
- Review and explicitly publish legacy cards; deploy API and frontend/shared modules together.
- Confirm the actual commercial formula, exact CITY matching and invoice fuel/tax settings.
  Stored special conditions and broader destination types are not executed by final billing.
- Validate hosted resource limits, HTTPS sessions, service-worker update and backup recovery.
- Plan retention expansion before the 40-publication-per-shipper limit; never delete history silently.

Next phase should address staged operational verification, backup/restore drills and
explicit support for any business pricing rules outside the current contract.

Phase 3 authoritative arithmetic is implemented; see [the billing contract](billing-calculation-contract.md)
and [verification report](phase3-report.md). New finalizations recalculate from
published cards, reject disagreements and store immutable calculation snapshots.
Operator/accountant approval of the documented tax/pricing assumptions and
deployment-specific validation remain required before production use.

Phase 2 invoice persistence is implemented: see [its guide](invoice-persistence.md)
and [verification report](phase2-report.md). Versioned saves, idempotent retries,
immutable final history, snapshots and print confirmation are complete. The
authoritative billing calculation refactor remains intentionally deferred.

Phase 1 security and single-operator authentication are implemented; see
[the security guide](security-and-authentication.md). Access control, strict CORS,
CSRF, MongoDB-backed sessions, upload/security dependency updates and cache
exclusions are complete. Persistence feedback and the remaining items below
are still pending; this is not authorization to deploy.

Phase 0 provides architecture documentation, isolated automated tests, safe
environment examples and a testable Express app factory. It does not declare the
application production-ready. Preserve the present layout and working workflows.

## Phase 1: protect access and make persistence reliable

1. Add one operator login/session with secure cookies, CSRF protection where
   applicable, bounded login attempts and an explicit session expiry. No roles,
   organizations or multi-tenant architecture are needed.
2. Replace wildcard CORS and the blanket Vercel suffix with explicit configured
   origins; serve UI and API over one HTTPS origin where possible.
3. Check invoice-save HTTP status and display actionable success/failure. The
   print wrapper starts persistence before validating the bill and does not wait
   for completion. Do not persist invalid/missing-rate bills before print
   validation succeeds; define whether printing requires a successful save.
4. Remove misleading rate-save success when backend persistence fails. Define
   local draft versus saved invoice status and a simple retry flow.
5. Redact provider/database errors and avoid logging PDF content or customer data.
   Review static-server path containment and prevent sensitive-file serving.

Acceptance: unauthenticated writes fail; the operator can save/reload an invoice;
failed writes stay visibly unsaved; tests cover each branch without real secrets.

## Phase 2: billing correctness and input contracts

Agree one documented billing contract before changing amounts. Resolve local
baseRate/pieces versus backend per-kg-only calculations, fuel and split-tax storage,
manual overrides, zero/negative/non-finite inputs, and money rounding. Validate
requests server-side, escape/limit search regexes, validate dates, and return stable
4xx errors. Fix next-period timezone behavior and paise carry boundaries. Add
regressions for these fixes, not characterization expectations preserving bugs.

Decide whether generated invoices become immutable and how corrections are
recorded. Current invoice-number upserts can overwrite earlier records. Preserve
old invoice totals; do not recalculate historical invoices automatically.

## Phase 3: durability, offline behavior and operations

Exclude API/customer responses from the service-worker asset cache. Test cache
upgrade/offline flows and import schema validation. Remove customer-like defaults
from new-user initialization only after a safe transition is agreed; do not reset
existing localStorage. Add bounded upload handling, dependency upgrades (Multer 1
is deprecated with security warnings), readiness checks, graceful shutdown and
minimal redacted operational logs. Verify actual dependency advisories before
release; an offline install audit result is not a security assessment.

Add a private backup/restore procedure with a tested synthetic restore drill,
retention and storage access rules. Never place backups in Git. Introduce CI using
the same isolated suites, pinned toolchain and cached test binaries. No deploy,
push or merge is authorized by this phase.

## Migration and rollback

Phase 0 needs no schema/data migration and does not touch stored invoices. Existing
server start commands stay valid. Express construction moves to server/app.js;
tests import that factory instead of starting server/server.js. Test mode now
refuses the ordinary entry point and database connector. Install root dev
dependencies and the browser binary before running tests.

Before future data changes: document schema/version changes, rehearse with
synthetic data, obtain approval for production work, make a private verified
backup, and specify rollback before applying a migration. Keep the existing
localStorage key until an explicit versioned migration is tested. Historical
amounts and identifiers must survive migration unchanged.
