import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { findPersonalPathFindings } from './validate-no-personal-paths.mjs';

function createTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-runtime-personal-paths-'));
}

test('findPersonalPathFindings flags user-specific home paths in tracked docs', () => {
  const repoRoot = createTempRepo();
  const readmePath = path.join(repoRoot, 'README.md');
  const personalPath = ['/home', 'wagner', 'repos', 'idenstra', 'messaging-runtime'].join('/');
  fs.writeFileSync(readmePath, `See ${personalPath} for local notes.\n`);

  const findings = findPersonalPathFindings(repoRoot, ['README.md']);

  assert.deepEqual(findings, [
    {
      path: 'README.md',
      line: 1,
      value: personalPath,
    },
  ]);
});

test('findPersonalPathFindings ignores non-targeted tracked files', () => {
  const repoRoot = createTempRepo();
  const sourcePath = path.join(repoRoot, 'dist', 'index.js');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  const personalPath = ['/home', 'wagner', 'repos', 'idenstra', 'messaging-runtime'].join('/');
  fs.writeFileSync(sourcePath, `console.log('${personalPath}');\n`);

  const findings = findPersonalPathFindings(repoRoot, ['dist/index.js']);

  assert.deepEqual(findings, []);
});

