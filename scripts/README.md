# Scripts

This repo keeps the harness script surface intentionally small.

Key scripts:
- `scripts/ci/validate-no-personal-paths.mjs`
- `scripts/ci/validate-workflow-security.mjs`
- `scripts/ci/validate-pr-governance.mjs`
- `scripts/harness/audit.mjs`
- `scripts/harness/check-package-facing-reference-hygiene.mjs`
- `scripts/harness/check-style-drift.mjs`
- `scripts/harness/check-public-import-surface.mjs`
- `scripts/harness/check-execution-plan-lifecycle.mjs`
- `scripts/harness/close-execution-plan.mjs`
- `scripts/harness/validate-backlog-ownership.mjs`
- `scripts/harness/verify.sh`
- `scripts/e2e/localstack/run.mjs`
- `scripts/e2e/localstack/compose.yaml`
- `scripts/public-surface/run-interface-reports.mjs`
- `scripts/public-surface/check-export-snapshot.mjs`
- `scripts/benchmarks/run.ts`
- `scripts/release/validate-release-state.mjs`
- `scripts/release/print-release-notes.mjs`

Package-level code-shape tooling:
- `npm run format`
- `npm run lint`
- `npm run lint:fix`
- `npm run benchmark`
- `npm run benchmark:ci`
- `npm run benchmark:baseline`
- `npm run benchmark:compare -- --base <base.json> --candidate <candidate.json>`
- `npm run e2e:localstack`
- `npm run e2e:localstack:ci`
- `npm run public-surface:report`
- `npm run public-surface:snapshot`
- `npm run public-surface:check`

Execution-plan helpers:
- `make plan-sync`
- `make plan-close ISSUE=<number>`

Optional end-to-end proof:
- `make verify-localstack`
- `npm run e2e:localstack -- --suite runtime,publishers`
- dynamic LocalStack fixture provisioning lives in `test/e2e/localstack/`, not in package code
