#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_REPO_ROOT = process.cwd();
const EXPECTED_PACKAGE_NAME = '@idenstra/messaging-runtime';
const EXPECTED_PUBLIC_REGISTRY = 'https://registry.npmjs.org';
const EXPECTED_PUBLIC_ACCESS = 'public';
const GITHUB_PACKAGES_REGISTRY = 'https://npm.pkg.github.com';
const NPMJS_REGISTRY = 'https://registry.npmjs.org';
const RELEASE_MODES = new Set(['validate', 'publish-github', 'publish-npm']);
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readFile(repoRoot, relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

export function readPackageMetadata(repoRoot = DEFAULT_REPO_ROOT) {
  return JSON.parse(readFile(repoRoot, 'package.json'));
}

export function parseChangelogSections(changelogSource) {
  const lines = changelogSource.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^##\s+\[([^\]]+)\](?:\s+-\s+(.+))?\s*$/);
    if (match) {
      if (current) {
        current.body = current.bodyLines.join('\n').trim();
        delete current.bodyLines;
        sections.push(current);
      }

      current = { version: match[1], date: match[2] ?? null, heading: line.trim(), bodyLines: [] };
      continue;
    }

    if (current) {
      current.bodyLines.push(line);
    }
  }

  if (current) {
    current.body = current.bodyLines.join('\n').trim();
    delete current.bodyLines;
    sections.push(current);
  }

  return sections;
}

export function getChangelogSectionForVersion(changelogSource, version) {
  return parseChangelogSections(changelogSource).find((section) => section.version === version) ?? null;
}

export function getReleaseNotesMarkdown(changelogSource, version) {
  const section = getChangelogSectionForVersion(changelogSource, version);
  if (!section) {
    throw new Error(`CHANGELOG.md does not contain a section for version ${version}`);
  }

  if (!section.body) {
    throw new Error(`CHANGELOG.md section for version ${version} is empty`);
  }

  return section.body;
}

export function createGitTagName(version) {
  return `v${version}`;
}

export function createReleaseStateFinding(code, message) {
  return { code, message };
}

export function normalizePromotionRef(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.startsWith('refs/tags/') ? raw.slice('refs/tags/'.length) : raw;
  const version = normalized.startsWith('v') ? normalized.slice(1) : normalized;

  if (!SEMVER_PATTERN.test(version)) {
    return { raw, ok: false, version: null, tagName: null };
  }

  return { raw, ok: true, version, tagName: createGitTagName(version) };
}

function defaultTagExists({ tagName, repoRoot }) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tagName}`], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function defaultHeadMatchesTag({ tagName, repoRoot }) {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }).trim();
    const tagHead = execFileSync('git', ['rev-list', '-n', '1', tagName], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }).trim();

    return head.length > 0 && head === tagHead;
  } catch {
    return false;
  }
}

function defaultPublishedVersionExists({ packageName, version, registry, repoRoot }) {
  try {
    execFileSync('npm', ['view', `${packageName}@${version}`, 'version', '--registry', registry, '--json'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    return true;
  } catch (error) {
    const stderr = String(error.stderr ?? '');
    const stdout = String(error.stdout ?? '');
    const combined = `${stdout}\n${stderr}`;

    if (/\bE404\b/.test(combined) || /\b404\b/.test(combined) || /No match found/i.test(combined)) {
      return false;
    }

    throw new Error(`Failed to query published package version: ${combined.trim() || error.message}`);
  }
}

function validatePackageMetadata(packageMetadata, findings) {
  if (packageMetadata.name !== EXPECTED_PACKAGE_NAME) {
    findings.push(
      createReleaseStateFinding(
        'package-name',
        `package name must remain ${EXPECTED_PACKAGE_NAME}; found ${packageMetadata.name ?? '<missing>'}`,
      ),
    );
  }

  if (!SEMVER_PATTERN.test(packageMetadata.version ?? '')) {
    findings.push(
      createReleaseStateFinding(
        'package-version',
        `package version must be a valid semver value; found ${packageMetadata.version ?? '<missing>'}`,
      ),
    );
  }

  if (packageMetadata.private === true) {
    findings.push(
      createReleaseStateFinding('package-private', 'package.json must not declare private=true for releaseable state'),
    );
  }

  if (packageMetadata.publishConfig?.registry !== EXPECTED_PUBLIC_REGISTRY) {
    findings.push(
      createReleaseStateFinding(
        'publish-registry',
        `publishConfig.registry must remain ${EXPECTED_PUBLIC_REGISTRY}; found ${packageMetadata.publishConfig?.registry ?? '<missing>'}`,
      ),
    );
  }

  if (packageMetadata.publishConfig?.access !== EXPECTED_PUBLIC_ACCESS) {
    findings.push(
      createReleaseStateFinding(
        'publish-access',
        `publishConfig.access must remain ${EXPECTED_PUBLIC_ACCESS}; found ${packageMetadata.publishConfig?.access ?? '<missing>'}`,
      ),
    );
  }

  if (!Array.isArray(packageMetadata.files) || !packageMetadata.files.includes('dist')) {
    findings.push(createReleaseStateFinding('package-files', 'package.json files must include dist'));
  }

  const requiredExports = ['.', './core', './nest', './observability'];
  if (!requiredExports.every((subpath) => packageMetadata.exports?.[subpath])) {
    findings.push(
      createReleaseStateFinding(
        'package-exports',
        'package.json must expose the root entrypoint plus the ./core, ./nest, and ./observability subpaths',
      ),
    );
  }

  if (!packageMetadata.engines?.node || !String(packageMetadata.engines.node).includes('24')) {
    findings.push(
      createReleaseStateFinding('node-baseline', 'package.json engines.node must preserve the Node 24 baseline'),
    );
  }
}

async function validateLiveState({
  mode,
  repoRoot,
  packageMetadata,
  tagName,
  promotionRef,
  findings,
  tagExists,
  headMatchesTag,
  publishedVersionExists,
}) {
  const packageName = packageMetadata.name;
  const version = packageMetadata.version;

  const githubPublished = async () =>
    publishedVersionExists({ repoRoot, packageName, version, registry: GITHUB_PACKAGES_REGISTRY, tagName });
  const npmPublished = async () =>
    publishedVersionExists({ repoRoot, packageName, version, registry: NPMJS_REGISTRY, tagName });

  if (mode === 'publish-npm') {
    if (!(await tagExists({ repoRoot, packageName, version, tagName }))) {
      findings.push(createReleaseStateFinding('git-tag-missing', `git tag ${tagName} must exist before npm promotion`));
    } else if (!(await headMatchesTag({ repoRoot, packageName, version, tagName }))) {
      findings.push(
        createReleaseStateFinding(
          'git-tag-head-mismatch',
          `checked-out commit must match git tag ${tagName} before npm promotion`,
        ),
      );
    }

    if (!(await githubPublished())) {
      findings.push(
        createReleaseStateFinding(
          'github-version-missing',
          `package version ${version} must already be published to ${GITHUB_PACKAGES_REGISTRY} before npm promotion`,
        ),
      );
    }

    if (await npmPublished()) {
      findings.push(
        createReleaseStateFinding(
          'npm-version-exists',
          `package version ${version} is already published to ${NPMJS_REGISTRY}`,
        ),
      );
    }

    if (promotionRef?.ok && promotionRef.tagName !== tagName) {
      findings.push(
        createReleaseStateFinding(
          'promotion-tag-mismatch',
          `promotion ref ${promotionRef.raw} resolves to ${promotionRef.tagName}, but package.json expects ${tagName}`,
        ),
      );
    }

    return;
  }

  if (await tagExists({ repoRoot, packageName, version, tagName })) {
    findings.push(createReleaseStateFinding('git-tag-exists', `git tag ${tagName} already exists`));
  }

  if (await githubPublished()) {
    findings.push(
      createReleaseStateFinding(
        'github-version-exists',
        `package version ${version} is already published to ${GITHUB_PACKAGES_REGISTRY}`,
      ),
    );
  }

  if (await npmPublished()) {
    findings.push(
      createReleaseStateFinding(
        'npm-version-exists',
        `package version ${version} is already published to ${NPMJS_REGISTRY}`,
      ),
    );
  }
}

export async function validateReleaseState(repoRoot = DEFAULT_REPO_ROOT, options = {}) {
  const packageMetadata = options.packageMetadata ?? readPackageMetadata(repoRoot);
  const changelogSource = options.changelogSource ?? readFile(repoRoot, 'CHANGELOG.md');
  const mode = options.mode ?? 'validate';
  const findings = [];
  const tagName = createGitTagName(packageMetadata.version);
  const changelogSection = getChangelogSectionForVersion(changelogSource, packageMetadata.version);
  const promotionRef = normalizePromotionRef(options.promotionRef);
  const liveStateEnabled = options.liveStateEnabled ?? false;

  if (!RELEASE_MODES.has(mode)) {
    findings.push(
      createReleaseStateFinding(
        'release-mode',
        `release mode must be one of ${[...RELEASE_MODES].join(', ')}; found ${mode}`,
      ),
    );
  }

  validatePackageMetadata(packageMetadata, findings);

  if (!changelogSection) {
    findings.push(
      createReleaseStateFinding(
        'changelog-version',
        `CHANGELOG.md must contain a section matching package version ${packageMetadata.version}`,
      ),
    );
  } else if (!changelogSection.body) {
    findings.push(
      createReleaseStateFinding(
        'changelog-empty',
        `CHANGELOG.md section for version ${packageMetadata.version} must include release notes`,
      ),
    );
  }

  if (mode === 'publish-npm') {
    if (!promotionRef) {
      findings.push(
        createReleaseStateFinding(
          'promotion-ref-required',
          'publish-npm mode requires an explicit --promotion-ref value such as v1.0.0 or 1.0.0',
        ),
      );
    } else if (!promotionRef.ok) {
      findings.push(
        createReleaseStateFinding(
          'promotion-ref-invalid',
          `promotion ref must be a semver version or v-prefixed tag; found ${promotionRef.raw}`,
        ),
      );
    } else if (promotionRef.version !== packageMetadata.version) {
      findings.push(
        createReleaseStateFinding(
          'promotion-version-mismatch',
          `promotion ref ${promotionRef.raw} resolves to version ${promotionRef.version}, but package.json declares ${packageMetadata.version}`,
        ),
      );
    }
  }

  if (liveStateEnabled && findings.length === 0) {
    const tagExists = options.tagExists ?? defaultTagExists;
    const headMatchesTag = options.headMatchesTag ?? defaultHeadMatchesTag;
    const publishedVersionExists = options.publishedVersionExists ?? defaultPublishedVersionExists;

    await validateLiveState({
      mode,
      repoRoot,
      packageMetadata,
      tagName,
      promotionRef,
      findings,
      tagExists,
      headMatchesTag,
      publishedVersionExists,
    });
  }

  return {
    mode,
    packageName: packageMetadata.name,
    version: packageMetadata.version,
    tagName,
    promotionRef,
    changelogSection,
    findings,
    releasable: findings.length === 0,
  };
}

function takeFlagValue(argv, flagName) {
  const index = argv.indexOf(flagName);
  if (index === -1) {
    return null;
  }

  return argv[index + 1] ?? null;
}

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    mode: takeFlagValue(argv, '--mode') ?? 'validate',
    promotionRef: takeFlagValue(argv, '--promotion-ref'),
    liveStateEnabled: argv.includes('--check-live-state'),
  };
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));

  const report = await validateReleaseState(DEFAULT_REPO_ROOT, {
    mode: args.mode,
    promotionRef: args.promotionRef,
    liveStateEnabled: args.liveStateEnabled,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.releasable ? 0 : 1);
  }

  if (report.releasable) {
    console.log(`[validate-release-state] releasable ${report.mode} state for version ${report.version}`);
    process.exit(0);
  }

  console.log(`[validate-release-state] ${report.findings.length} finding(s) for version ${report.version}`);
  for (const finding of report.findings) {
    console.log(`- ${finding.code}: ${finding.message}`);
  }

  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(`[validate-release-state] ${error.message}`);
    process.exit(1);
  });
}
