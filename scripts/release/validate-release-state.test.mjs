import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getChangelogSectionForVersion,
  getReleaseNotesMarkdown,
  normalizePromotionRef,
  parseChangelogSections,
  validateReleaseState,
} from './validate-release-state.mjs';

function createTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-runtime-release-state-'));
}

function writeFile(repoRoot, relativePath, contents) {
  const filePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function seedReleaseRepo(repoRoot, overrides = {}) {
  const packageMetadata = {
    name: '@idenstra/messaging-runtime',
    version: '0.1.0',
    private: false,
    files: ['dist'],
    exports: {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './core': { types: './dist/core/index.d.ts', default: './dist/core/index.js' },
      './nest': { types: './dist/adapters/nest.d.ts', default: './dist/adapters/nest.js' },
      './observability': { types: './dist/observability/index.d.ts', default: './dist/observability/index.js' },
    },
    engines: { node: '>=24' },
    publishConfig: { registry: 'https://registry.npmjs.org', access: 'public' },
    ...overrides.packageMetadata,
  };

  writeFile(repoRoot, 'package.json', JSON.stringify(packageMetadata, null, 2));
  writeFile(
    repoRoot,
    'CHANGELOG.md',
    overrides.changelogSource ??
      ['# Changelog', '', '## [0.1.0] - 2026-06-29', '', '### Added', '', '- Initial internal release.', ''].join('\n'),
  );
}

test('parseChangelogSections and release note helpers extract the requested version', () => {
  const changelogSource = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '- Next change.',
    '',
    '## [0.1.0] - 2026-06-29',
    '',
    '### Added',
    '',
    '- Initial release.',
    '',
  ].join('\n');

  const sections = parseChangelogSections(changelogSource);
  assert.deepEqual(
    sections.map((section) => section.version),
    ['Unreleased', '0.1.0'],
  );
  assert.equal(getChangelogSectionForVersion(changelogSource, '0.1.0')?.date, '2026-06-29');
  assert.match(getReleaseNotesMarkdown(changelogSource, '0.1.0'), /Initial release/);
});

test('normalizePromotionRef accepts semver values and v-prefixed tags', () => {
  assert.deepEqual(normalizePromotionRef('0.1.0'), { raw: '0.1.0', ok: true, version: '0.1.0', tagName: 'v0.1.0' });
  assert.deepEqual(normalizePromotionRef('refs/tags/v0.1.0'), {
    raw: 'refs/tags/v0.1.0',
    ok: true,
    version: '0.1.0',
    tagName: 'v0.1.0',
  });
});

test('validateReleaseState passes for a releasable validate-mode repository state', async () => {
  const repoRoot = createTempRepo();
  seedReleaseRepo(repoRoot);

  const report = await validateReleaseState(repoRoot);

  assert.equal(report.releasable, true);
  assert.equal(report.mode, 'validate');
  assert.deepEqual(report.findings, []);
});

test('validateReleaseState fails when the matching changelog section is missing', async () => {
  const repoRoot = createTempRepo();
  seedReleaseRepo(repoRoot, { changelogSource: '# Changelog\n\n## [0.0.9] - 2026-06-01\n\n- Older release.\n' });

  const report = await validateReleaseState(repoRoot);

  assert.equal(report.releasable, false);
  assert.equal(
    report.findings.some((finding) => finding.code === 'changelog-version'),
    true,
  );
});

test('validateReleaseState fails when package metadata is not publishable for the public npm posture', async () => {
  const repoRoot = createTempRepo();
  seedReleaseRepo(repoRoot, {
    packageMetadata: { private: true, publishConfig: { registry: 'https://npm.pkg.github.com', access: 'restricted' } },
  });

  const report = await validateReleaseState(repoRoot);

  assert.equal(report.releasable, false);
  assert.equal(
    report.findings.some((finding) => finding.code === 'package-private'),
    true,
  );
  assert.equal(
    report.findings.some((finding) => finding.code === 'publish-registry'),
    true,
  );
  assert.equal(
    report.findings.some((finding) => finding.code === 'publish-access'),
    true,
  );
});

test('validateReleaseState publish-github mode rejects existing git tags and published versions on either registry', async () => {
  const repoRoot = createTempRepo();
  seedReleaseRepo(repoRoot);

  const report = await validateReleaseState(repoRoot, {
    mode: 'publish-github',
    liveStateEnabled: true,
    tagExists: async () => true,
    publishedVersionExists: async ({ registry }) =>
      registry.includes('npmjs') || registry.includes('npm.pkg.github.com'),
  });

  assert.equal(report.releasable, false);
  assert.equal(
    report.findings.some((finding) => finding.code === 'git-tag-exists'),
    true,
  );
  assert.equal(
    report.findings.some((finding) => finding.code === 'github-version-exists'),
    true,
  );
  assert.equal(
    report.findings.some((finding) => finding.code === 'npm-version-exists'),
    true,
  );
});

test('validateReleaseState publish-npm mode requires an explicit promotion ref', async () => {
  const repoRoot = createTempRepo();
  seedReleaseRepo(repoRoot);

  const report = await validateReleaseState(repoRoot, { mode: 'publish-npm' });

  assert.equal(report.releasable, false);
  assert.equal(
    report.findings.some((finding) => finding.code === 'promotion-ref-required'),
    true,
  );
});

test('validateReleaseState publish-npm mode rejects a promotion ref that does not match package.json version', async () => {
  const repoRoot = createTempRepo();
  seedReleaseRepo(repoRoot);

  const report = await validateReleaseState(repoRoot, { mode: 'publish-npm', promotionRef: 'v0.1.1' });

  assert.equal(report.releasable, false);
  assert.equal(
    report.findings.some((finding) => finding.code === 'promotion-version-mismatch'),
    true,
  );
});

test('validateReleaseState publish-npm mode requires the tag and GitHub Packages version while rejecting npm duplicates', async () => {
  const repoRoot = createTempRepo();
  seedReleaseRepo(repoRoot);

  const report = await validateReleaseState(repoRoot, {
    mode: 'publish-npm',
    promotionRef: 'v0.1.0',
    liveStateEnabled: true,
    tagExists: async () => true,
    headMatchesTag: async () => true,
    publishedVersionExists: async ({ registry }) => registry.includes('npm.pkg.github.com'),
  });

  assert.equal(report.releasable, true);
  assert.deepEqual(report.findings, []);
});

test('validateReleaseState publish-npm mode rejects missing GitHub Packages publication, tag mismatches, and npm duplicates', async () => {
  const repoRoot = createTempRepo();
  seedReleaseRepo(repoRoot);

  const report = await validateReleaseState(repoRoot, {
    mode: 'publish-npm',
    promotionRef: 'v0.1.0',
    liveStateEnabled: true,
    tagExists: async () => false,
    headMatchesTag: async () => false,
    publishedVersionExists: async ({ registry }) => registry.includes('npmjs'),
  });

  assert.equal(report.releasable, false);
  assert.equal(
    report.findings.some((finding) => finding.code === 'git-tag-missing'),
    true,
  );
  assert.equal(
    report.findings.some((finding) => finding.code === 'github-version-missing'),
    true,
  );
  assert.equal(
    report.findings.some((finding) => finding.code === 'npm-version-exists'),
    true,
  );
});
