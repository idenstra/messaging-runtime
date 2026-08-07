import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findPackageFacingReferenceHygieneFindings } from './check-package-facing-reference-hygiene.mjs';

function createTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-runtime-reference-hygiene-'));
}

function writeFile(repoRoot, relativePath, contents) {
  const filePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

test('findPackageFacingReferenceHygieneFindings flags owner/repo issue references in tracked docs', () => {
  const repoRoot = createTempRepo();
  writeFile(repoRoot, 'README.md', 'See example/runtime#9020 before publishing.\n');

  const findings = findPackageFacingReferenceHygieneFindings(repoRoot, ['README.md']);

  assert.deepEqual(
    findings.map((finding) => ({ code: finding.code, matchedText: finding.matchedText })),
    [{ code: 'cross-repo-slug-reference', matchedText: 'example/runtime#9020' }],
  );
});

test('findPackageFacingReferenceHygieneFindings flags GitHub repository and issue URLs in tracked docs', () => {
  const repoRoot = createTempRepo();
  writeFile(repoRoot, 'docs/ARCHITECTURE.md', 'Reference: https://github.com/example/runtime/issues/9001\n');

  const findings = findPackageFacingReferenceHygieneFindings(repoRoot, ['docs/ARCHITECTURE.md']);

  assert.deepEqual(
    findings.map((finding) => ({ code: finding.code, matchedText: finding.matchedText })),
    [{ code: 'github-reference', matchedText: 'https://github.com/example/runtime/issues/9001' }],
  );
});

test('findPackageFacingReferenceHygieneFindings allows neutral package-facing docs and source', () => {
  const repoRoot = createTempRepo();
  writeFile(repoRoot, 'README.md', 'Use @idenstra/messaging-runtime to handle queue messages.\n');
  writeFile(repoRoot, 'src/example.ts', 'export const example = { eventType: "dispatch" };\n');

  const findings = findPackageFacingReferenceHygieneFindings(repoRoot, ['README.md', 'src/example.ts']);

  assert.deepEqual(findings, []);
});
