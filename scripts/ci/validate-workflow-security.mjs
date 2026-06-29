#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_WORKFLOWS_DIR = path.join(process.cwd(), '.github', 'workflows');

function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, '');
}

function parseInlineEvents(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((part) => stripQuotes(part.trim()))
      .filter(Boolean);
  }

  return [stripQuotes(trimmed)];
}

export function parseWorkflowEvents(source) {
  const events = new Set();
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)on\s*:\s*(.*)$/);
    if (!match) {
      continue;
    }

    const baseIndent = match[1].length;
    const inlineValue = match[2].trim();
    if (inlineValue) {
      for (const event of parseInlineEvents(inlineValue)) {
        events.add(event);
      }
      continue;
    }

    for (let nestedIndex = index + 1; nestedIndex < lines.length; nestedIndex += 1) {
      const nestedLine = lines[nestedIndex];
      if (nestedLine.trim().length === 0) {
        continue;
      }

      const nestedIndent = (nestedLine.match(/^\s*/) || [''])[0].length;
      if (nestedIndent <= baseIndent) {
        break;
      }

      const trimmed = nestedLine.trim();
      if (trimmed.startsWith('- ')) {
        const event = stripQuotes(trimmed.slice(2).trim());
        if (event) {
          events.add(event);
        }
        continue;
      }

      const keyMatch = trimmed.match(/^['"]?([A-Za-z0-9_-]+)['"]?\s*:/);
      if (keyMatch) {
        events.add(keyMatch[1]);
      }
    }
  }

  return events;
}

function getWorkflowFiles(workflowsDir) {
  if (!fs.existsSync(workflowsDir)) {
    return [];
  }

  return fs
    .readdirSync(workflowsDir)
    .filter((fileName) => /\.(?:ya?ml)$/i.test(fileName))
    .map((fileName) => path.join(workflowsDir, fileName))
    .sort();
}

function getLineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

export function extractCheckoutSteps(source) {
  const blocks = [];
  const lines = source.split(/\r?\n/);
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const stepStart = line.match(/^(\s*)-\s+/);

    if (stepStart) {
      if (current) {
        blocks.push(current);
      }

      current = { startLine: index + 1, lines: [line] };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    blocks.push(current);
  }

  return blocks
    .map((block) => ({ startLine: block.startLine, text: block.lines.join('\n') }))
    .filter((block) => /uses:\s*['"]?actions\/checkout@/m.test(block.text));
}

const RULES = [
  {
    event: 'workflow_run',
    description: 'workflow_run must not checkout an untrusted workflow_run head ref or repository',
    expressionPattern:
      /\$\{\{\s*github\.event\.workflow_run\.(?:head_branch|head_sha|head_repository(?:\.[A-Za-z0-9_.]+)?)\s*\}\}|\$\{\{\s*github\.event\.workflow_run\.pull_requests\[\d+\]\.head\.(?:ref|sha|repo\.full_name)\s*\}\}/g,
  },
  {
    event: 'pull_request_target',
    description: 'pull_request_target must not checkout an untrusted pull_request head ref or repository',
    expressionPattern: /\$\{\{\s*github\.event\.pull_request\.head\.(?:ref|sha|repo\.full_name)\s*\}\}/g,
  },
];

const scopedWritePermissionPattern =
  /^\s*(?:contents|issues|pull-requests|actions|checks|deployments|discussions|id-token|packages|pages|repository-projects|security-events|statuses):\s*write\b/m;
const writeAllPermissionPattern = /^\s*permissions\s*:\s*write-all\b/m;
const inlineWritePermissionPattern =
  /^\s*permissions\s*:\s*\{[^\n]*\b['"]?(?:contents|issues|pull-requests|actions|checks|deployments|discussions|id-token|packages|pages|repository-projects|security-events|statuses)['"]?\s*:\s*write\b[^\n]*\}/m;
const npmCiPattern =
  /\bnpm(?:\s+-{1,2}[A-Za-z0-9-]+(?:=(?:[^\s]+)|\s+(?!ci\b)[^\s]+)?)*\s+ci\b(?![^\n]*--ignore-scripts)/g;

export function findWorkflowSecurityViolations(filePath, source) {
  const violations = [];
  const checkoutSteps = extractCheckoutSteps(source);
  const workflowEvents = parseWorkflowEvents(source);

  for (const rule of RULES) {
    if (!workflowEvents.has(rule.event)) {
      continue;
    }

    for (const step of checkoutSteps) {
      for (const match of step.text.matchAll(rule.expressionPattern)) {
        violations.push({
          filePath,
          event: rule.event,
          description: rule.description,
          expression: match[0],
          line: step.startLine + getLineNumber(step.text, match.index ?? 0) - 1,
        });
      }
    }
  }

  const hasWritePermissions =
    scopedWritePermissionPattern.test(source) ||
    writeAllPermissionPattern.test(source) ||
    inlineWritePermissionPattern.test(source);

  if (hasWritePermissions) {
    for (const match of source.matchAll(npmCiPattern)) {
      violations.push({
        filePath,
        event: 'write-permission install',
        description: 'workflows with write permissions must install npm dependencies with --ignore-scripts',
        expression: match[0],
        line: getLineNumber(source, match.index ?? 0),
      });
    }
  }

  return violations;
}

export function validateWorkflowSecurity(workflowsDir = DEFAULT_WORKFLOWS_DIR) {
  const files = getWorkflowFiles(workflowsDir);
  const violations = [];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    violations.push(...findWorkflowSecurityViolations(filePath, source));
  }

  return { files, violations };
}

function runCli() {
  const result = validateWorkflowSecurity();

  if (result.violations.length === 0) {
    console.log(`[validate-workflow-security] validated ${result.files.length} workflow file(s)`);
    process.exit(0);
  }

  console.log(`[validate-workflow-security] ${result.violations.length} finding(s)`);
  for (const violation of result.violations) {
    console.log(`- ${path.basename(violation.filePath)}:${violation.line} ${violation.description}`);
    console.log(`  unsafe expression: ${violation.expression}`);
  }

  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
