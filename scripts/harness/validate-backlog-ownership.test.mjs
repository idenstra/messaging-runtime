import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { findBacklogOwnershipFindings } from './validate-backlog-ownership.mjs';

function createTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-runtime-backlog-ownership-'));
}

test('findBacklogOwnershipFindings flags unchecked checklist items in general docs', () => {
  const repoRoot = createTempRepo();
  const harnessPath = path.join(repoRoot, 'docs', 'HARNESS.md');
  fs.mkdirSync(path.dirname(harnessPath), { recursive: true });
  fs.writeFileSync(harnessPath, '# Harness\n- [ ] Move the backlog.\n');

  const findings = findBacklogOwnershipFindings(repoRoot, ['docs/HARNESS.md']);

  assert.deepEqual(findings, [
    {
      path: 'docs/HARNESS.md',
      line: 2,
      text: '- [ ] Move the backlog.',
    },
  ]);
});

test('findBacklogOwnershipFindings ignores execution plans and templates', () => {
  const repoRoot = createTempRepo();
  const allowedPaths = [
    'docs/exec-plans/active/123-demo.md',
    'docs/templates/execution-plan.md',
  ];

  for (const relativePath of allowedPaths) {
    const filePath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '- [ ] Allowed checklist item.\n');
  }

  const findings = findBacklogOwnershipFindings(repoRoot, allowedPaths);

  assert.deepEqual(findings, []);
});

