# Phase 2: invoice persistence, integrity and recovery

Phase 3 retains these concurrency/recovery safeguards and adds authoritative
[financial verification](billing-calculation-contract.md). New writes use schema 3;
new finals carry verified calculation snapshots. Phase 2 historical amounts and
committed request hashes are preserved. References below to unverified totals
describe the Phase 2 baseline and remaining provisional/legacy records.

## Save and print flow

The browser validates the current invoice before creating a write request. It
retains the exact payload, UUID request ID, expected server revision and a content
digest in the existing local draft before sending anything. A single in-flight
save blocks duplicate clicks and edits. Requests use the Phase 1 authenticated
fetch helper, credentials and session-bound CSRF token.

The backend validates supported fields, calendar dates, status, amounts, shipment
structure, optional client references and snapshot identity. It then creates a
new invoice or atomically updates a matching DRAFT revision. The response must be
HTTP-successful with `success:true`, the expected invoice identity, revision,
status, amount and an operation entry containing this request ID. An HTTP 200
failure payload is not a save confirmation.

Final printing happens only after confirmation. For a previously finalized
invoice, the browser first fetches its current saved revision/status and prints
recorded snapshot totals and shipment amounts. It does not recalculate historical
amounts. A changed or cancelled revision blocks printing until history is reloaded.
There is no offline final-print fallback. Browser Print outside this controlled
path shows an instruction instead of an unconfirmed invoice. The existing invoice
paper layout is preserved; persistence controls are excluded from print CSS.

| UI state | Meaning |
| --- | --- |
| Unsaved | Current local edits have not been confirmed by the backend |
| Saving | Waiting for persistence or a saved-version confirmation |
| Saved | Backend confirmed the relevant snapshot; not independent financial verification |
| Failed to save | Validation, timeout, rejection or unconfirmed response; final printing blocked |
| Offline | Transport unavailable; local work and unresolved request retained |

A print-dialog failure leaves the state Saved and reports a printing error.
Save confirmations do not imply that a printer or PDF destination completed output.

## Lifecycle and concurrency

`DRAFT -> GENERATED -> PAID` is the ordinary lifecycle. Print can atomically
finalize a new local draft without an intermediate server draft. An explicit
Save draft creates/updates a server DRAFT. A generated or paid invoice's billing
contents cannot be edited through the save endpoint, even with a fresh request ID.

DRAFT, GENERATED and PAID may transition to CANCELLED with a required reason.
Cancellation retains all contents and earlier lifecycle events; it cannot reopen
the invoice. A correction creates a different invoice number with `correctionOf`
and `correctionReason`, referring to an existing GENERATED, PAID or CANCELLED
record. It does not alter that source record. Cancellation and correction are
separate explicit actions; this is not an automated credit-note/accounting policy.

Each mutation increments `revision` and appends one operation containing the
request ID, canonical payload hash, resulting revision/status, action, timestamp
and (for lifecycle actions) reason. Data and operation history are in the same
MongoDB document and update atomically. Compare-and-swap filters include revision
and status. There is no blind upsert, multi-document partial update, or delete API.
Writes request majority acknowledgement with a five-second write-concern timeout.
Network/write-concern failures can have unknown outcomes; idempotency resolves them.

Indexes:

- Existing unique invoiceNumber index prevents duplicate numbers.
- Unique partial multikey index on operations.requestId prevents a request ID
  from creating or changing a different invoice. Documents without such IDs are
  excluded, so legacy documents are not rewritten.
- Shipper/date compound index supports history retrieval.

Writes wait for index initialization. A disconnected database rejects writes
instead of buffering them. Index build failures fail writes closed. Existing
duplicate data must be reviewed separately; this phase never deletes duplicates
or runs an automatic repair/migration. Audit history is capped at 1,000 operations
per invoice; exceeding it returns a conflict, never silently purges retry records.

## Retry behavior

Identical retries return the existing acknowledged operation rather than inserting
another invoice or changing finalized contents. Reusing a request ID with different
data or a different invoice is a conflict. Concurrent requests with the same ID
produce one operation. Concurrent different edits using one revision allow only
one winner; the other receives HTTP 409.

The browser timeout is 15 seconds. An aborted request is not proof that MongoDB
did not commit. Network errors, timeouts, server failures and uncertain success
payloads preserve the exact pending request across refresh. Retry is operator-
initiated, not automatic. It reuses that request even if local edits have since
changed; confirmation of an earlier snapshot never marks newer edits as saved.
An incomplete newer edit does not prevent resolving the earlier request.

Definite 400/409/413/422 rejections discard only the rejected request envelope,
not the draft. Corrected data gets a new request ID. CSRF/session expiry requires
sign-in and preserves unresolved work. Status changes similarly retain their
pending request in local storage until confirmed. A replay response includes
`operationVersion`; if later operations exist, `data.revision` may be newer. The
frontend refuses to print based on an outdated acknowledgement and directs the
operator to History.

## API contract

POST `/api/invoices/save` requires `requestId` (UUID v4), `expectedVersion` (0 for
a new invoice, otherwise the last confirmed revision), invoiceNumber, shipperCode,
invoiceDate (YYYY-MM-DD), shipments and status DRAFT or GENERATED. Existing field
names remain; bounded legacy shipment aliases cno/date/weight are accepted but
cannot conflict with awb/bookingDate/actualWeight. Monetary JSON values must be
finite non-negative numbers, not coerced strings/null/booleans. Unsupported fields,
invalid dates/statuses, duplicate AWBs, invalid pieces and malformed structures
are rejected. A GENERATED invoice requires shipments; a DRAFT can be empty.

POST `/api/invoices/:id/status` requires requestId, expectedVersion, status PAID
or CANCELLED, and a nonempty reason. Both endpoints retain Phase 1 guards.

Responses: 201 for a new invoice, 200 for an update/replay, 400 for invalid input,
401/403 for authentication/CSRF/origin problems, 409 for conflicting identity,
revision, lifecycle or immutable/legacy data, 413 for body size, and 503 when the
invoice database is already disconnected. Authentication-store failures may return
a safe 500 before the invoice handler runs. Errors never include customer payloads.

List/search keep the existing shape but omit the new large snapshot and operations
fields. Detail/download includes both. Search terms are bounded literal strings,
not executable regular expressions; invalid search dates/status/page filters are
rejected, and date-range boundaries use UTC. Invoice numbers remain trimmed and
uppercase; new writes restrict their character set and maximum length.

## Historical reconstruction and calculation boundaries

New browser saves include:

- Full business, recipient, branch, SAC, invoice/period and tax/fuel settings.
- Logo/signature source data already supported by the application.
- Relevant rate-table snapshot and each shipment's source ID, AWB, date, origin,
  destination, receiver, type, pieces, actual/charged weight, recorded rate,
  manual override, matched rate snapshot and amount.
- Gross, fuel, subtotal, CGST, SGST and final totals; optional client reference,
  due date and notes; correction link and operation history.

`schemaVersion=2` identifies the new persistence contract. `reconstructionComplete`
indicates presence of a validated layout snapshot, not accounting correctness.
`totalsVerified` remains false. `calculationContract` is either
`browser-v1-unverified` or `legacy-api-v1-unverified`. Callers cannot override these
server-assigned markers.

Browser pricing is still `(baseRate + max(0, weight-baseKg)*perKgRate)*pieces`,
with manual overrides, then fuel and split taxes. Backend rate calculation still
uses `max(weight, baseKg)*perKgRate`; it has no equivalent baseRate/pieces model.
The persistence adapter records browser amounts. For legacy-shaped API callers
omitting totals, the old shipment-sum and combined-tax fallback remains unchanged.
Supplied totals are validated for representation/bounds, not independently priced
or certified. No pricing formula or historical total was migrated or recalculated.

The next phase should define a shared authoritative contract, rounding/precision,
charged weight, pieces, manual overrides, tax/fuel rules and versioned rate
selection. The persistence service is separate from validation and from future
calculation so that adding verification does not require rewriting stored history.

## Compatibility and browser draft privacy

Existing MongoDB documents stay readable and unchanged. Documents without
schemaVersion=2 are read-only, including legacy drafts, because they have no safe
revision/idempotency history. Do not fabricate missing artwork, pieces, fuel/tax
breakdowns, business addresses or original rate rules for them. Open downloads
their original record. Create correction starts an empty linked draft for manual
completion when a reconstruction snapshot is missing. New legacy-shaped API
writes without snapshots remain possible with the new request/version envelope,
but are explicitly marked reconstruction-incomplete.

The old write behavior is intentionally incompatible: repeated POSTs cannot upsert
over history, PAID cannot be supplied to save, and old clients without the new
envelope receive 400. Deploy the updated browser/API together and refresh old tabs.
The service worker asset version is bumped; authenticated responses remain excluded.
No new environment variables or dependencies are required.

The existing `courier-bill-app-v2` key is retained. The app now waits for server
authentication before reading or rendering its contents. Logout/expiry releases
the working state and replaces private DOM (invoice, forms, history and review
modal) with a clean template. Removing a hidden attribute does not reveal the
previous draft. Late authenticated responses cannot repopulate the workspace.

New Bill, import and history recovery archive the existing local draft first.
Tools can restore these archives; restoration archives the current draft too.
New Bill cannot clear work when archiving fails. Corrupt stored JSON is left
untouched and can be downloaded after authentication. Another tab changing the
draft triggers an archive/conflict warning rather than silently overwriting it.

LocalStorage and these archives are intentionally NOT encrypted or cleared on
logout. An encryption key stored beside the ciphertext would not protect against
the same browser/OS user or XSS; passphrase encryption requires a separate recovery
policy and an approved migration. Moving to IndexedDB alone would not add access
control. Preserve existing work now; use a dedicated operator OS account/device
and private backups. Future server-only drafts or passphrase-protected storage
must explicitly address offline access and lost-key recovery.

Browser storage can be cleared by its owner, exhausted, or evicted; it is not a
durable backup. Archive quota failures are explicit and block destructive draft
replacement. For failed local writes, keep the tab open and export a backup. New
saved server snapshots and JSON downloads provide additional recovery paths.
The existing 1 MiB request limit remains: oversized artwork can cause 413 and
must be reduced explicitly, never silently omitted. Legacy customer-like defaults
in the source bundle are not encryption-protected; replacing them needs a separate
approved default-data cleanup.

## Manual staging verification

Use only synthetic data in an approved staging environment:

1. Sign in, edit a shipment, Save draft, refresh, reopen History and edit the
   DRAFT. Confirm revision increments and complete metadata survives.
2. Click Print twice quickly. Confirm one write and no print dialog until Saved.
3. Interrupt the response after a server commit, then retry. Confirm the same
   request ID and one stored invoice. Repeat with offline/timeout/rejected input.
4. Finalize, mark paid, attempt to alter contents, then cancel with a reason.
   Confirm immutable contents and audit events. Create a new linked correction.
5. Open a legacy invoice. Confirm it is not changed and missing data is not
   invented. Download it or create a manually completed correction.
6. Verify the physical print/PDF result, artwork, page breaks and stored totals.
   Automated tests use a print stub; browser-specific print-dialog behavior still
   needs manual verification.
7. New Bill and restore an archive; verify the old server invoice stays intact.
   Test storage quota and two-tab conflicts, and privately export a recovery file.
8. Logout/expire mid-save and remove UI hiding in DevTools: no prior private DOM
   should remain. Raw localStorage access is still an OS/device privacy boundary.
9. Review index creation/permissions and write-concern behavior on the deployment's
   MongoDB topology. Tests use disposable standalone MongoDB, not a production
   replica-set failure simulation. Do not repair or migrate live data automatically.

Production backup/restore drills, storage retention, authoritative financial
calculations, timezone behavior of new-period defaults, and deployment-specific
offline/service-worker/HTTPS verification remain follow-up work.
