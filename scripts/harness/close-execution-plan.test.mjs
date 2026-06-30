import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeExecutionPlanForIssue, findCloseableExecutionPlan } from './close-execution-plan.mjs';

function createTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-runtime-plan-close-'));
}

function writeFile(repoRoot, relativePath, contents = '# plan\n') {
  const targetPath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, contents);
}

test('findCloseableExecutionPlan returns the numbered active plan for the requested issue', () => {
  const planPath = findCloseableExecutionPlan(
    ['docs/exec-plans/active/21-demo-plan.md', 'docs/exec-plans/active/README.md'],
    21,
  );

  assert.equal(planPath, 'docs/exec-plans/active/21-demo-plan.md');
});

test('findCloseableExecutionPlan rejects missing issue plans', () => {
  assert.throws(
    () => findCloseableExecutionPlan(['docs/exec-plans/active/README.md'], 21),
    /no active execution plan found for issue #21/,
  );
});

test('closeExecutionPlanForIssue moves the active plan without checking GitHub issue state', () => {
  const repoRoot = createTempRepo();
  writeFile(repoRoot, 'docs/exec-plans/active/21-demo-plan.md');

  const movedPlan = closeExecutionPlanForIssue(repoRoot, 21);

  assert.deepEqual(movedPlan, {
    issueNumber: 21,
    path: 'docs/exec-plans/active/21-demo-plan.md',
    nextPath: 'docs/exec-plans/completed/21-demo-plan.md',
  });
  assert.equal(fs.existsSync(path.join(repoRoot, movedPlan.path)), false);
  assert.equal(fs.existsSync(path.join(repoRoot, movedPlan.nextPath)), true);
});
