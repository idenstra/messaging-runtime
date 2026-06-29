#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STRICT="${HARNESS_STRICT:-0}"

cd "${REPO_ROOT}"

echo "[messaging-runtime harness] === phase: verify-fast (package and deterministic checks) ==="

echo "[messaging-runtime harness] validator self-tests"
node --test scripts/ci/*.test.mjs scripts/harness/*.test.mjs scripts/release/*.test.mjs

echo "[messaging-runtime harness] validate personal paths"
HARNESS_STRICT="${STRICT}" node scripts/ci/validate-no-personal-paths.mjs

echo "[messaging-runtime harness] validate workflow security"
node scripts/ci/validate-workflow-security.mjs

echo "[messaging-runtime harness] validate PR governance"
node scripts/ci/validate-pr-governance.mjs

echo "[messaging-runtime harness] validate backlog ownership"
node scripts/harness/validate-backlog-ownership.mjs

echo "[messaging-runtime harness] check style drift"
node scripts/harness/check-style-drift.mjs

echo "[messaging-runtime harness] validate release state"
node scripts/release/validate-release-state.mjs

echo "[messaging-runtime harness] npm ci"
npm ci --ignore-scripts

echo "[messaging-runtime harness] npm run lint"
npm run lint

echo "[messaging-runtime harness] npm test"
npm test

echo "[messaging-runtime harness] npm run build"
npm run build

echo "[messaging-runtime harness] npm pack --dry-run"
npm pack --dry-run >/dev/null

echo "[messaging-runtime harness] audit"
node scripts/harness/audit.mjs

echo "[messaging-runtime harness] === phase complete: verify-fast ==="
echo "[messaging-runtime harness] done (HARNESS_STRICT=${STRICT})"
