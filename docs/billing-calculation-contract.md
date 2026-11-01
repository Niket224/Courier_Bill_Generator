# Billing calculation contract — courier-v1

## Inspection before implementation

The browser uses `(baseRate + max(0, weight-baseKg)*perKgRate)*pieces`.
The old backend uses `max(weight, baseKg)*perKgRate`, without pieces/base charge.
Phase 2 persistence accepts supplied totals and marks them unverified. Browser
fuel is charged on gross, then CGST and SGST on gross plus fuel. There is no IGST
selector. Manual amounts replace the complete shipment amount, without multiplying
pieces. Zero weight incurs the base charge. Phase 2 rejects duplicate trimmed AWBs.
Amount-in-words previously could produce 100 paise without carrying the rupee.

## Agreed compatibility contract

Preserve the browser's intended formula. Weight is total row weight as entered;
pieces multiply the complete row charge. Do not invent dimensional weight, slab
ceilings, weight increments, geographic tax classification, or minimum positive
weight. Zero weight remains permitted and incurs the base charge. Zero base/extra
rates are valid. Pieces must be a positive integer. Negative/nonfinite/blank or
unsupported numeric input is invalid. Maximum 1,000 shipments; duplicate trimmed,
case-sensitive tracking numbers are rejected, matching Phase 2.

Use exact decimal arithmetic (BigInt scaled decimal inputs), never binary floating
point for financial operations. Accept up to six decimal places for weights/rates/
percentages; reject greater precision instead of rounding weights. Round each line
once to paise, half up; gross is the sum of rounded lines. Fuel is gross times the
configured percentage, rounded to paise. Subtotal is gross + fuel. Each active tax
component is subtotal times its percentage rounded separately. Final is the exact
sum of subtotal and active taxes. No whole-rupee rounding. Manual overrides must
already be whole paise and replace the complete line, including all pieces.

Tax modes: SPLIT uses configured CGST and SGST (existing defaults preserved), IGST
uses an explicitly entered IGST percentage, NONE has all percentages zero. Mutually
exclusive components are rejected. These are arithmetic settings, not legal or
tax-exemption determinations; the operator/accountant chooses the correct mode.

## Trust and historical boundaries

The shared pure module is used by browser previews, backend invoice verification,
and the existing rate endpoint. Invoice verification uses exact destination/shipper
cards published to MongoDB with an explicit baseRate, preserving local exact-match
behavior. The old rate endpoint keeps its selection fallback but uses the same
pricing engine. Legacy cards lacking baseRate are adapted for read-only estimates
and must be reviewed/published explicitly before invoice finalization.

Publishing local rate edits is separate from finalization. Finalization never writes
rate cards from invoice input. The server derives every line/component and compares
all supplied amounts and snapshots. Mismatch blocks finalization and provides
structured reconciliation; amounts are never silently replaced. Manual overrides
are explicit authenticated operator inputs, recorded in the calculation snapshot.

Committed request replay is checked before consulting current cards. Changed
payloads cannot reuse a request ID. New finalizations store the engine version,
rate snapshots/versions, tax configuration, integer-paise components and words.
Historical final invoices are read/printed from their stored record, never current
rates. Existing unverified invoices are not retroactively certified or rewritten.

## Operator/accountant review

Confirm the existing weight-times-pieces interpretation, zero-weight base charging,
per-line half-up rounding, manual overrides replacing the whole row, fuel taxability,
configured split/IGST/NONE modes and tax percentages. No inference about legal tax
eligibility is made. Sub-paise overrides, ambiguous legacy base charges, and inputs
beyond six decimal places require explicit review. Binary floating-point rounding
accidents are not preserved as pricing policy; golden examples document differences.

## Exact pipeline and bounds

Inputs are parsed as decimal integers at scale 1,000,000. For a non-manual line:
`round_half_up((baseRate + max(0, weight-baseKg)*perKgRate)*pieces*100)`
produces integer paise. No intermediate weight/rate product is rounded. Manual
amounts must be divisible into whole paise already. Fuel and each tax are rounded
once at their component boundary. Summing paise requires no additional rounding.
Percent totals and displayed tax sums use the same decimal/paise helpers.

The technical amount ceiling is Rs 1,000,000,000,000 per line/invoice, with at most
1,000 rows and 100,000 pieces per row. Percent inputs are bounded to 0–1,000.
Negative/nonfinite inputs and overflow are errors. Numeric serialization that
would lose the entered precision is rejected. These are software bounds, not
new slab increments or legal tax limits. New final requests require explicit
weights and financial claims; omission is not treated as deliberate zero.

## Server verification and storage

POST `/api/invoices/calculate` is authenticated and CSRF-protected. It accepts the
validated invoice envelope and returns the authoritative result plus mismatches.
POST `/api/invoices/save` performs the same derivation before GENERATED; a mismatch
returns 422 CALCULATION_MISMATCH with expected components and field differences.
Missing/unreviewed exact cards return RATE_REVIEW_REQUIRED. The client must review
and correct its draft or explicitly publish/load cards, not blindly accept a
changed amount. New final requests cannot rely on the old implicit 18% claim default.

Drafts may remain provisional/unverified, so incomplete financial setup does not
destroy work. The old Phase 2 fallback claim normalization is frozen solely for
old hashes and unverified legacy-shaped drafts. It is not the pricing authority
and cannot finalize a new invoice without explicit claims/configuration.

New writes use schemaVersion=3; concurrency still uses the existing revision and
global request IDs. Verified finals set totalsVerified=true and store
calculationContract=courier-v1 plus calculationSnapshot containing integer-paise
components, rounded rupee outputs, words, input weights/pieces/manual overrides,
tax configuration and server rate IDs/revisions/values. This certifies arithmetic
against those inputs/cards, not the legal tax choice or an operator's manual price.

Rate cards gain optional baseRate and revision. Publishing changes current cards
only. Financial verification takes one captured set of cards and records the
exact versions used; later changes cannot affect that saved snapshot. The legacy
rate endpoint retains its selection hierarchy for estimates, while invoice
verification uses the exact labels supported by the existing browser editor.
Labels such as a state name can be published as exact destination labels; no
unapproved geographic expansion is added to browser invoice pricing.

## Compatibility, deployment and rollback

No production migration runs. Existing invoices, including unverified schema-2
finals, remain unchanged/readable and can complete their existing lifecycle.
Old committed requests are replayed before current-card lookup or new financial
requirements. A fixed hash captured from the committed Phase 2 validator is a
regression fixture. An edited request cannot reuse that key. Older pending,
uncommitted final requests may require an updated draft and published rates.

Deploy the API, shared billing asset, browser adapter and service-worker asset
version together. The server deployment must include `mobile-bill-app/billing.js`
at its repository-relative path; a server-directory-only upload is insufficient.
Retain released engine source/version artifacts for future reproduction. Before
use, the operator must review local cards and select
Publish local rates. Missing base charges are never automatically migrated into
approved cards. Existing local data and historical snapshots are not rewritten.
Load published rates archives the current draft first. The same authenticated
rate-write permissions remain; partial publication failure cannot produce a
verified invoice whose preview differs from the captured server cards.

Rollback must first disable invoice/rate writes at the reverse proxy and retain
a private verified backup. Older Phase 2 code refuses schema-3 mutations, but can
still create unverified schema-2 invoices: reverting without a read-only gate
would undo the new assurance. Preserve schema-3 documents and the compatible
reader/renderer; never downgrade or recalculate them automatically. Re-enable
writes only after a compatible fixed engine is deployed and staging tests pass.

Manual staging checks: review the golden examples with the operator/accountant;
publish approved cards; verify each tax mode; inspect real print/PDF output and
words; test a conflicting card update and lost acknowledgement; reopen historical
invoices after changing cards; verify service-worker upgrades, body limits and
same-origin HTTPS sessions. Tests use synthetic data and disposable MongoDB only.
