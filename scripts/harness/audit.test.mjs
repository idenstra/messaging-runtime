import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildReport } from './audit.mjs';

function createTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-runtime-audit-'));
}

function writeFile(repoRoot, relativePath, contents) {
  const targetPath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, contents);
}

function seedMinimalHarnessRepo(repoRoot) {
  writeFile(
    repoRoot,
    'AGENTS.md',
    [
      'Canonical docs',
      'WORKFLOW.md',
      'docs/HARNESS.md',
      'docs/QUALITY_BAR.md',
      'docs/AI_ENGINEERING.md',
      'docs/EXECUTION_PLANS.md',
      'docs/ISSUE_TRACKING.md',
      '',
    ].join('\n'),
  );
  writeFile(
    repoRoot,
    'WORKFLOW.md',
    'verify-fast\nmake verify\ndocs/ISSUE_TRACKING.md\nstyle-drift validation\nBiome lint\n',
  );
  writeFile(repoRoot, 'docs/templates/execution-plan.md', '# template\n');
  writeFile(repoRoot, 'docs/templates/handoff.md', '# handoff\n');
  writeFile(
    repoRoot,
    'docs/EXECUTION_PLANS.md',
    'docs/templates/execution-plan.md\ndocs/templates/handoff.md\nmake plan-sync\nmake plan-close ISSUE=123\n',
  );
  writeFile(
    repoRoot,
    'docs/ISSUE_TRACKING.md',
    'issue -> plan -> PR\nCross-repo work should keep the authoritative backlog in the owning repo.\n',
  );
  writeFile(repoRoot, 'docs/ARCHITECTURE.md', 'SNS/SQS\nNot owned here\nPublic package contract\n');
  writeFile(repoRoot, 'docs/SECURITY.md', '# security\n.npmrc\n');
  writeFile(repoRoot, 'docs/RELIABILITY.md', '# reliability\n');
  writeFile(
    repoRoot,
    'docs/QUALITY_BAR.md',
    'one disciplined maintainer\ntool, or agent attribution\nsupported import surface\n',
  );
  writeFile(repoRoot, 'docs/AI_ENGINEERING.md', 'do not leave model, tool, or agent signatures\n');
  writeFile(
    repoRoot,
    'docs/HARNESS.md',
    'scripts/README.md\ndocs/ISSUE_TRACKING.md\ndocs/EXECUTION_PLANS.md\ndocs/ARCHITECTURE.md\npublic package surface\n',
  );
  writeFile(
    repoRoot,
    'README.md',
    'WORKFLOW.md\ndocs/HARNESS.md\ndocs/RELEASES.md\ndocs/COMPATIBILITY.md\nSupported imports are intentionally narrow\n',
  );
  writeFile(repoRoot, 'CHANGELOG.md', '# Changelog\n\n## [1.0.0] - 2026-08-06\n\n- Initial release.\n');
  writeFile(repoRoot, 'docs/RELEASES.md', 'package.json\nGitHub Packages\nrestricted tester lane\n');
  writeFile(
    repoRoot,
    'docs/COMPATIBILITY.md',
    'Semantic Versioning\nNode 24\nonly the latest major is maintained\n@idenstra/messaging-runtime/core\n@idenstra/messaging-runtime/observability\n',
  );
  writeFile(repoRoot, 'docs/MIGRATIONS.md', 'breaking release\n');
  writeFile(repoRoot, 'scripts/README.md', 'verify.sh\n');
  writeFile(repoRoot, 'biome.json', '{}\n');
  writeFile(
    repoRoot,
    'package.json',
    '{"scripts":{"format":"biome format --write .","lint":"biome check .","lint:fix":"biome check --write .","benchmark":"tsx scripts/benchmarks/run.ts","benchmark:ci":"tsx scripts/benchmarks/run.ts --json","benchmark:baseline":"tsx scripts/benchmarks/run.ts --write-baseline","benchmark:compare":"node scripts/benchmarks/compare.mjs","public-surface:report":"node scripts/public-surface/run-interface-reports.mjs --write","public-surface:snapshot":"node scripts/public-surface/check-export-snapshot.mjs --write","public-surface:check":"node scripts/public-surface/run-interface-reports.mjs && node scripts/public-surface/check-export-snapshot.mjs"}}\n',
  );
  writeFile(repoRoot, 'src/core/index.ts', 'export const marker = true;\n');
  writeFile(repoRoot, 'src/adapters/nest.ts', 'export const marker = true;\n');
  writeFile(repoRoot, 'test/core/message.test.ts', 'export {};\n');
  writeFile(repoRoot, 'test/adapters/nest.test.ts', 'export {};\n');
  writeFile(
    repoRoot,
    'Makefile',
    '.PHONY: format lint audit verify-fast verify plan-sync plan-close\nformat:\nlint:\naudit:\nverify-fast:\nverify:\nplan-sync:\nplan-close:\n',
  );
  writeFile(
    repoRoot,
    'scripts/harness/verify.sh',
    [
      'node --test scripts/ci/*.test.mjs scripts/harness/*.test.mjs scripts/release/*.test.mjs scripts/public-surface/*.test.mjs scripts/benchmarks/*.test.mjs',
      'node scripts/ci/validate-no-personal-paths.mjs',
      'node scripts/ci/validate-workflow-security.mjs',
      'node scripts/ci/validate-pr-governance.mjs',
      'node scripts/harness/validate-backlog-ownership.mjs',
      'node scripts/harness/check-execution-plan-lifecycle.mjs',
      'node scripts/harness/check-style-drift.mjs',
      'node scripts/harness/check-public-import-surface.mjs',
      'node scripts/harness/check-package-facing-reference-hygiene.mjs',
      'node scripts/release/validate-release-state.mjs',
      'npm ci --ignore-scripts',
      'npm run lint',
      'npm test',
      'npm run build',
      'npm run public-surface:check',
      'npm pack --dry-run',
      'node scripts/harness/audit.mjs',
      '',
    ].join('\n'),
  );
  writeFile(repoRoot, 'scripts/harness/check-execution-plan-lifecycle.mjs', '// ok\n');
  writeFile(repoRoot, 'scripts/harness/check-public-import-surface.mjs', '// ok\n');
  writeFile(repoRoot, 'scripts/harness/check-package-facing-reference-hygiene.mjs', '// ok\n');
  writeFile(repoRoot, 'scripts/benchmarks/run.ts', '// ok\n');
  writeFile(repoRoot, 'scripts/benchmarks/compare.mjs', '// ok\n');
  writeFile(repoRoot, 'scripts/public-surface/run-interface-reports.mjs', '// ok\n');
  writeFile(repoRoot, 'scripts/public-surface/check-export-snapshot.mjs', '// ok\n');
  writeFile(repoRoot, 'public-surface-report.root.json', '{}\n');
  writeFile(repoRoot, 'public-surface-report.core.json', '{}\n');
  writeFile(repoRoot, 'public-surface-report.nest.json', '{}\n');
  writeFile(repoRoot, 'public-surface-report.observability.json', '{}\n');
  writeFile(repoRoot, 'etc/messaging-runtime.public-surface.api.md', '# surface\n');
  writeFile(repoRoot, 'etc/messaging-runtime-core.public-surface.api.md', '# surface\n');
  writeFile(repoRoot, 'etc/messaging-runtime-nest.public-surface.api.md', '# surface\n');
  writeFile(repoRoot, 'etc/messaging-runtime-observability.public-surface.api.md', '# surface\n');
  writeFile(repoRoot, 'reports/public-surface/exports.json', '{}\n');
  writeFile(repoRoot, 'reports/public-surface/exports.md', '# exports\n');
  writeFile(
    repoRoot,
    '.github/workflows/ci.yml',
    'harness-validate:\nnode --test scripts/ci/*.test.mjs scripts/harness/*.test.mjs scripts/release/*.test.mjs scripts/public-surface/*.test.mjs scripts/benchmarks/*.test.mjs\nmake audit\npackage-checks:\nmake verify-fast\n',
  );
  writeFile(
    repoRoot,
    '.github/workflows/release.yml',
    'workflow_dispatch:\nnpm publish --dry-run\nvalidate-release-state.mjs\ngh release create\n',
  );
  writeFile(
    repoRoot,
    '.github/PULL_REQUEST_TEMPLATE.md',
    'Execution plan: N/A\nPlan-free exemption: none\nIssue-free exemption: none\n',
  );
  for (const fileName of [
    'epic.yml',
    'feature.yml',
    'task.yml',
    'bug.yml',
    'improvement.yml',
    'debt.yml',
    'config.yml',
  ]) {
    writeFile(repoRoot, `.github/ISSUE_TEMPLATE/${fileName}`, '# template\n');
  }
}

test('buildReport passes for a minimally valid messaging-runtime harness surface', () => {
  const repoRoot = createTempRepo();
  seedMinimalHarnessRepo(repoRoot);

  const report = buildReport(repoRoot);
  assert.equal(report.overall_status, 'pass');
});

test('buildReport fails when verify.sh is missing package checks', () => {
  const repoRoot = createTempRepo();
  seedMinimalHarnessRepo(repoRoot);
  writeFile(repoRoot, 'scripts/harness/verify.sh', 'node scripts/harness/audit.mjs\n');

  const report = buildReport(repoRoot);
  const verification = report.categories.find((category) => category.id === 'verification');
  const verifyCheck = verification?.checks.find((check) => check.id === 'verify-wrapper');

  assert.equal(report.overall_status, 'fail');
  assert.equal(verification?.status, 'fail');
  assert.equal(verifyCheck?.status, 'fail');
});

test('buildReport fails when the minimal core test file is missing', () => {
  const repoRoot = createTempRepo();
  seedMinimalHarnessRepo(repoRoot);
  fs.rmSync(path.join(repoRoot, 'test/core/message.test.ts'));

  const report = buildReport(repoRoot);
  const repoDocs = report.categories.find((category) => category.id === 'repo-docs');
  const runtimeSurfaceCheck = repoDocs?.checks.find((check) => check.id === 'runtime-and-adapter-surface');

  assert.equal(report.overall_status, 'fail');
  assert.equal(repoDocs?.status, 'fail');
  assert.equal(runtimeSurfaceCheck?.status, 'fail');
});
