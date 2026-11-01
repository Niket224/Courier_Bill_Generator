# Coordinated rollback runbook

No production rollout or rollback was performed. Local tests prove request/version guards, service-worker cache handling, graceful restart, idempotent persistence and restoration to fresh databases; they do not certify arbitrary historical release compatibility.

Stop rollout for readiness failure, login/CSRF/cookie regression, invoice reconciliation failures, unconfirmed backup, unreadable browser vaults or mixed frontend/backend protocol. Preserve drafts and request IDs. Do not run a schema downgrade, delete rate versions, clear browser storage or restore over an existing database to make the UI work.

1. Stop new writes through the approved proxy/supervisor maintenance procedure. Send SIGTERM to the Node process and allow its configured drain plus database cleanup. Forced closure means write outcomes may be unknown, not necessarily failed.
2. Record the release/protocol and safe request IDs. Preserve current and previous release directories, environment secrets, the verified pre-release archive and browser export. Protect keys separately.
3. Check the prior release against the current schema and archive/vault formats. Invoice schema 2/3, request IDs/revisions, calculation snapshots, approved RateBooks and encrypted browser storage must remain supported. **Never roll back to a pre-encryption or pre-approval client** merely because its page loads.
4. If compatibility is demonstrated, restore the previous application directory and matching static assets together using the host's approved release-switch mechanism. Keep the database unchanged. Start using `npm start --prefix server`, then check liveness/readiness and authenticated smoke flows.
5. Refresh clients and verify the active service worker. Current rollout deletes only obsolete Courier caches. A forced page refresh must not discard an encrypted pending operation; recover the vault with the same BROWSER_DRAFT_KEY and retry the original request after checking History.
6. If a data restore is genuinely necessary, obtain separate explicit production authorization and follow the [disaster runbook](disaster-recovery-runbook.md). Restore into a new database and inspect it before cutover; the provided CLI rejects remote/credential-bearing targets. Never merge diverged post-cutover writes automatically.
7. If rollback verification fails, retain maintenance mode and investigate. Keep the untouched original database as the fallback, and reconcile any new writes deliberately before moving back. Mark the incident unresolved rather than claiming recovery.

The exact supervisor commands, release-directory switch and TLS/proxy reload depend on the chosen host and are **BLOCKED until that host is designated**. The example Nginx configuration must pass `nginx -t` with actual paths/certificates before an approved reload; it was not installed or activated locally. No generic command here overwrites an existing database.
