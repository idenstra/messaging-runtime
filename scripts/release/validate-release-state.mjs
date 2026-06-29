#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_REPO_ROOT = process.cwd();
const EXPECTED_PACKAGE_NAME = '@idenstra/messaging-runtime';
const EXPECTED_REGISTRY = 'https://npm.pkg.github.com';
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

      current = {
        version: match[1],
        date: match[2] ?? null,
        heading: line.trim(),
        bodyLines: [],
      };
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

export async function validateReleaseState(
  repoRoot = DEFAULT_REPO_ROOT,
  options = {},
) {
  const packageMetadata = options.packageMetadata ?? readPackageMetadata(repoRoot);
  const changelogSource = options.changelogSource ?? readFile(repoRoot, 'CHANGELOG.md');
  const findings = [];
  const tagName = createGitTagName(packageMetadata.version);
  const changelogSection = getChangelogSectionForVersion(changelogSource, packageMetadata.version);

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
    findings.push(createReleaseStateFinding('package-private', 'package.json must not declare private=true for releaseable state'));
  }

  if (packageMetadata.publishConfig?.registry !== EXPECTED_REGISTRY) {
    findings.push(
      createReleaseStateFinding(
        'publish-registry',
        `publishConfig.registry must remain ${EXPECTED_REGISTRY}; found ${packageMetadata.publishConfig?.registry ?? '<missing>'}`,
      ),
    );
  }

  if (packageMetadata.publishConfig?.access !== 'restricted') {
    findings.push(
      createReleaseStateFinding(
        'publish-access',
        `publishConfig.access must remain restricted; found ${packageMetadata.publishConfig?.access ?? '<missing>'}`,
      ),
    );
  }

  if (!Array.isArray(packageMetadata.files) || !packageMetadata.files.includes('dist')) {
    findings.push(createReleaseStateFinding('package-files', 'package.json files must include dist'));
  }

  if (!packageMetadata.exports?.['.'] || !packageMetadata.exports?.['./core'] || !packageMetadata.exports?.['./nest']) {
    findings.push(
      createReleaseStateFinding(
        'package-exports',
        'package.json must expose the root entrypoint plus the ./core and ./nest subpaths',
      ),
    );
  }

  if (!packageMetadata.engines?.node || !String(packageMetadata.engines.node).includes('24')) {
    findings.push(createReleaseStateFinding('node-baseline', 'package.json engines.node must preserve the Node 24 baseline'));
  }

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

  if (SEMVER_PATTERN.test(packageMetadata.version ?? '')) {
    const tagExists = options.tagExists ?? defaultTagExists;
    if (await tagExists({ repoRoot, packageName: packageMetadata.name, version: packageMetadata.version, tagName })) {
      findings.push(createReleaseStateFinding('git-tag-exists', `git tag ${tagName} already exists`));
    }
  }

  if (packageMetadata.name && packageMetadata.publishConfig?.registry && SEMVER_PATTERN.test(packageMetadata.version ?? '')) {
    const publishedVersionExists = options.publishedVersionExists ?? defaultPublishedVersionExists;
    if (
      await publishedVersionExists({
        repoRoot,
        packageName: packageMetadata.name,
        version: packageMetadata.version,
        registry: packageMetadata.publishConfig.registry,
        tagName,
      })
    ) {
      findings.push(
        createReleaseStateFinding(
          'published-version-exists',
          `package version ${packageMetadata.version} is already published to ${packageMetadata.publishConfig.registry}`,
        ),
      );
    }
  }

  return {
    packageName: packageMetadata.name,
    version: packageMetadata.version,
    tagName,
    changelogSection,
    findings,
    releasable: findings.length === 0,
  };
}

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    checkGitTag: argv.includes('--check-git-tag'),
    checkPublishedVersion: argv.includes('--check-published-version'),
  };
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));

  const report = await validateReleaseState(DEFAULT_REPO_ROOT, {
    tagExists: args.checkGitTag
      ? undefined
      : async () => false,
    publishedVersionExists: args.checkPublishedVersion
      ? undefined
      : async () => false,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.releasable ? 0 : 1);
  }

  if (report.releasable) {
    console.log(`[validate-release-state] releasable version ${report.version}`);
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
