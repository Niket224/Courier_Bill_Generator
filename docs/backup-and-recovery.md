# Business data backup and recovery

## Inventory from the current source

No production connection, dotenv secret, hosted tier, provider backup configuration or customer database was inspected. The source uses Mongoose with `MONGO_URI`, described as Atlas, but has no deployment manifest establishing actual hosting. No IndexedDB use was found.

| Class | Location / content | Recovery treatment |
| --- | --- | --- |
| Critical business records | MongoDB `invoices`: embedded shipments, customer fields, immutable layout/calculation snapshots, tax/amounts, status, correction links, cancellation/payment operation history and idempotency receipts | Include complete raw documents; never recalculate on restore |
| Critical business records | `clients`, standalone `shipments`, legacy `rates` | Include all documents and references, even if newer UI uses embedded shipments |
| Critical audit/pricing history | `ratebooks`: approved versions, operator/time, active pointer and receipts; `ratecarddrafts`: current draft and revision operation ledger | Include both together; retain every stored version |
| Temporary but valuable browser drafts | Current bill, unsaved shipments/rates, settings/images, rate review, pending save/publication/status requests, archived bills/reviews | Encrypted browser vault; export separately before device loss. Unsubmitted browser-only data is not in MongoDB |
| Recoverable configuration | Node/app version, environment variable names, host/proxy/CORS setup | Source and documentation; keep actual secrets in a separate password manager |
| Security-sensitive | `sessions`, password hash, session secret, Gemini key, browser encryption key, independent backup key | Excluded from business archive; reconfigure authentication separately, never restore stale sessions |
| Regenerable cache | Service-worker static assets | Excluded; update/reinstall assets. Authenticated API responses are not cached |
| Recovery control | `_recovery` staging marker | Created anew on restore; excluded from archive |

Important limits: old invoice documents may never have stored a complete visual snapshot. Their original records remain readable/downloadable, but missing original details cannot be invented. Draft revisions retain operation evidence and the current draft, not a full historical copy of every edit. Browser data deletion loses unsaved local work unless exported or explicitly saved to the server. The new clean-browser template contains empty business/customer fields instead of the former bundled sample records; existing stored drafts are unchanged.

## Two complementary backups

1. **Business archive:** repeatable authenticated-encrypted MongoDB export using [CLI](../server/scripts/business-backup.js). It captures all six business collections in one read-only snapshot transaction, committed with majority concern. Replica-set support is required; standalone databases fail rather than producing an inconsistent export. Do not perform schema/index changes during capture (index metadata is collected before the transaction). Unknown collections require an inventory review; they are never silently skipped.
2. **Browser export:** Tools → Export browser data. Includes browser settings, active draft and recovery archives, with format version and validation. This JSON is explicitly unencrypted and private; place it immediately in an encrypted drive/container or protected encrypted storage. It is not a replacement for the business archive.

The logical business archive is limited to 64 MiB and 100,000 records per collection. Memory use is higher than archive size because records and encryption buffers coexist. If the limit, unsupported BSON representation or transaction lifetime is exceeded, the operation fails; use an approved provider snapshot/native backup for larger databases. Never split related data casually into unrelated exports.

## Encryption and manifest

Business archives use Node's standard AES-256-GCM implementation with random 96-bit IVs, 128-bit authentication tags and authenticated format headers. An independent random **32-byte binary key file** is required; it is not a password, is not generated inside the archive, and is never printed or included in exports. A key holder can decrypt and create archives; this is authenticated encryption, not independent digital signing.

The encrypted manifest contains format `courier-business-backup`, version 1, application version 1.0.0, schema version 5, UTC creation time, collection inventory, counts, index definitions and SHA-256 document checksums. BSON Extended JSON preserves IDs/dates and supported numeric data. Checksums detect record mismatch; AES-GCM supplies confidentiality and keyed integrity. Version/schema mismatches, unknown collections, broken references, missing fields and changed totals fail before restore.

Creation writes a uniquely named UTC/UUID `.cbackup.partial`, syncs and verifies it, then promotes it without overwriting any existing archive. A failed/interrupted file is never announced as a completed backup. The CLI emits only safe metadata or a generic failure and nonzero exit code, never documents, keys or connection strings. No backup HTTP endpoint exists: access requires the operator's OS account, source credentials, key file and explicit read authorization.

## Hosting and managed backups

Check the actual account's backup screen, last successful snapshot and restore eligibility. Do not infer availability from a connection string. MongoDB currently documents [Flex daily backups](https://www.mongodb.com/docs/atlas/backup/cloud-backup/flex-cluster-backup/) and a gradually rolled-out optional [Free-tier backup preview](https://www.mongodb.com/docs/atlas/backup/cloud-backup/free-cluster-backup/); neither proves this account is configured. Dedicated-tier policies also require verification. Keep an independent encrypted copy outside the database provider when feasible.

For a standalone server or unsupported logical export, have the operator approve a maintenance window, stop all writers, take a consistent native backup or encrypted filesystem snapshot using the host's supported tools, and restore it into isolation. Tool version, encryption destination, credential handling and restore procedure must be checked for that actual host before executing; no such operation was performed here.

## Proposed objectives and monitoring (not configured)

Propose a server-data RPO of **24 hours**, plus a fresh archive after a billing run and before upgrades; propose an RTO of **4 business hours**, subject to a timed staging drill. Browser-only edits have no off-device recovery guarantee until exported or saved. Prefer two encrypted copies on different media, one off-device, with a separate recoverable key copy.

No scheduler or alert integration has been installed. An operator-approved scheduler should run the documented command, check its exit code and `VERIFIED_BACKUP` result, alert if no verified archive is newer than 24 hours, verify upload/copy completion and run regular isolated restore drills. An existing file alone does not prove a completed backup. Never use GitHub, the repository, customer documents in test fixtures or public cloud buckets as backup storage.

Retention suggestions require explicit approval; see [retention policy](data-retention.md). Exact commands and production precautions are in the [runbook](disaster-recovery-runbook.md).

Technical references: [MongoDB snapshot guarantees](https://www.mongodb.com/docs/manual/reference/read-concern-snapshot/), [Node crypto](https://nodejs.org/api/crypto.html), and [Web Crypto AES-GCM IV requirements](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams).
