import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLifecycleJsonReport,
  filterResolvedWriteFindings,
  findExecutionPlanLifecycleFindings,
} from './check-execution-plan-lifecycle.mjs';
import { moveExecutionPlanToCompleted } from './lib/execution-plan-utils.mjs';

function createTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-runtime-plan-lifecycle-'));
}

function writeFile(repoRoot, relativePath, contents = '# plan\n') {
  const targetPath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, contents);
}

test('findExecutionPlanLifecycleFindings flags closed-issue active plans and suggests completed paths', () => {
  const findings = findExecutionPlanLifecycleFindings({
    activePlanPaths: ['docs/exec-plans/active/12-demo-plan.md', 'docs/exec-plans/active/README.md'],
    completedPlanPaths: ['docs/exec-plans/completed/README.md'],
    issueStatesByNumber: new Map([[12, 'closed']]),
  });

  assert.deepEqual(findings, [
    {
      code: 'closed-issue-active-plan',
      path: 'docs/exec-plans/active/12-demo-plan.md',
      issueNumber: 12,
      nextPath: 'docs/exec-plans/completed/12-demo-plan.md',
    },
  ]);
});

test('moveExecutionPlanToCompleted renames the plan into completed', () => {
  const repoRoot = createTempRepo();
  writeFile(repoRoot, 'docs/exec-plans/active/42-archive-me.md');

  const completedPlanPath = moveExecutionPlanToCompleted(repoRoot, 'docs/exec-plans/active/42-archive-me.md');

  assert.equal(completedPlanPath, 'docs/exec-plans/completed/42-archive-me.md');
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs/exec-plans/active/42-archive-me.md')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, completedPlanPath)), true);
});

test('buildLifecycleJsonReport includes moved plans for --json --write consumers', () => {
  const report = buildLifecycleJsonReport({
    repoFullName: 'idenstra/messaging-runtime',
    writeMode: true,
    findings: [],
    movedPlans: [
      {
        path: 'docs/exec-plans/active/42-archive-me.md',
        nextPath: 'docs/exec-plans/completed/42-archive-me.md',
        issueNumber: 42,
      },
    ],
  });

  assert.deepEqual(report, {
    repo: 'idenstra/messaging-runtime',
    write_mode: true,
    findings: [],
    movedPlans: [
      {
        path: 'docs/exec-plans/active/42-archive-me.md',
        nextPath: 'docs/exec-plans/completed/42-archive-me.md',
        issueNumber: 42,
      },
    ],
  });
});

test('filterResolvedWriteFindings removes closed-issue-active-plan findings that were moved', () => {
  const findings = [
    {
      code: 'closed-issue-active-plan',
      path: 'docs/exec-plans/active/42-archive-me.md',
      issueNumber: 42,
      nextPath: 'docs/exec-plans/completed/42-archive-me.md',
    },
    {
      code: 'missing-issue',
      path: 'docs/exec-plans/active/99-missing.md',
      issueNumber: 99,
    },
  ];

  const remainingFindings = filterResolvedWriteFindings(findings, [
    {
      path: 'docs/exec-plans/active/42-archive-me.md',
      nextPath: 'docs/exec-plans/completed/42-archive-me.md',
      issueNumber: 42,
    },
  ]);

  assert.deepEqual(remainingFindings, [
    {
      code: 'missing-issue',
      path: 'docs/exec-plans/active/99-missing.md',
      issueNumber: 99,
    },
  ]);
});
