import assert from 'node:assert/strict';
import test from 'node:test';
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
  const body = ['Closes #9001', 'Fixes idenstra/messaging-runtime#9002', 'Resolves example/runtime#9020', ''].join(
    '\n',
  );

  const issueRefs = extractIssueRefs(body, repoFullName);
  assert.deepEqual(issueRefs, [9001, 9002]);
});

test('extractExecutionPlan and exemption fields read the PR template lines', () => {
  const body = [
    'Execution plan: docs/exec-plans/active/9001-demo-plan.md',
    'Plan-free exemption: bugfix',
    'Issue-free exemption: docs-only',
    '',
  ].join('\n');

  assert.equal(extractExecutionPlan(body), 'docs/exec-plans/active/9001-demo-plan.md');
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

test('evaluatePullRequestGovernance rejects closing PRs that still point at an active execution plan', () => {
  const evaluation = evaluatePullRequestGovernance({
    body: [
      'Closes #9001',
      'Execution plan: docs/exec-plans/active/9001-demo-plan.md',
      'Plan-free exemption: none',
      '',
    ].join('\n'),
    changedFiles: ['scripts/harness/verify.sh'],
    existingIssueNumbers: new Set([9001]),
    repoFullName,
    activeExecutionPlans: new Set(['docs/exec-plans/active/9001-demo-plan.md']),
    completedExecutionPlans: new Set(),
  });

  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.mode, 'issue-linked-closeout');
  assert.match(evaluation.message, /make plan-close ISSUE=9001/);
});

test('evaluatePullRequestGovernance passes for a closing PR with a completed execution plan', () => {
  const evaluation = evaluatePullRequestGovernance({
    body: [
      'Closes #9001',
      'Execution plan: docs/exec-plans/completed/9001-demo-plan.md',
      'Plan-free exemption: none',
      '',
    ].join('\n'),
    changedFiles: ['scripts/harness/verify.sh'],
    existingIssueNumbers: new Set([9001]),
    repoFullName,
    activeExecutionPlans: new Set(),
    completedExecutionPlans: new Set(['docs/exec-plans/completed/9001-demo-plan.md']),
  });

  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.mode, 'issue-linked-closeout');
});

test('evaluatePullRequestGovernance rejects closing PRs when the matching active plan still exists', () => {
  const evaluation = evaluatePullRequestGovernance({
    body: [
      'Closes #9001',
      'Execution plan: docs/exec-plans/completed/9001-demo-plan.md',
      'Plan-free exemption: none',
      '',
    ].join('\n'),
    changedFiles: ['scripts/harness/verify.sh'],
    existingIssueNumbers: new Set([9001]),
    repoFullName,
    activeExecutionPlans: new Set(['docs/exec-plans/active/9001-demo-plan.md']),
    completedExecutionPlans: new Set(['docs/exec-plans/completed/9001-demo-plan.md']),
  });

  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.mode, 'issue-linked-closeout');
  assert.match(evaluation.message, /lingering active plan/);
});

test('evaluatePullRequestGovernance rejects completed plans that do not match the closing issue', () => {
  const evaluation = evaluatePullRequestGovernance({
    body: [
      'Closes #9001',
      'Execution plan: docs/exec-plans/completed/9002-demo-plan.md',
      'Plan-free exemption: none',
      '',
    ].join('\n'),
    changedFiles: ['scripts/harness/verify.sh'],
    existingIssueNumbers: new Set([9001, 9002]),
    repoFullName,
    activeExecutionPlans: new Set(),
    completedExecutionPlans: new Set(['docs/exec-plans/completed/9002-demo-plan.md']),
  });

  assert.equal(evaluation.ok, false);
  assert.match(evaluation.message, /must match one of the closing issue refs/);
});

test('evaluatePullRequestGovernance accepts an explicit trivial issue-free exemption', () => {
  const evaluation = evaluatePullRequestGovernance({
    body: ['Execution plan: N/A', 'Issue-free exemption: docs-only', ''].join('\n'),
    changedFiles: ['docs/HARNESS.md'],
    existingIssueNumbers: new Set(),
    repoFullName,
    activeExecutionPlans: new Set(),
    completedExecutionPlans: new Set(),
  });

  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.mode, 'trivial');
});

test('accepts verified Dependabot manifest updates without issue metadata', () => {
  const evaluation = evaluatePullRequestGovernance({
    body: '',
    changedFiles: ['package.json', 'package-lock.json'],
    existingIssueNumbers: new Set(),
    repoFullName,
    activeExecutionPlans: new Set(),
    completedExecutionPlans: new Set(),
    trustedDependencyAutomation: true,
  });

  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.mode, 'trusted-dependency-automation');
});
