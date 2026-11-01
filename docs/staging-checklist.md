# Staging acceptance

## Verified locally

- Disposable MongoDB instances and a one-node replica set with synthetic records only.
- Authenticated invoices, CSRF, sessions, exact calculations, rate publication/rollback, encrypted browser migration and all prior regressions.
- Encrypted archive creation, manifest/count/checksum validation, fresh isolated restore, index/reference verification, original invoice totals and historical printing.
- Wrong key/corrupt archive rejection, interrupted restore quarantine, source/session exclusion, safe rollback to an untouched source rather than destructive merge.
- Readiness dependency failure, real listener drain/forced shutdown, app restart with retained session and persisted invoice, protocol mismatch and service-worker cache transition.
- Local measured API/backup/restore timings and synthetic Chromium 100-shipment rendering/print-text capture. Measurements are attached to the report, not extrapolated into production guarantees.

## BLOCKED: representative hosted staging

No designated hosting provider, staging database, TLS domain, protected secret store, external backup mount, scheduler or alert destination was supplied or provisioned. The complete representative hosted staging drill remains **unverified**. Local tests do not prove TLS/proxy behavior, off-host durability, real customer volume performance, RPO/RTO or actual notification delivery.

Before authorizing deployment:

1. Operator designates a disposable staging environment and approves any cloud costs. Use a separate database/account with no production credentials or customer records.
2. Provision HTTPS/same-origin routing, verified proxy trust, model/session indexes, secret custody and stable browser key. Verify actual Atlas backup/transaction capabilities and resource limits.
3. Seed synthetic customers, shipments and DRAFT/GENERATED/PAID/CANCELLED/corrected invoices with multiple approved rate versions. Do not copy production records merely to make staging representative.
4. Run a supervised backup job and verify its independently stored copy. Confirm that capacity failures, unavailable source/copy, stale age and missing archive produce an alert that actually reaches the operator.
5. Restore to a new isolated database; verify counts, indexes, original totals, relationships, login with fresh security configuration, historical search and printing. Confirm old bills retain old rates.
6. Test wrong keys, a damaged copy and interrupted restore; reject and quarantine them. Keep the good source and archive unchanged. Approve cleanup of disposable resources explicitly.
7. Time the entire human recovery procedure, including key retrieval, host startup and browser acceptance. Compare measured results with the proposed 24-hour RPO/4-business-hour RTO and revise with the business.
8. Exercise coordinated update and rollback with an old open browser tab, encrypted pending save, refresh, logout and changed frontend assets. Do not regress to plaintext-storage clients or remove protocol guards.
9. Record release ID, safe counts, durations, checks and operator acceptance without secrets/customer documents. Authorize production deployment separately only after this checklist passes.
