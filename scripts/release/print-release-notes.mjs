#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getReleaseNotesMarkdown, readPackageMetadata } from './validate-release-state.mjs';

const repoRoot = process.cwd();

function resolveVersion(argv) {
  const explicitVersion = argv.find((arg) => !arg.startsWith('--'));
  if (explicitVersion) {
    return explicitVersion;
  }

  return readPackageMetadata(repoRoot).version;
}

function runCli() {
  const version = resolveVersion(process.argv.slice(2));
  const changelogSource = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
  process.stdout.write(`${getReleaseNotesMarkdown(changelogSource, version)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    console.error(`[print-release-notes] ${error.message}`);
    process.exit(1);
  }
}
