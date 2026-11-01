# Single-operator operations

No production scheduler, supervisor, external storage or alert integration is configured. The following is a proposed operating procedure requiring operator approval and host-specific verification.

## Startup and shutdown

`npm start --prefix server` validates configuration, connects MongoDB, verifies restore quarantine, creates session storage and required model indexes, then listens. Missing/weak critical settings fail safely. Database connection selection is bounded to 5 seconds, socket waits to 30 seconds. HTTP header intake is bounded to 10 seconds, request intake to 45 seconds, inactive sockets to 60 seconds, keep-alive to 5 seconds. Application-level invoice/AI retry envelopes remain idempotent and bounded.

SIGTERM/SIGINT marks the process draining, rejects newly admitted business requests with 503, stops accepting connections, closes idle sockets and waits up to SHUTDOWN_TIMEOUT_MS for active HTTP requests. It then force-closes remaining connections if needed and disconnects MongoDB. Allow at least 45 seconds in the service supervisor for database cleanup. Forced drain has nonzero exit status; uncertain writes must be retried with the preserved request ID. A disconnect is never evidence that a write did not commit.

## Backup job, not an activated schedule

The [job environment example](../ops/backup-job.env.example) defaults to **not approved**. Configure it in the scheduler's protected environment, not a public workflow. The app/CLI do not automatically load this file.

After approval, run one job manually:

```sh
npm run ops:backup-job
```

Required environment: BACKUP_JOB_APPROVED=yes, explicit BACKUP_SOURCE_URI/DB, BACKUP_KEY_FILE, BACKUP_LOCAL_DIR and BACKUP_COPY_DIR. Key material must be outside both archive directories. Both destinations must exist, be outside the repository and not be nested in each other. Use an independently mounted off-host encrypted destination; different local directories alone do not prove disaster independence.

The job acquires an exclusive lock, checks free space at both locations, runs the existing verified backup CLI with a two-minute process timeout, authenticates the local archive, copies/verifies the encrypted archive and only then writes a safe success receipt. Source capture still requires replica-set support and remains limited to 64 MiB. Failures return nonzero and retain the previous success timestamp and completed archives. There is no deletion step. A process crash can leave `.backup-job.lock` and `.partial` files; do not remove them until an operator verifies no job is running and preserves relevant evidence.

Propose daily execution after the billing workday, plus pre-release/manual runs; propose server-data RPO 24 hours and RTO 4 business hours, subject to business approval and a representative timed restore. Local synthetic timings do not establish these objectives. Browser-only edits require server saves or off-device exports.

On an approved Linux host, an administrator may configure its scheduler to run `npm run ops:backup-job` from the release directory with the protected environment. On Windows, use Task Scheduler with the correct Node/npm paths, working directory, secured operator account and non-overlapping jobs. Do not blindly copy a cron/task definition across hosts. Record the actual next-run time, execute a supervised test and prove a failure reaches the operator before calling the schedule active.

BACKUP_RETAIN_COUNT supplies a planning-only retention count. The helper never proposes deleting the newest known-good archive and never executes cleanup. The Phase 5 daily/weekly/monthly suggestions remain unapproved; selecting a count does not authorize a different policy. Key retention must cover every retained archive. Validate an independent restore before any separately approved cleanup.

## Daily checks

```sh
npm run ops:monitor
```

Set MONITOR_BASE_URL, BACKUP_STATUS_FILE, BACKUP_COPY_DIR and the approved age/capacity thresholds. The monitor checks live/ready responses, recent verified receipts, local archive presence, copy size/presence and space at both destinations. Wrong/missing configuration is an alert, not success. A size check does not prove cryptographic integrity: the backup job performs authenticated verification and periodic restore drills remain necessary. Protect receipt files with OS ACLs; they are not remotely attested evidence.

Record safe exit codes and timestamps, not customer documents. Keep the browser key, independent business-backup key, session secret and admin hash in protected custody. Do not rotate BROWSER_DRAFT_KEY without exporting/migrating existing vaults; do not rotate a backup key and discard the key for retained archives. Session-secret rotation logs users out; password changes revoke existing sessions.

See [monitoring](monitoring.md), [the recovery runbook](disaster-recovery-runbook.md), and [rollback](rollback.md).
