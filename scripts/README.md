# Scripts

This repo keeps the harness script surface intentionally small.

Key scripts:
- `scripts/ci/validate-no-personal-paths.mjs`
- `scripts/ci/validate-workflow-security.mjs`
- `scripts/ci/validate-pr-governance.mjs`
- `scripts/harness/audit.mjs`
- `scripts/harness/check-style-drift.mjs`
- `scripts/harness/check-execution-plan-lifecycle.mjs`
- `scripts/harness/validate-backlog-ownership.mjs`
- `scripts/harness/verify.sh`
- `scripts/release/validate-release-state.mjs`
- `scripts/release/print-release-notes.mjs`

Package-level code-shape tooling:
- `npm run format`
- `npm run lint`
- `npm run lint:fix`
