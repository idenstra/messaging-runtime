#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listTrackedFiles } from '../harness/lib/fs-utils.mjs';

const strict = process.env.HARNESS_STRICT === '1' || process.env.CI === 'true';
const root = process.cwd();

const trackedFilePattern = /(^|\/)(AGENTS\.md|WORKFLOW\.md|README\.md|Makefile|.*\.(md|mjs|sh|ya?ml|json|ts))$/i;
const personalPathPatterns = [
  /\/home\/[A-Za-z0-9._-]+(?:\/[^\s'")\]]*)?/g,
  /\/Users\/[A-Za-z0-9._-]+(?:\/[^\s'")\]]*)?/g,
  /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+(?:\\[^\s'")\]]*)?/g,
  /~\/[^\s'")\]]+/g,
];

export function findPersonalPathFindings(repoRoot, trackedFiles = listTrackedFiles(repoRoot)) {
  const findings = [];

  for (const relativePath of trackedFiles) {
    if (!trackedFilePattern.test(relativePath)) {
      continue;
    }

    const filePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      continue;
    }

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach((lineText, index) => {
      for (const pattern of personalPathPatterns) {
        pattern.lastIndex = 0;
        for (const match of lineText.matchAll(pattern)) {
          findings.push({ path: relativePath, line: index + 1, value: match[0] });
        }
      }
    });
  }

  return findings.sort((left, right) =>
    `${left.path}:${left.line}:${left.value}`.localeCompare(`${right.path}:${right.line}:${right.value}`),
  );
}

function runCli() {
  const findings = findPersonalPathFindings(root);

  if (findings.length === 0) {
    console.log('[validate-no-personal-paths] no findings');
    process.exit(0);
  }

  console.log(`[validate-no-personal-paths] ${findings.length} finding(s)`);
  for (const finding of findings) {
    console.log(`- ${finding.path}:${finding.line} contains ${finding.value}`);
  }

  if (strict) {
    process.exit(1);
  }

  console.log('[validate-no-personal-paths] warning mode; set HARNESS_STRICT=1 or run in CI to fail');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
