import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findWorkflowSecurityViolations,
  parseWorkflowEvents,
  validateWorkflowSecurity,
} from './validate-workflow-security.mjs';

function createTempWorkflowDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-runtime-workflows-'));
}

test('validateWorkflowSecurity accepts a simple read-only CI workflow', () => {
  const workflowsDir = createTempWorkflowDir();
  const workflowPath = path.join(workflowsDir, 'ci.yml');
  fs.writeFileSync(
    workflowPath,
    [
      'name: CI',
      'on:',
      '  pull_request:',
      'permissions:',
      '  contents: read',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v7',
      '      - uses: actions/setup-node@v6',
      '      - run: npm ci',
      '',
    ].join('\n'),
  );

  const result = validateWorkflowSecurity(workflowsDir);

  assert.equal(result.violations.length, 0);
});

test('validateWorkflowSecurity accepts write-permission npm installs when --ignore-scripts is used', () => {
  const workflowsDir = createTempWorkflowDir();
  const workflowPath = path.join(workflowsDir, 'release.yml');
  fs.writeFileSync(
    workflowPath,
    [
      'name: Release',
      'on:',
      '  workflow_dispatch:',
      'permissions:',
      '  contents: write',
      '  packages: write',
      'jobs:',
      '  release:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v7',
      '      - run: npm ci --ignore-scripts',
      '',
    ].join('\n'),
  );

  const result = validateWorkflowSecurity(workflowsDir);

  assert.equal(result.violations.length, 0);
});

test('findWorkflowSecurityViolations flags pull_request_target checkout of head ref', () => {
  const source = [
    'name: Unsafe',
    'on:',
    '  pull_request_target:',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v7',
    '        with:',
    '          ref: ${{ github.event.pull_request.head.ref }}',
    '',
  ].join('\n');

  const violations = findWorkflowSecurityViolations('unsafe.yml', source);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].event, 'pull_request_target');
});

test('parseWorkflowEvents accepts scalar, array, and block trigger syntax', () => {
  assert.deepEqual([...parseWorkflowEvents('on: pull_request_target\n')], ['pull_request_target']);
  assert.deepEqual([...parseWorkflowEvents('on: [push, workflow_run]\n')], ['push', 'workflow_run']);
  assert.deepEqual(
    [...parseWorkflowEvents(['on:', '  workflow_run:', '  pull_request:', ''].join('\n'))],
    ['workflow_run', 'pull_request'],
  );
});
