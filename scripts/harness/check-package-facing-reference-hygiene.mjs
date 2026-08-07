#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listTrackedFiles } from './lib/fs-utils.mjs';

const root = process.cwd();
const trackedFiles = listTrackedFiles(root);
const ownerRepoIssuePattern = /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+\b/g;
const githubReferencePattern =
  /\bhttps:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/issues\/\d+|\/pull\/\d+|\/tree\/[^\s)]+|\/blob\/[^\s)]+)?\b/g;

export function findPackageFacingReferenceHygieneFindings(repoRoot = root, repoTrackedFiles = trackedFiles) {
  const findings = [];
  const scannableFiles = repoTrackedFiles.filter((relativePath) => {
    if (relativePath.startsWith('docs/exec-plans/')) {
      return false;
    }

    return relativePath.endsWith('.md') || (relativePath.startsWith('src/') && relativePath.endsWith('.ts'));
  });

  for (const relativePath of scannableFiles) {
    const filePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      continue;
    }

    const contents = fs.readFileSync(filePath, 'utf8');
    const lines = contents.split(/\r?\n/);

    lines.forEach((line, index) => {
      findings.push(
        ...findMatches(ownerRepoIssuePattern, line, relativePath, index + 1, 'cross-repo-slug-reference'),
        ...findMatches(githubReferencePattern, line, relativePath, index + 1, 'github-reference'),
      );
    });
  }

  return findings;
}

function findMatches(pattern, line, relativePath, lineNumber, code) {
  pattern.lastIndex = 0;
  const matches = line.matchAll(pattern);
  const findings = [];

  for (const match of matches) {
    findings.push({
      code,
      path: relativePath,
      line: lineNumber,
      text: line,
      matchedText: match[0],
      message:
        'move cross-repo or implementation-history references into issues rather than package-facing docs or source',
    });
  }

  return findings;
}

function runCli() {
  const findings = findPackageFacingReferenceHygieneFindings();

  if (findings.length === 0) {
    process.exit(0);
  }

  for (const finding of findings) {
    console.error(
      `[package-facing-reference-hygiene] ${finding.path}:${finding.line}: ${finding.message} (${finding.matchedText})`,
    );
  }

  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli();
}
