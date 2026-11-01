# Billing test cases and independent golden examples

The numeric expectations below are specified independently of the engine. The
machine-readable examples are in [billing-golden.json](../tests/fixtures/billing-golden.json).
The shared module is separately loaded as a browser script and as CommonJS to
check parity, but parity alone is not treated as proof of correctness.

## Golden line charges

Card: base 3 kg, base Rs 45, additional Rs 15/kg.

| Input | Expected charge |
| --- | ---: |
| 1 kg, 1 piece | 45.00 |
| 3 kg, 1 piece | 45.00 |
| 4 kg, 1 piece | 60.00 |
| 3.333 kg, 1 piece | 50.00 (49.995 rounded half up) |
| 4.5 kg, 2 pieces | 135.00 |
| 0 kg, 1 piece | 45.00 |
| Manual 25.50, 2 pieces | 25.50 (whole row override) |
| Base charge 0 below base weight | 0.00 |
| Base 45, extra rate 0, 9 kg, 2 pieces | 90.00 |

## Golden invoice and component boundaries

Lines 45 + 135 give gross 180.00. Fuel 20% is 36.00; subtotal is 216.00.
CGST 9% is 19.44, SGST 9% is 19.44, final 254.88. Words:
`TWO HUNDRED FIFTY FOUR AND EIGHTY EIGHT PAISE`.

Gross 100.01 with fuel 2.5% gives fuel 2.50 and subtotal 102.51. Separately
rounded CGST/SGST 9% are 9.23 each, final 120.97. Gross 0.01 with two configured
50% tax components gives 0.01 + 0.01 + 0.01 = 0.03; this synthetic boundary test
checks arithmetic, not legal rates. IGST 18% on 120.00 yields 21.60 and final
141.60. Explicit NONE on the same subtotal yields 120.00.

Words handle zero/paise, lakh/crore, values exceeding 99 crore, and rupee carry:
1.999 rounds to 2.00 and says TWO, not ONE plus 100 paise. Historical unversioned
word rendering is retained for already-issued records.

## Invalid and boundary coverage

Tests cover negative/missing/blank/nonnumeric weights, NaN/Infinity, zero/negative/
fractional quantities, missing/unknown rates, malformed/sub-paise manual overrides,
excess precision, mutually exclusive tax modes, duplicate tracking numbers,
1,001 rows, and amount overflow. Explicit zeros are distinguished from omissions.
The maximum supported total (Rs 1 trillion) is checked against integer paise.

## API and persistence cases

Tests verify published-card calculations, tampered subtotal/tax/total/line amount
and rate snapshots, missing/unreviewed cards, malformed input, missing explicit
tax/claims/weight, protected calculation calls, correct reconciliation, IGST/NONE,
manual overrides, committed replay after a card changes, edited-key conflicts,
immutable history, corrections using current approved cards and legacy read/replay
compatibility. All earlier revision, cancellation, database failure, CSRF, session,
safe-error, upload and concurrency tests remain active.

## Browser scenarios

On desktop and mobile Chromium:

- A: 45.00 + 90.00 across two destinations -> 191.16 with fuel and split taxes.
- B: 3.333 kg -> line 50.00, invoice 70.80.
- C: local base edit 45 -> 50 changes preview; unpublished mismatch blocks finalization;
  explicit publication permits verified 70.80.
- D: rate changes after issuance leave the full old invoice unchanged; reprint uses
  its old stored 63.72, with an assertion waiting for the second print event.
- E: intercepted tampered totals return reconciliation and cannot print.
- F: 100 synthetic rows -> 6,372.00; all records and printed total are checked.
- G: backend outage preserves the draft and blocks finalization.
- H: manual 25.50 for two pieces -> final 36.10, with explicit override metadata.
- I: authenticated IGST selection stores 972 paise IGST and zero CGST, with CSRF active.

The original browser suite additionally covers retries, expired sessions, logout
privacy, storage recovery, quota errors and save-before-print. The new financial
suite uses a separate disposable test API/database on 4189 so it does not consume
the original authentication-limit budget; production limits are not relaxed.

## Measured performance

`npm run test:performance` measures the pure engine after ten warm-up runs, then
50 samples for each size. Every sample asserts independently expected totals.
On Windows / Node v24.22.1 in this session:

| Rows | Mean ms | P95 ms | Maximum ms |
| ---: | ---: | ---: | ---: |
| 100 | 0.188 | 0.349 | 0.422 |
| 500 | 0.691 | 1.318 | 1.613 |
| 1,000 | 1.419 | 2.231 | 2.532 |

See [raw benchmark output](phase3-performance.txt). These are local warm-run
measurements, not database/network/DOM latency guarantees. Server card lookup is
indexed in memory by destination after one database query. The 1,000-row unit
case checks exact totals and repeatability as well as workload size.

Final test counts, commands and coverage are in [the Phase 3 report](phase3-report.md),
[per-test output](phase3-test-results.txt) and [coverage output](phase3-coverage.txt).
