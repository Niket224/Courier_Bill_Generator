# Rate-card publication and recovery

1. Upload a supported PDF or choose **Review local rates**.
2. Review every destination, type, independent base charge, extra charge, formula, minimum, fuel reference and conditions. Resolve blanks and duplicates.
3. **Save as draft** confirms a server draft revision. Active pricing is unchanged.
4. Check explicit approval after reviewing warnings, then **Publish** and confirm. Only a successful backend receipt changes the local active table.
5. To roll back, load a server draft for the shipper, select a previously approved version, check approval, and confirm rollback. It appends a new approved version; no historical version or invoice is rewritten.

## Storage and atomicity

`RateCardDraft` holds editable reviewed cards with optimistic revisions. `RateBook`, keyed by normalized shipper code, holds immutable approved snapshots, operator identity, timestamp, draft revision, request ledger and active-version pointer. Publication appends the version, receipt and pointer in one MongoDB document update using revision compare-and-swap and majority write concern. This needs no multi-document transaction or new service. Two conflicting publications cannot both win. A draft edit after publication capture does not change the captured revision.

UUID request IDs bind canonical payloads to operations. Repeating the same request replays its receipt; changing its payload returns 409. An uncertain network outcome retains the exact request locally and locks edits until retry. A receipt for an older operation after another publication is not presented as the current active version; reload server state and review before proceeding. Definitive validation/conflict errors require review again. Database or HTTP failures never imply success.

There is a conservative limit of **40 retained publications per shipper**, 256 KiB per card, and 1,000 operations per draft. Reaching a limit fails without deleting history. Plan an approved archival/storage migration before reaching it; there is no automatic purge.

## Compatibility and rollout

Existing `Rate` documents and invoice calculation snapshots are untouched. Legacy rate reads remain available for estimates, marked as needing review; legacy POST upserts now return `PUBLICATION_REQUIRED`. Older API clients must adopt draft/publication endpoints. Existing Phase 3 cards do not contain this phase's explicit approval evidence, so they must be reviewed and published before new rate-derived final invoices can use them. Existing issued invoices remain readable/printable unchanged. No migration was run and no legacy data was deleted.

Final invoice verification reads one approved active snapshot and stores its version provenance with the invoice. Manual pricing overrides retain the Phase 3 explicit-override policy. Publishing or rolling back never reprices issued invoices. Deploy backend, shared contract/billing modules, frontend and service-worker assets together; the server imports shared modules from the frontend directory.

## Privacy and recovery

Review edits and pending operation envelopes survive refresh and sign-in on the same device. Logout clears private rendered UI and aborts pending requests; reauthentication offers **Resume review**. Replaced local reviews are archived rather than silently overwritten. These drafts are **not encrypted** and remain accessible to a person with access to the browser profile. Use a dedicated secured operator device. No credentials/tokens/PDF bytes are stored in this review state. Use **Load server drafts** to recover a confirmed draft from another browser; unsaved browser-only edits cannot be recovered there.

## Manual staging checklist (not executed)

- Back up through the business's approved process; review legacy cards and publish synthetic/staging cards first.
- Install locked dependencies with `npm ci` and `npm ci --prefix server`; install Chromium with `npx playwright install chromium` for QA.
- Configure HTTPS sessions/CORS as in [security documentation](security-and-authentication.md), explicit model entitlement and optional Gemini key. Do not overwrite an existing environment file.
- With separate authorization, parse a non-sensitive synthetic quotation against the configured live model; check independent base charge, missing fields, quotas, timeouts and model errors.
- Review a representative supported PDF and verify conservative rejection/re-export guidance for unsupported PDFs.
- Confirm explicit publication, reload, concurrent-tab conflict, uncertain-response retry, rollback and unchanged issued invoice printouts.
- Verify reverse-proxy limits, memory usage, log redaction, cookie/CSRF behavior, service-worker update and authenticated API non-caching on actual hosting.
- Verify replica-set majority durability/backups and plan archival before 40 versions; automated tests use isolated local MongoDB, not production infrastructure.
