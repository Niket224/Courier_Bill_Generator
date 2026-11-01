# Retention and archival decisions

No new automatic deletion or retention schedule is enabled. The following operational recommendations require **explicit operator approval** before enforcement: keep 7 daily, 4 weekly and 12 monthly verified encrypted business archives, plus pre-upgrade and accepted recovery archives. The appropriate financial-record retention period must be confirmed with the operator's accountant; these copy counts are not a legal retention policy. Retain the keys for every retained encrypted archive.

Prefer off-device encrypted archival to deletion. Never delete the last verified archive or its only key copy. Validate replacements and complete a restore drill before any approved cleanup. Document the selected files and expected consequences before executing deletion; no cleanup commands run as part of this phase.

## Rate cards: existing safety cap retained

The limit remains **40 approved versions per shipper** with a 256 KiB card cap. It is an append limit, not a deletion policy. All earlier versions remain in the RateBook and backups; no background cleanup exists and therefore none can race publication. A UI warning appears from version 35 when loading publication status after draft save. The 41st publication fails atomically without changing the active version.

Rollback appends a new approved version, so it is also blocked at the limit. This is a documented operational limitation: arrange an approved storage/archive extension **before** reaching 40 if continued publication or rollback is required. Do not manually remove versions or reset revisions to bypass it. No cap was silently raised or lowered.

Current draft cards remain editable with revision receipts up to the existing 1,000-operation limit; they are not complete per-edit snapshots. Every published revision stores its own immutable card and source draft revision. Backups preserve these records and their receipts. Historical invoices carry their original calculation/layout snapshots, so printing does not depend on the latest active card. Audit/reference verification during restore still requires retained source versions; this phase does not implement a version-deleting archive migration.

Automated tests make 41 publication attempts, verify that 40 retained versions and their active pointer remain unchanged, and check rollback rejection without history loss. Normal rollback before the cap remains covered by Phase 4 regressions. Browser archives also have no automatic purge; export and obtain explicit approval for any future cleanup. Browser quota failures stop replacement and offer recovery rather than deleting old work.
