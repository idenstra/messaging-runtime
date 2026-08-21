import assert from 'node:assert/strict';
import test from 'node:test';
import { isTrustedDependabotManifestUpdate } from './dependabot-governance.mjs';

const baseInput = {
  authorLogin: 'dependabot[bot]',
  headRefName: 'dependabot/npm_and_yarn/minor-and-patch-12345678',
  headRepositoryFullName: 'idenstra/repo',
  repoFullName: 'idenstra/repo',
  changedFiles: ['package.json', 'package-lock.json'],
  changedFileModes: new Map([
    ['package.json', '100644'],
    ['package-lock.json', '100644'],
  ]),
  allowedEcosystems: new Set(['npm_and_yarn', 'github_actions']),
};

test('accepts same-repository Dependabot manifest-only updates', () => {
  assert.equal(isTrustedDependabotManifestUpdate(baseInput), true);
  assert.equal(
    isTrustedDependabotManifestUpdate({
      ...baseInput,
      headRefName: 'dependabot/github_actions/minor-and-patch-12345678',
      changedFiles: ['.github/workflows/ci.yml'],
      changedFileModes: new Map([['.github/workflows/ci.yml', '100644']]),
    }),
    true,
  );
});

test('rejects impersonation, forks, unsupported ecosystems, and source changes', () => {
  assert.equal(isTrustedDependabotManifestUpdate({ ...baseInput, authorLogin: 'dependabot' }), false);
  assert.equal(isTrustedDependabotManifestUpdate({ ...baseInput, headRepositoryFullName: 'fork/repo' }), false);
  assert.equal(
    isTrustedDependabotManifestUpdate({ ...baseInput, headRefName: 'dependabot/unknown/dependency-1.2.3' }),
    false,
  );
  assert.equal(
    isTrustedDependabotManifestUpdate({ ...baseInput, changedFiles: ['package-lock.json', 'src/app.ts'] }),
    false,
  );
  assert.equal(isTrustedDependabotManifestUpdate({ ...baseInput, changedFiles: [] }), false);
  assert.equal(
    isTrustedDependabotManifestUpdate({
      ...baseInput,
      changedFileModes: new Map([['package.json', '120000']]),
      changedFiles: ['package.json'],
    }),
    false,
  );
});
