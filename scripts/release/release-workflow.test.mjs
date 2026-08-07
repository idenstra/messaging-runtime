import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'release.yml');

function readReleaseWorkflow() {
  return fs.readFileSync(workflowPath, 'utf8');
}

function extractJobBlock(workflowSource, jobName) {
  const match = workflowSource.match(new RegExp(`\\n  ${jobName}:\\n([\\s\\S]*?)(?=\\n  [^\\s].*:\\n|$)`));
  assert.ok(match, `expected to find job block for ${jobName}`);
  return match[0];
}

test('release workflow exposes validate, publish-github, and publish-npm modes', () => {
  const workflowSource = readReleaseWorkflow();

  assert.match(workflowSource, /workflow_dispatch:\n\s+inputs:\n\s+mode:/);
  assert.match(workflowSource, /options:\n\s+- validate\n\s+- publish-github\n\s+- publish-npm/);
  assert.match(workflowSource, /release-ref:/);
});

test('release workflow runs AWS smoke only for the GitHub Packages tester publish path', () => {
  const workflowSource = readReleaseWorkflow();
  const awsSmokeBlock = extractJobBlock(workflowSource, 'aws-smoke');
  const publishGithubBlock = extractJobBlock(workflowSource, 'publish-github');
  const publishNpmBlock = extractJobBlock(workflowSource, 'publish-npm');

  assert.match(awsSmokeBlock, /inputs\.mode == 'publish-github'/);
  assert.match(awsSmokeBlock, /uses: \.\/\.github\/workflows\/aws-smoke\.yml/);
  assert.match(awsSmokeBlock, /git-ref: \$\{\{ needs\.preflight\.outputs\.target_sha \}\}/);
  assert.match(publishGithubBlock, /needs:\n\s+- preflight\n\s+- aws-smoke/);
  assert.doesNotMatch(publishNpmBlock, /aws-smoke/);
});

test('release workflow tags on GitHub Packages publish and creates the GitHub Release only on npm promotion', () => {
  const workflowSource = readReleaseWorkflow();
  const publishGithubBlock = extractJobBlock(workflowSource, 'publish-github');
  const publishNpmBlock = extractJobBlock(workflowSource, 'publish-npm');

  assert.match(publishGithubBlock, /npm publish --registry https:\/\/npm\.pkg\.github\.com --access restricted/);
  assert.match(publishGithubBlock, /git tag "\$\{\{ needs\.preflight\.outputs\.tag_name \}\}"/);
  assert.doesNotMatch(publishGithubBlock, /gh release create/);

  assert.match(publishNpmBlock, /ref: refs\/tags\/\$\{\{ needs\.preflight\.outputs\.tag_name \}\}/);
  assert.match(publishNpmBlock, /npm publish --provenance --access public/);
  assert.match(publishNpmBlock, /gh release create "\$\{\{ needs\.preflight\.outputs\.tag_name \}\}"/);
});
