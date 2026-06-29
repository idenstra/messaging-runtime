#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  packageName,
  supportedPublicExportKeys,
  supportedPublicImportSpecifiers,
} from '../public-surface/public-surface.mjs';
import { listTrackedFiles } from './lib/fs-utils.mjs';

const root = process.cwd();
const trackedFiles = listTrackedFiles(root);
const supportedImportSpecifiers = new Set(supportedPublicImportSpecifiers);
const packageImportPattern = /@idenstra\/messaging-runtime(?:\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)?/g;

export function findPublicImportSurfaceFindings(repoRoot = root, repoTrackedFiles = trackedFiles) {
  const findings = [];
  const scannableFiles = repoTrackedFiles.filter(
    (relativePath) => relativePath.endsWith('.md') || relativePath.endsWith('.mjs') || relativePath.endsWith('.ts'),
  );

  for (const relativePath of scannableFiles) {
    const filePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      continue;
    }

    const contents = fs.readFileSync(filePath, 'utf8');
    const lines = contents.split(/\r?\n/);

    lines.forEach((line, index) => {
      const matches = line.matchAll(packageImportPattern);
      for (const match of matches) {
        const specifier = match[0];
        if (supportedImportSpecifiers.has(specifier)) {
          continue;
        }

        findings.push({
          code: 'unsupported-import-specifier',
          path: relativePath,
          line: index + 1,
          text: line,
          specifier,
          message: `unsupported package import; use one of ${[...supportedImportSpecifiers].join(', ')}`,
        });
      }
    });
  }

  return findings.concat(findPackageExportFindings(repoRoot));
}

export function findPackageExportFindings(repoRoot = root) {
  const packageMetadata = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const actualExportKeys = Object.keys(packageMetadata.exports ?? {}).sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
  const expectedExportKeys = [...supportedPublicExportKeys].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );

  if (JSON.stringify(actualExportKeys) === JSON.stringify(expectedExportKeys)) {
    return [];
  }

  return [
    {
      code: 'unsupported-export-subpaths',
      path: 'package.json',
      message: `package exports must stay exactly ${expectedExportKeys.join(', ')}`,
      actualExportKeys,
      expectedExportKeys,
    },
  ];
}

function runCli() {
  const findings = findPublicImportSurfaceFindings();

  if (findings.length === 0) {
    process.exit(0);
  }

  for (const finding of findings) {
    if (finding.path === 'package.json') {
      console.error(`[public-import-surface] ${finding.path}: ${finding.message}`);
      continue;
    }

    console.error(
      `[public-import-surface] ${finding.path}:${finding.line}: ${finding.message} (${finding.specifier ?? packageName})`,
    );
  }

  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli();
}
