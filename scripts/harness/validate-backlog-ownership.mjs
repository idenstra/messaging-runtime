#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listTrackedFiles } from './lib/fs-utils.mjs';

const root = process.cwd();

const trackedDocPattern = /^(AGENTS\.md|WORKFLOW\.md|README\.md|docs\/.*\.md)$/;
const allowedPrefixes = ['docs/exec-plans/', 'docs/templates/'];
const fencePattern = /^(```|~~~)/;
const uncheckedChecklistPattern = /^\s*(?:[-*+]|\d+\.)\s+\[ \]\s+/;

function shouldScan(relativePath) {
  return trackedDocPattern.test(relativePath) && !allowedPrefixes.some((prefix) => relativePath.startsWith(prefix));
}

export function findBacklogOwnershipFindings(repoRoot, trackedFiles = listTrackedFiles(repoRoot)) {
  const findings = [];

  for (const relativePath of trackedFiles) {
    if (!shouldScan(relativePath)) {
      continue;
    }

    const filePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      continue;
    }

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    let inFence = false;

    lines.forEach((lineText, index) => {
      if (fencePattern.test(lineText.trim())) {
        inFence = !inFence;
        return;
      }

      if (inFence || !uncheckedChecklistPattern.test(lineText)) {
        return;
      }

      findings.push({ path: relativePath, line: index + 1, text: lineText.trim() });
    });
  }

  return findings.sort((left, right) =>
    `${left.path}:${left.line}:${left.text}`.localeCompare(`${right.path}:${right.line}:${right.text}`),
  );
}

function runCli() {
  const findings = findBacklogOwnershipFindings(root);

  if (findings.length === 0) {
    console.log('[validate-backlog-ownership] no findings');
    process.exit(0);
  }

  console.log(`[validate-backlog-ownership] ${findings.length} finding(s)`);
  for (const finding of findings) {
    console.log(`- ${finding.path}:${finding.line} contains live backlog checklist item: ${finding.text}`);
  }

  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
