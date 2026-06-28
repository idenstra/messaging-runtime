import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTrivialChange,
  evaluatePullRequestGovernance,
  extractExecutionPlan,
  extractIssueFreeExemption,
  extractIssueRefs,
  extractPlanFreeExemption,
} from './validate-pr-governance.mjs';

const repoFullName = 'idenstra/messaging-runtime';

test('extractIssueRefs keeps same-repo closing references and ignores other repos', () => {
  const body = [
    'Closes #1',
    'Fixes idenstra/messaging-runtime#2',
    'Resolves idenstra/platform#20',
    '',
  ].join('\n');

  const issueRefs = extractIssueRefs(body, repoFullName);
  assert.deepEqual(issueRefs, [1, 2]);
});

test('extractExecutionPlan and exemption fields read the PR template lines', () => {
  const body = [
    'Execution plan: docs/exec-plans/active/1-demo-plan.md',
    'Plan-free exemption: bugfix',
    'Issue-free exemption: docs-only',
    '',
  ].join('\n');

  assert.equal(extractExecutionPlan(body), 'docs/exec-plans/active/1-demo-plan.md');
  assert.equal(extractPlanFreeExemption(body), 'bugfix');
  assert.equal(extractIssueFreeExemption(body), 'docs-only');
});

test('classifyTrivialChange recognizes the allowed explicit exemptions', () => {
  assert.equal(classifyTrivialChange(['docs/HARNESS.md', '.github/PULL_REQUEST_TEMPLATE.md']), 'docs-only');
  assert.equal(classifyTrivialChange(['scripts/README.md']), 'docs-only');
  assert.equal(classifyTrivialChange(['scripts/harness/audit.test.mjs']), 'test-only');
  assert.equal(classifyTrivialChange(['.github/workflows/ci.yml', 'Makefile']), 'tiny-tooling');
  assert.equal(classifyTrivialChange(['scripts/harness/audit.mjs']), null);
});

test('evaluatePullRequestGovernance passes for an issue-linked PR with an active execution plan', () => {
  const evaluation = evaluatePullRequestGovernance({
    body: ['Closes #1', 'Execution plan: docs/exec-plans/active/1-demo-plan.md', 'Plan-free exemption: none', ''].join('\n'),
    changedFiles: ['scripts/harness/verify.sh'],
    existingIssueNumbers: new Set([1]),
    repoFullName,
    activeExecutionPlans: new Set(['docs/exec-plans/active/1-demo-plan.md']),
  });

  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.mode, 'issue-linked');
});

test('evaluatePullRequestGovernance accepts an explicit trivial issue-free exemption', () => {
  const evaluation = evaluatePullRequestGovernance({
    body: ['Execution plan: N/A', 'Issue-free exemption: docs-only', ''].join('\n'),
    changedFiles: ['docs/HARNESS.md'],
    existingIssueNumbers: new Set(),
    repoFullName,
    activeExecutionPlans: new Set(),
  });

  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.mode, 'trivial');
});

