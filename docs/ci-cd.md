# CI and release gates

Phase 7 adds Poppler-based inspection of eight synthetic invoice PDFs and enforces
coverage floors of 90% lines, 80% branches and 85% functions over the existing loaded
backend/shared-module scope. A negative fixture proves low coverage fails even if
its assertions pass. Root installation sets MONGOMS_DISABLE_POSTINSTALL=1 only for
`npm ci`, avoiding an unpinned automatic MongoDB download; test harnesses continue
to request their pinned MongoDB 7.0.24 and strip inherited overrides.
Hosted execution for the uncommitted acceptance diff remains NOT VERIFIED.
See [final acceptance](final-production-acceptance.md) and
[operator push/PR instructions](release-readiness-checklist.md).

The [GitHub workflow](../.github/workflows/ci.yml) runs on PRs to main, pushes to main/fix/production-hardening, and manual dispatch. It contains **no deployment job**. Its file uses JSON syntax, which is a valid YAML subset, so the repository can parse it without adding a YAML dependency.

Checks: locked root/server install, JavaScript syntax, workflow safety policy, source secret/private-artifact scan, all unit/integration/browser regressions, Node coverage, both dependency audits at moderate severity, and the disposable operations/recovery drill. The workflow uses Ubuntu 24.04 and Node 24, installs Chromium and OS dependencies, and has a 30-minute timeout. No linter exists; syntax checking is not mislabeled linting.

Only `contents: read` permission is granted. Checkout credentials are not persisted. No production secrets/environment is supplied; harnesses strip inherited credentials and create synthetic, owned loopback databases. No pull_request_target trigger or failure-ignoring step exists. Failed required checks stop the job. Concurrency cancels superseded runs on the same ref.

Pinned action refs were verified against their official public Git tags: checkout v6.0.0, setup-node v6.0.0 and upload-artifact v5.0.0. Review and update immutable SHAs deliberately. See [official checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node) and [Playwright CI guidance](https://playwright.dev/docs/ci).

The source safety scan enumerates Git-tracked and nonignored source files. It rejects environment/key/archive filenames without reading their contents and checks common provider tokens, credential-bearing database URIs and configured secret assignments. It reports file/rule only, never matching values. A single exact synthetic negative-test URI exception is documented in code. Ignored real environment files are not read. This lightweight scan is not a guarantee against every secret format or a full Git-history/PII audit; enable the repository provider's secret scanning and review diffs before publishing, with operator authorization where required.

Only synthetic coverage/drill reports are uploaded with seven-day retention. No database archives, encryption keys, browser storage, traces, customer documents or broad workspace artifact glob is uploaded. CI artifact retention applies only to generated synthetic reports and is separate from unapproved business backup retention.

## Local validation and external status

```sh
npm ci
npm ci --prefix server
npx playwright install chromium
npm run check
npm run check:secrets
npm test
npm run test:coverage
npm audit --audit-level=moderate
npm audit --prefix server --audit-level=moderate
npm run test:operations
```

These local commands were executed; exact final results are in [Phase 6 report](phase6-report.md). Unit tests deliberately reject workflow mutations that remove tests, enable write permissions, use mutable actions or ignore failure; existing QA tests assert a genuine failing assertion exits nonzero.

**GitHub-hosted workflow execution is BLOCKED/unverified:** nothing was committed or pushed and no remote workflow was triggered. Local syntax/policy checks are not a claim that the GitHub runner executed successfully. A maintainer must approve publishing the branch/PR, then verify the complete hosted job and enable required branch checks. Ubuntu package downloads, action availability, repository permissions and actual runner timing must be verified there.
