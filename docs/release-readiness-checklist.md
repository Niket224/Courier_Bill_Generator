# Release readiness and approval checklist

Status vocabulary: **PASS LOCAL** means executed with synthetic owned local resources; **BLOCKED** means authorization/resources are missing; **NOT VERIFIED** means no qualifying evidence exists. A green local test never turns a hosted gate green. Current recommendation: **NO-GO for production**.

## Traceable acceptance requirements

| ID | Requirement | Evidence / owner | Status |
| --- | --- | --- | --- |
| A1 | Actual architecture, entry points and configuration reviewed | [Final audit](final-production-acceptance.md), [deployment](deployment.md), source at recorded HEAD + reviewed diff | Reviewed locally |
| B1–B16 | Complete 100-shipment monthly billing cycle | [Acceptance browser test](../tests/e2e/acceptance.spec.cjs), [independent fixture](../tests/fixtures/monthly-acceptance.cjs) | PASS LOCAL on desktop/mobile |
| C1–C25 | Security acceptance | Security matrix below; existing unit/API/browser tests plus new path/XSS/proxy checks | PASS LOCAL within stated scope; hosted enforcement NOT VERIFIED |
| D1 | Reproducible install, CI syntax/triggers/permissions, failures, privacy | `npm ci`, `npm ci --prefix server`, `npm run check`, `npm run check:secrets`, audits, negative coverage fixture | Local evidence in final report |
| D2 | GitHub-hosted checks on exact proposed commit | Maintainer must publish reviewed branch and retain Actions evidence | HOSTED CI NOT VERIFIED |
| E1 | Representative hosted staging | Named isolated host, TLS origin, staged DB, secret store and approved access | BLOCKED |
| F1 | Actual Gemini entitlement, key and extraction | Operator authorizes bounded synthetic live request; confirm server model | LIVE GEMINI VERIFICATION BLOCKED |
| G1 | Consistent encrypted backup and fresh verified restore | API recovery tests and `npm run test:operations`, actual local replica set | PASS LOCAL |
| G2 | Off-host durable backup, active schedule, alerts and key recovery | Operator/host administrator; restore from independently stored archive | BLOCKED / NOT VERIFIED |
| H1–H20 | Failure injection without false persistence or destructive recovery | Unit/API/browser suites, recovery/operations drills; final report evidence | PASS LOCAL; external outage/notification paths NOT VERIFIED |
| I1 | Single/three-page, long-field, historical/corrected/cancelled PDFs | Eight synthetic PDFs, Poppler text/bounds checks and raster review | PASS LOCAL |
| I2 | Actual paper/printer output | Human operator, checklist below | MANUAL PHYSICAL PRINT NOT VERIFIED |
| J1 | Measured API, calculations, browser/PDF, memory, backup and restore | Machine-readable local metrics linked in final report, with sample sizes | PASS LOCAL, not a production capacity certification |
| K1 | All prior 311 scenarios plus new acceptance checks | Full named regression and coverage output | Final results in report |
| L1 | Commercial/tax/numbering/correction/retention decisions | Business operator + accountant, checklist below | Approval missing |
| M1 | Coordinated rollout/rollback plan | [Deployment](deployment.md), [rollback](rollback.md), commands below | Prepared; execution BLOCKED |
| N1 | Final decision follows all remaining gates | [GO/NO-GO decision](production-go-no-go.md) | NO-GO |

## Security scope and evidence

| IDs | Controls reviewed | Local evidence / limitation |
| --- | --- | --- |
| C1–C5 | One admin, salted scrypt, fixation/expiry, Secure HttpOnly cookies, logout invalidation | Unit/password tests; API successful/incorrect/missing login, expiry, regeneration, cookie replay and restart cases |
| C6–C10 | Session-bound CSRF, exact origins, all business route guards, login/AI limits | Existing named API regressions and actual authenticated browser flow; no public signup |
| C11–C12 | Field/date/money validation and MongoDB operator injection | Strict validators, literal search escaping, malformed filter tests; `status[$ne]` rejected |
| C13–C14 | Customer/history/AI HTML injection | Escaped fields and images, stored-review XSS regressions; historical amount-words sink now escaped |
| C15–C16 | Safe errors and operational logs | Fixed-category/field allowlist tests; request IDs are server-generated; no bodies/query values/secrets logged |
| C17–C18 | Backup OS access, authorization guard and authenticated encryption | No backup HTTP endpoint; AES-GCM/key/corruption tests and real isolated restore; actual host ACLs NOT VERIFIED |
| C19–C20 | Encrypted browser drafts and secret handling | Web Crypto migration, wrong/missing keys, quota/corruption, logout memory/DOM and source scan; hostile OS/live session remains outside protection |
| C21–C22 | Security headers and dependency advisories | Helmet API tests and fresh audits; static-host headers and TLS need staged verification |
| C23 | Trusted-proxy session behavior | Local Express test simulates loopback TLS forwarding; Secure cookie/CSRF works, untrusted forwarding cannot mint a Secure cookie. This is not a real hosted TLS test |
| C24 | SW never caches private API responses | Existing API/external bypass and cache-rollout tests; new cache v13 affects only Courier caches |
| C25 | Sensitive file hosting | Static file allowlist, malformed/encoded traversal tests, actual local HTTP denials; strengthened proxy example. Actual deployed web root/ACLs NOT VERIFIED |

## Publish the reviewed branch and inspect hosted CI — operator actions only

No commands in this section were executed against the remote. Approval to publish and use GitHub Actions is required first. Do not force-push or merge as part of this checklist.

```powershell
git switch fix/production-hardening
git status --short
git diff --check
npm run check
npm run check:secrets
git diff --stat
git add -p
```

Review tracked hunks interactively. Stage only the reviewed new source/tests/docs listed in the final report; never stage real environment files, backup archives, keys, customer data or PDF scratch directories. Generated synthetic PDFs remain local/ignored and can be inspected before selecting release evidence. Then inspect staged changes:

```powershell
git diff --cached --stat
git diff --cached --check
git diff --cached
git commit -m "Complete local production acceptance"
git push --set-upstream origin fix/production-hardening
```

The operator must first confirm `origin` is the intended Niket224/Courier_Bill_Generator remote and uses secure credential-manager/SSH authentication. If the remote diverges, stop and review rather than forcing it. To open a PR using an already authenticated GitHub CLI:

```powershell
gh pr create --base main --head fix/production-hardening --title "Production hardening acceptance" --body "Local acceptance and recovery evidence are documented in docs/final-production-acceptance.md. Production remains NO-GO pending hosted CI/staging, durable scheduled backups, live integration and required business/printing approvals."
gh run list --workflow "Courier safety CI" --branch fix/production-hardening
$acceptanceRunId = Read-Host 'Enter the run ID for the exact pushed commit'
gh run watch $acceptanceRunId --exit-status
gh run view $acceptanceRunId --log-failed
gh pr checks
```

Alternatively use the repository's Pull Requests and Actions pages. Verify the workflow SHA matches the proposed commit, every required step passed (not skipped/cancelled), coverage floors passed, PDF inspection passed, and only synthetic reports were retained. Confirm the workflow contains no deployment job and no separate provider integration unexpectedly deployed the branch. Make the verified job a required check only through an explicitly approved repository-settings change.

## Representative staging execution — not authorized or executed here

1. Operator designates a disposable environment with a separate nonproduction database/account and explicitly authorizes access/costs. Use no real customer data or production secrets. Do not reuse or rotate the production browser key.
2. Configure same-origin HTTPS static/API routing, the actual trusted proxy, startup indexes/session TTL, strong independent staging secrets and BROWSER_DRAFT_KEY. Follow [deployment requirements](deployment.md). A bare serverless/static host is not assumed compatible.
3. From that approved staging checkout, install locked dependencies and start the long-lived process under the approved supervisor:

```powershell
npm ci
npm ci --prefix server
npm run check
npm run check:secrets
npm start --prefix server
```

Use a protected staged secret store; the commands above do not supply secrets or authorize loading production configuration. In a separate shell with the approved staging URL:

```powershell
$acceptanceOrigin = Read-Host 'Enter the explicitly approved HTTPS staging origin'
curl.exe --fail "$acceptanceOrigin/api/health/live"
curl.exe --fail "$acceptanceOrigin/api/health/ready"
```

Expected: 200 `alive` and 200 `ready`; a dependency outage must produce readiness 503 while liveness remains meaningful. Never use `-k` to bypass TLS acceptance.

4. Open the approved staging origin in desktop Chromium and a real mobile browser. Sign in, inspect Secure/HttpOnly/SameSite cookies, exercise logout and expiry, and confirm CSRF/origin rejection. No key or token should appear in static assets, browser persistent storage or logs.
5. Prepare a synthetic browser input locally, without network access:

```powershell
New-Item -ItemType Directory -Path outputs -Force | Out-Null
node -e "const fs=require('node:fs');const f=require('./tests/fixtures/monthly-acceptance.cjs');fs.writeFileSync('outputs/staging-synthetic-browser.json',JSON.stringify(f.monthly('STAGING-ACCEPTANCE','STG')));"
```

Import it through Tools with preview/confirmation. Review/save/publish the three synthetic rates explicitly. Execute B1–B16 using only this disposable namespace and verify every expected amount against the independent fixture. Test save/finalize/search/correction/paid/cancelled copies, restart, reconnect/idempotent retry and mobile/desktop access. Do not run the local Playwright harness against this host and call that representative staging: it deliberately starts its own local test servers.
6. For Gemini, obtain separate approval for the model/key and bounded request cost first. Upload a synthetic quotation with PATNA base 3 kg, **base charge 50**, extra 15/kg and explicit fuel 12.5%; verify base charge stays 50, not 45. Review/edit, leave one missing charge unresolved and verify publication blocks; then complete it, save a draft and explicitly publish. No live API request ran here.
7. After storage/key/scheduler approval, run `npm run ops:backup-job` with the protected staging-only environment. Verify authenticated encrypted copies off-host, age/capacity alerts, actual failure delivery and lock recovery. Run `npm run ops:monitor` and require exit 0 only after every signal is configured. Do not activate a production schedule.
8. Restore the synthetic archive into a fresh isolated target using [the disaster runbook](disaster-recovery-runbook.md). Verify counts, indexes, original totals/rates, relationships, quarantine failures and historical printing. Time the complete human drill, not just database insertion.
9. Exercise coordinated assets/SW v13 rollout and compatible rollback. Keep original databases/archives untouched. Obtain operator acceptance before any separate production cutover authorization.

## Business operator and accountant approval — all currently missing

| Decision | Exact behavior to confirm |
| --- | --- |
| Base and extra pricing | Stated base charge is independent of base kg × per-kg rate; exact CITY matching is authoritative today |
| Weight / pieces | Charge is `(base + max(0, weight-baseKg) × extra) × pieces`; confirm whether weight is per piece, and whether this matches actual quotations |
| Rounding | No weight ceiling is invented; line charges and each fuel/tax component round half-up to paise at the documented stages |
| Overrides | An explicit manual amount is the complete line total and does not multiply by pieces |
| Fuel | Applies to rounded line gross; invoice setting is explicit and reviewed rate-card fuel reference does not silently replace it |
| GST/tax | Accountant chooses applicable SPLIT/IGST/NONE, rates, eligibility and required invoice particulars; automated arithmetic proves no legal compliance |
| Invoice numbering | Operator approves uniqueness, year/period and correction-number policy; automatic increment is a convenience, not a legal numbering determination |
| Corrections / cancellations / payment | Originals remain immutable; correction gets a new linked number; status transitions retain audit evidence; cancelled copies are labelled |
| Retention | No automatic business deletion is enabled; decide legal/business retention, archive copies and the 40-version cap before reaching it |
| Recovery | Approve backup cadence, independent storage, key custody and RPO/RTO only after a representative restore |

Record approver/date/evidence securely through the business process. Do not mark these approved merely because the synthetic test passed.

## MANUAL PHYSICAL PRINT checklist — NOT VERIFIED

- Print the single-page long-address/signature sample and each three-page 100-row original/correction/cancelled sample on the actual A4 printer.
- Confirm readable text, all 100 AWBs, complete wrapped values, repeated table headings, intact totals/signature block, correct business details and no clipping at actual hardware margins.
- Confirm the cancellation/correction label is clear on the first page and pages are kept as one complete record. No test claims every continuation page has a cancellation watermark or repeated invoice header.
- Compare gross 8625.00, fuel 1078.13, subtotal 9703.13, each tax 873.28 and final 11449.69 against the independent worksheet.
- Check signature position, grayscale output, page order and scaling. Record printer/browser settings and human acceptance; adjust only after review.

## Coordinated production release gate

Before any approval: require exact revision/CI evidence, named staged acceptance, business/accountant sign-off, real secret/key custody, published operator-approved rates, verified fresh off-host backup, operational schedule/alert delivery, tested physical printing and compatible rollback. Deploy static/shared/backend files together; preserve API protocol v1, invoice schema 2/3, calculation contract courier-v1, rate history, browser vault v1 and backup format v1/schema 5. Do not roll back to plaintext-browser or unsafe rate-upsert clients. Existing [deployment](deployment.md) and [rollback](rollback.md) commands are procedures, not evidence they ran.
