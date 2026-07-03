import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findStyleDriftFindings } from './check-style-drift.mjs';

function createTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-runtime-style-drift-'));
}

function writeFile(repoRoot, relativePath, contents) {
  const filePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

test('findStyleDriftFindings flags tool signatures in tracked repo content', () => {
  const repoRoot = createTempRepo();
  writeFile(repoRoot, 'README.md', 'This was written by Copilot.\n');

  const findings = findStyleDriftFindings(repoRoot, ['README.md']);

  assert.deepEqual(findings, [
    {
      code: 'tool-signature',
      line: 1,
      message: 'remove model or tool attribution from tracked repo content',
      path: 'README.md',
      text: 'This was written by Copilot.',
    },
  ]);
});

test('findStyleDriftFindings allows AI references in repo-internal AI guidance docs', () => {
  const repoRoot = createTempRepo();
  writeFile(repoRoot, 'docs/AI_ENGINEERING.md', 'Copilot, Codex, and Claude are examples here.\n');

  const findings = findStyleDriftFindings(repoRoot, ['docs/AI_ENGINEERING.md']);

  assert.deepEqual(findings, []);
});

test('findStyleDriftFindings flags TODO-style markers without issue references', () => {
  const repoRoot = createTempRepo();
  writeFile(repoRoot, 'src/core/index.ts', '// TODO tighten retry semantics.\n');

  const findings = findStyleDriftFindings(repoRoot, ['src/core/index.ts']);

  assert.deepEqual(findings, [
    {
      code: 'untracked-marker',
      line: 1,
      message: 'link TODO/FIXME/HACK/XXX markers to a tracked issue or remove them',
      path: 'src/core/index.ts',
      text: '// TODO tighten retry semantics.',
    },
  ]);
});

test('findStyleDriftFindings allows TODO-style markers when they reference an issue', () => {
  const repoRoot = createTempRepo();
  writeFile(repoRoot, 'src/core/index.ts', '// TODO #42 tighten retry semantics.\n');

  const findings = findStyleDriftFindings(repoRoot, ['src/core/index.ts']);

  assert.deepEqual(findings, []);
});

test('findStyleDriftFindings ignores marker names when they appear only inside inline code spans', () => {
  const repoRoot = createTempRepo();
  writeFile(repoRoot, 'docs/QUALITY_BAR.md', '- `TODO`, `FIXME`, `HACK`, and `XXX` markers must reference issues.\n');

  const findings = findStyleDriftFindings(repoRoot, ['docs/QUALITY_BAR.md']);

  assert.deepEqual(findings, []);
});

test('findStyleDriftFindings allows rule literals inside the style-drift validator sources', () => {
  const repoRoot = createTempRepo();
  writeFile(repoRoot, 'scripts/harness/check-style-drift.mjs', 'const rule = /copilot|TODO/;\n');
  writeFile(
    repoRoot,
    'scripts/harness/check-style-drift.test.mjs',
    "writeFile(repoRoot, 'README.md', 'Copilot TODO');\n",
  );

  const findings = findStyleDriftFindings(repoRoot, [
    'scripts/harness/check-style-drift.mjs',
    'scripts/harness/check-style-drift.test.mjs',
  ]);

  assert.deepEqual(findings, []);
});
