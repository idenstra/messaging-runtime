import assert from 'node:assert/strict';
import test from 'node:test';
import { isTrustedDependabotManifestUpdate } from './dependabot-governance.mjs';

const baseInput = {
  authorLogin: 'dependabot[bot]',
  headRefName: 'dependabot/npm_and_yarn/minor-and-patch-12345678',
  headRepositoryFullName: 'idenstra/repo',
  repoFullName: 'idenstra/repo',
  changedFiles: ['package.json', 'package-lock.json'],
};

test('accepts same-repository Dependabot manifest-only updates', () => {
  assert.equal(isTrustedDependabotManifestUpdate(baseInput), true);
  assert.equal(
    isTrustedDependabotManifestUpdate({
      ...baseInput,
      headRefName: 'dependabot/github_actions/minor-and-patch-12345678',
      changedFiles: ['.github/workflows/ci.yml'],
    }),
    true,
  );
  assert.equal(
    isTrustedDependabotManifestUpdate({
      ...baseInput,
      headRefName: 'dependabot/gradle/minor-and-patch-12345678',
      changedFiles: ['android/build.gradle', 'android/gradle/wrapper/gradle-wrapper.properties'],
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
});
