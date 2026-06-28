import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
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
  writeFile(repoRoot, 'WORKFLOW.md', 'verify-fast\nmake verify\ndocs/ISSUE_TRACKING.md\n');
  writeFile(repoRoot, 'docs/templates/execution-plan.md', '# template\n');
  writeFile(repoRoot, 'docs/templates/handoff.md', '# handoff\n');
  writeFile(repoRoot, 'docs/EXECUTION_PLANS.md', 'docs/templates/execution-plan.md\ndocs/templates/handoff.md\nmake plan-sync\n');
  writeFile(repoRoot, 'docs/ISSUE_TRACKING.md', 'issue -> plan -> PR\nIdenstra Backlog\n');
  writeFile(repoRoot, 'docs/ARCHITECTURE.md', 'SNS/SQS\nNot owned here\n');
  writeFile(repoRoot, 'docs/SECURITY.md', '# security\n');
  writeFile(repoRoot, 'docs/RELIABILITY.md', '# reliability\n');
  writeFile(repoRoot, 'docs/HARNESS.md', 'scripts/README.md\ndocs/ISSUE_TRACKING.md\ndocs/EXECUTION_PLANS.md\ndocs/ARCHITECTURE.md\n');
  writeFile(repoRoot, 'README.md', 'WORKFLOW.md\ndocs/HARNESS.md\n');
  writeFile(repoRoot, 'scripts/README.md', 'verify.sh\n');
  writeFile(repoRoot, 'Makefile', '.PHONY: audit verify-fast verify plan-sync\naudit:\nverify-fast:\nverify:\nplan-sync:\n');
  writeFile(
    repoRoot,
    'scripts/harness/verify.sh',
    [
      'node --test scripts/ci/*.test.mjs scripts/harness/*.test.mjs',
      'node scripts/ci/validate-no-personal-paths.mjs',
      'node scripts/ci/validate-workflow-security.mjs',
      'node scripts/ci/validate-pr-governance.mjs',
      'node scripts/harness/validate-backlog-ownership.mjs',
      'npm ci',
      'npm test',
      'npm run build',
      'node scripts/harness/audit.mjs',
      '',
    ].join('\n'),
  );
  writeFile(repoRoot, 'scripts/harness/check-execution-plan-lifecycle.mjs', '// ok\n');
  writeFile(repoRoot, '.github/workflows/ci.yml', 'harness-validate:\nmake audit\npackage-checks:\nmake verify-fast\n');
  writeFile(repoRoot, '.github/PULL_REQUEST_TEMPLATE.md', 'Execution plan: N/A\nPlan-free exemption: none\nIssue-free exemption: none\n');
  for (const fileName of ['epic.yml', 'feature.yml', 'task.yml', 'bug.yml', 'improvement.yml', 'debt.yml', 'config.yml']) {
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

