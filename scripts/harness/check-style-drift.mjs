#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listTrackedFiles } from './lib/fs-utils.mjs';

const root = process.cwd();

const textLikePattern =
  /^(?:README\.md|AGENTS\.md|WORKFLOW\.md|docs\/.*\.md|src\/.*\.ts|test\/.*\.ts|scripts\/.*\.(?:mjs|md)|package\.json|biome\.json|\.github\/.*\.(?:md|ya?ml))$/;
const agentMentionAllowlist = new Set(['AGENTS.md', 'docs/AI_ENGINEERING.md']);
const ruleLiteralAllowlist = new Map([
  ['scripts/harness/check-style-drift.mjs', new Set(['tool-signature', 'untracked-marker'])],
  ['scripts/harness/check-style-drift.test.mjs', new Set(['tool-signature', 'untracked-marker'])],
]);
const toolSignaturePattern = /\b(?:chatgpt|claude|cursor|kiro|copilot|codex)\b/i;
const issueLinkedMarkerPattern = /\b(?:TODO|FIXME|HACK|XXX)\b/i;
const issueReferencePattern = /(?:^|[^\w])#\d+\b|https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+\b/i;
const inlineCodePattern = /`[^`]*`/g;

function shouldScan(relativePath) {
  return textLikePattern.test(relativePath);
}

function allowsAgentMentions(relativePath) {
  return agentMentionAllowlist.has(relativePath);
}

function allowsRuleLiteral(relativePath, code) {
  return ruleLiteralAllowlist.get(relativePath)?.has(code) ?? false;
}

export function findStyleDriftFindings(repoRoot, trackedFiles = listTrackedFiles(repoRoot)) {
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

    lines.forEach((lineText, index) => {
      const normalizedLine = lineText.replaceAll(inlineCodePattern, '');

      if (
        !allowsAgentMentions(relativePath) &&
        !allowsRuleLiteral(relativePath, 'tool-signature') &&
        toolSignaturePattern.test(normalizedLine)
      ) {
        findings.push({
          code: 'tool-signature',
          path: relativePath,
          line: index + 1,
          text: lineText.trim(),
          message: 'remove model or tool attribution from tracked repo content',
        });
      }

      if (
        !allowsRuleLiteral(relativePath, 'untracked-marker') &&
        issueLinkedMarkerPattern.test(normalizedLine) &&
        !issueReferencePattern.test(normalizedLine)
      ) {
        findings.push({
          code: 'untracked-marker',
          path: relativePath,
          line: index + 1,
          text: lineText.trim(),
          message: 'link TODO/FIXME/HACK/XXX markers to a tracked issue or remove them',
        });
      }
    });
  }

  return findings.sort((left, right) =>
    `${left.path}:${left.line}:${left.code}:${left.text}`.localeCompare(
      `${right.path}:${right.line}:${right.code}:${right.text}`,
    ),
  );
}

function runCli() {
  const findings = findStyleDriftFindings(root);

  if (findings.length === 0) {
    console.log('[check-style-drift] no findings');
    process.exit(0);
  }

  console.log(`[check-style-drift] ${findings.length} finding(s)`);
  for (const finding of findings) {
    console.log(`- ${finding.path}:${finding.line} [${finding.code}] ${finding.message}: ${finding.text}`);
  }

  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
