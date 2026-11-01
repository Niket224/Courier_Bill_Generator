# Disaster recovery runbook

Phase 6 adds a guarded, **not activated** [backup-job procedure](operations.md),
[monitoring](monitoring.md), and [representative staging checklist](staging-checklist.md).
Run `npm run test:operations` for the measured disposable local drill. Its safe
counts/timings are recorded separately from production RPO/RTO claims. Actual
`operator_sessions` and legacy `sessions` collections are both excluded; Phase 6
corrected the earlier exclusion-list mismatch without reading production records.

These commands are procedures, **not evidence that production backups or scheduling are configured**. Only synthetic isolated restores were executed in Phase 5. Do not overwrite production. Keep the application's locked dependencies and this document available off-device without credentials.

## Prepare once

Install Node 24 and dependencies from the repository root:

```powershell
npm ci
npm ci --prefix server
npx playwright install chromium
```

Create private directories outside the repository on a protected encrypted volume. In the examples, `D:/CourierRecovery` is an operator-selected example location, not an existing configured path. Restrict Windows ACLs to the operator (POSIX uses mode 0600 on created files). Verify the destination filesystem supports hard links used for non-overwriting archive promotion. Keep keys separate from archives and off-device, in a protected password manager or encrypted removable medium.

```powershell
npm run business:backup -- keygen --key-file D:/CourierRecovery/keys/business.backup-key
```

Never overwrite an existing key. Copy it securely to a second recovery location and verify that copy; losing it loses access to the archives. Separately generate BROWSER_DRAFT_KEY as described in the environment example, configure it on the server and protect its recovery copy. The two keys serve different purposes and must not be reused. Do not put either key in a command-line argument, customer archive, source tree or chat.

## Create and verify

Provision `BACKUP_SOURCE_URI` and `BACKUP_SOURCE_DB` in the trusted process environment through the hosting secret store. Use a dedicated read-only database user with collection/index enumeration and snapshot-transaction read permissions. Do not paste credentials into shell history. The CLI never loads dotenv or uses MONGO_URI as a fallback.

```powershell
npm run business:backup -- create --authorize-read yes --key-file D:/CourierRecovery/keys/business.backup-key --out-dir D:/CourierRecovery/archives
```

Require exit code 0 and `VERIFIED_BACKUP`; record its UTC timestamp, filename and count summary. The archive name includes format version, UTC time and a random UUID. Independently verify after copying off-device:

```powershell
npm run business:backup -- verify --key-file D:/CourierRecovery/keys/business.backup-key --file D:/CourierRecovery/archives/SELECTED.cbackup
```

`SELECTED.cbackup` means the exact completed filename returned by creation. Do not treat `.partial` as a completed backup. A wrong key, changed authenticated header/tag, checksum mismatch, incompatible schema or broken reference returns nonzero. Do not retry blindly over the same file or delete the previous good backup.

## Restore into isolation

Start an isolated local MongoDB instance using an empty operator-created staging directory and a dedicated port. Example (requires installed MongoDB server tools):

```powershell
mongod --bind_ip 127.0.0.1 --port 27028 --dbpath D:/CourierRecovery/staging-mongo
```

Use a second shell:

```powershell
$env:RESTORE_MONGO_URI='mongodb://127.0.0.1:27028'
npm run business:backup -- restore --key-file D:/CourierRecovery/keys/business.backup-key --file D:/CourierRecovery/archives/SELECTED.cbackup
```

The URI must have an explicit loopback IP/port and no credentials, database name, cloud host or options. Each restore creates a new `courier_restore_<random-id>` database. There is no overwrite/merge/drop flag and no production restore option. Even a second attempt uses a new database.

The archive is authenticated and checked before writes. The fresh target starts `RESTORING`; complete raw records and indexes are restored, application indexes ensured, every record/count/checksum verified, and invoice/customer/correction/rate references and stored financial figures checked. Only then is the target marked `VERIFIED`. Stale sessions and secrets are absent. Original amounts and snapshots are not recalculated against current cards.

Failures retain a quarantined target marked `FAILED` (or `RESTORING` if process/database loss prevented the update). Application startup rejects incomplete restored databases. Do not clear that marker to bypass verification. Retry from a validated archive into a new target. Removing failed staging databases is a separate, explicitly approved cleanup; the tool never deletes them automatically.

## Recovery acceptance before any cutover

1. Require `VERIFIED` and inspect the six collection counts. Verify unique invoice/shipper/rate/idempotency indexes.
2. Launch a separate staging app with fresh authentication/session secrets and the recovered browser key only if browser drafts must be opened. Never restore session collections.
3. Search by invoice number, shipper, date and tracking number. Open generated and paid invoices; compare customer fields, every shipment, period, base charges, fuel/tax totals and original printed output against approved records.
4. Verify cancelled status and correction links. Compare the stored approved rate history and active version. Try a new synthetic calculation separately; it must not change historical totals.
5. Test login/logout, CSRF, encrypted browser migration and an uncertain-save retry. Record duration and any missing legacy fields.
6. Verify a second off-device archive/key copy is usable. Record who approved recovery and which archive was used without recording secrets or documents in public logs.

**Production authorization is required separately** for any new hosting cost, scheduler/alert service, retention/deletion policy, target migration or application cutover. Stop production writes in an approved maintenance window, retain the old database untouched, take a fresh verified archive, restore to a separate protected staging/target, and obtain explicit operator acceptance before changing application configuration. This CLI intentionally does not automate a cloud production restore. Use the hosting provider's approved restore path after its permissions/version compatibility have been checked.

If cutover verification fails, stop the new app and point back to the untouched old database only after assessing any writes made after cutover. Never merge two diverged financial histories automatically. A qualified operator must reconcile those writes deliberately.

## Automated test-only drill

```powershell
npm run test:unit
npm run test:integration
npm run test:e2e
npm test
npm run test:coverage
```

The harness strips production credentials and creates owned loopback MongoDB instances, including a one-node replica set for consistent backup. It seeds synthetic clients, shipments, generated/paid/cancelled/corrected invoices and multiple rate versions, encrypts/decrypts and restores them, verifies full records/indexes, and serves the restored database on test port 4190 for historical printing. No external test URI is accepted. This proves isolated recovery, not production storage durability or provider backup scheduling.
