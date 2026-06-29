#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  ACTIVE_EXECUTION_PLANS_DIR,
  isActiveExecutionPlanPath,
  isExplicitNoExecutionPlan,
  listExecutionPlanPaths,
  normalizeExecutionPlanPath,
  readOriginRepoFullName,
} from '../harness/lib/execution-plan-utils.mjs';

const root = process.cwd();

const closingKeywordPattern =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+((?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#(\d+))\b/gi;
const executionPlanPattern = /^Execution plan:\s*(.+)$/im;
const planFreeExemptionPattern = /^Plan-free exemption:\s*(.+)$/im;
const issueFreeExemptionPattern = /^Issue-free exemption:\s*(.+)$/im;
const docsOnlyPatterns = [
  /^(?:AGENTS|WORKFLOW|README)\.md$/,
  /^docs\/.*\.md$/,
  /^scripts\/.*\.md$/,
  /^\.github\/ISSUE_TEMPLATE\/.*\.ya?ml$/,
  /^\.github\/PULL_REQUEST_TEMPLATE\.md$/,
];
const testOnlyPatterns = [
  /(^|\/)(test|tests)\//,
  /\.(?:spec|test)\.[cm]?[jt]sx?$/,
  /^scripts\/(?:ci|harness)\/.*\.test\.mjs$/,
];
const tinyToolingPatterns = [
  /^\.github\/workflows\/.*\.ya?ml$/,
  /^scripts\/harness\/verify\.sh$/,
  /^Makefile$/,
  /^\.npmrc$/,
  /^\.gitignore$/,
  /^(?:package|package-lock)\.json$/,
  /^tsconfig.*\.json$/,
];
const trivialExemptions = new Set(['docs-only', 'test-only', 'tiny-tooling']);
const planFreeExemptions = new Set([...trivialExemptions, 'bugfix', 'incident-hotfix']);

function normalizeExemption(value) {
  return value.trim().toLowerCase();
}

function matchesAny(relativePath, patterns) {
  return patterns.some((pattern) => pattern.test(relativePath));
}

function extractField(body, pattern) {
  const match = body.match(pattern);
  return match?.[1] ? match[1].trim() : null;
}

export function extractIssueRefs(body, repoFullName) {
  const issueNumbers = new Set();

  for (const match of body.matchAll(closingKeywordPattern)) {
    const fullReference = match[1] ?? '';
    const issueNumber = Number.parseInt(match[2] ?? '', 10);
    const [qualifiedRepo] = fullReference.split('#');

    if (!Number.isInteger(issueNumber)) {
      continue;
    }

    if (qualifiedRepo && qualifiedRepo !== repoFullName) {
      continue;
    }

    issueNumbers.add(issueNumber);
  }

  return [...issueNumbers].sort((left, right) => left - right);
}

export function extractExecutionPlan(body) {
  const value = extractField(body, executionPlanPattern);
  return value ? normalizeExecutionPlanPath(value) : null;
}

export function extractPlanFreeExemption(body) {
  const value = extractField(body, planFreeExemptionPattern);
  return value ? normalizeExemption(value) : null;
}

export function extractIssueFreeExemption(body) {
  const value = extractField(body, issueFreeExemptionPattern);
  return value ? normalizeExemption(value) : null;
}

export function classifyTrivialChange(changedFiles) {
  if (changedFiles.length === 0) {
    return null;
  }

  if (changedFiles.every((relativePath) => matchesAny(relativePath, docsOnlyPatterns))) {
    return 'docs-only';
  }

  if (changedFiles.every((relativePath) => matchesAny(relativePath, testOnlyPatterns))) {
    return 'test-only';
  }

  if (changedFiles.every((relativePath) => matchesAny(relativePath, tinyToolingPatterns))) {
    return 'tiny-tooling';
  }

  return null;
}

function validatePlanFreeExemption(planExemption, trivialClassification) {
  if (!planExemption || planExemption === 'none') {
    return {
      ok: false,
      message:
        'issue-linked pull requests must reference an active execution plan or declare `Plan-free exemption: docs-only|test-only|tiny-tooling|bugfix|incident-hotfix`',
    };
  }

  if (!planFreeExemptions.has(planExemption)) {
    return { ok: false, message: `invalid \`Plan-free exemption\`: \`${planExemption}\`` };
  }

  if (trivialExemptions.has(planExemption)) {
    if (!trivialClassification) {
      return {
        ok: false,
        message: `changed files do not qualify for the \`${planExemption}\` plan-free exemption; reference an active execution plan instead`,
      };
    }

    if (trivialClassification !== planExemption) {
      return {
        ok: false,
        message: `changed files only qualify for the \`${trivialClassification}\` plan-free exemption, but the PR body declares \`${planExemption}\``,
      };
    }
  }

  return { ok: true, message: `validated explicit \`${planExemption}\` plan-free exemption` };
}

export function evaluatePullRequestGovernance({
  body,
  changedFiles,
  existingIssueNumbers,
  repoFullName,
  activeExecutionPlans,
}) {
  const issueRefs = extractIssueRefs(body, repoFullName);
  const executionPlan = extractExecutionPlan(body);
  const planExemption = extractPlanFreeExemption(body);
  const issueExemption = extractIssueFreeExemption(body);
  const trivialClassification = classifyTrivialChange(changedFiles);

  if (issueRefs.length > 0) {
    const missingIssues = issueRefs.filter((issueNumber) => !existingIssueNumbers.has(issueNumber));
    if (missingIssues.length > 0) {
      return {
        ok: false,
        mode: 'issue-linked',
        message: `referenced issue(s) do not exist or are not ordinary issues in ${repoFullName}: ${missingIssues.map((issueNumber) => `#${issueNumber}`).join(', ')}`,
      };
    }

    if (executionPlan && !isExplicitNoExecutionPlan(executionPlan)) {
      if (!isActiveExecutionPlanPath(executionPlan)) {
        return {
          ok: false,
          mode: 'issue-linked',
          message: `execution plan must reference ${ACTIVE_EXECUTION_PLANS_DIR}/<issue>-slug.md`,
        };
      }

      if (!activeExecutionPlans.has(executionPlan)) {
        return {
          ok: false,
          mode: 'issue-linked',
          message: `execution plan path does not exist in the repo: ${executionPlan}`,
        };
      }

      if (planExemption && planExemption !== 'none') {
        return {
          ok: false,
          mode: 'issue-linked',
          message: 'remove `Plan-free exemption` when the PR already references an active execution plan',
        };
      }

      return {
        ok: true,
        mode: 'issue-linked',
        message: `validated same-repo issue link(s) and active execution plan: ${issueRefs.map((issueNumber) => `#${issueNumber}`).join(', ')}; ${executionPlan}`,
      };
    }

    const validation = validatePlanFreeExemption(planExemption, trivialClassification);
    return validation.ok
      ? { ok: true, mode: 'issue-linked-plan-free', message: validation.message }
      : { ok: false, mode: 'issue-linked', message: validation.message };
  }

  if (!trivialClassification) {
    return {
      ok: false,
      mode: 'non-trivial',
      message: 'non-trivial pull requests must link a same-repo issue with `Closes #...` or `Fixes #...`',
    };
  }

  if (!issueExemption || issueExemption === 'none') {
    return {
      ok: false,
      mode: 'trivial',
      message: `this PR only qualifies for the \`${trivialClassification}\` exemption; set \`Issue-free exemption: ${trivialClassification}\` in the PR body`,
    };
  }

  if (issueExemption !== trivialClassification) {
    return {
      ok: false,
      mode: 'trivial',
      message: `changed files only qualify for the \`${trivialClassification}\` exemption, but the PR body declares \`${issueExemption}\``,
    };
  }

  return { ok: true, mode: 'trivial', message: `validated explicit \`${trivialClassification}\` exemption` };
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'idenstra-harness',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}) for ${url}`);
  }

  return response.json();
}

async function fetchPullRequestFiles(repoFullName, prNumber, token) {
  const files = [];
  let page = 1;

  while (true) {
    const payload = await fetchJson(
      `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      token,
    );

    if (!Array.isArray(payload) || payload.length === 0) {
      break;
    }

    files.push(...payload.map((entry) => String(entry?.filename ?? '').trim()).filter(Boolean));

    if (payload.length < 100) {
      break;
    }

    page += 1;
  }

  return files;
}

async function resolveIssueStates(repoFullName, issueNumbers, token) {
  const states = new Map();

  for (const issueNumber of issueNumbers) {
    try {
      const payload = await fetchJson(`https://api.github.com/repos/${repoFullName}/issues/${issueNumber}`, token);
      states.set(issueNumber, payload?.pull_request ? 'MISSING' : String(payload?.state ?? '').toUpperCase());
    } catch (error) {
      const status = Number.parseInt(String(error.message).match(/\((\d+)\)/)?.[1] ?? '', 10);
      states.set(issueNumber, status === 404 || status === 410 ? 'MISSING' : '');
    }
  }

  return states;
}

async function runCli() {
  if (!process.env.GITHUB_EVENT_PATH || !fs.existsSync(process.env.GITHUB_EVENT_PATH)) {
    console.log('[validate-pr-governance] no GitHub event payload; skipping');
    process.exit(0);
  }

  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (!event.pull_request) {
    console.log('[validate-pr-governance] no pull request context; skipping');
    process.exit(0);
  }

  if (!process.env.GITHUB_TOKEN) {
    console.log('[validate-pr-governance] GITHUB_TOKEN not set; skipping');
    process.exit(0);
  }

  const repoFullName = readOriginRepoFullName(root);
  const prNumber = Number.parseInt(String(event.number ?? event.pull_request.number ?? ''), 10);
  const body = String(event.pull_request.body ?? '');
  const changedFiles = await fetchPullRequestFiles(repoFullName, prNumber, process.env.GITHUB_TOKEN);
  const issueRefs = extractIssueRefs(body, repoFullName);
  const issueStates = await resolveIssueStates(repoFullName, issueRefs, process.env.GITHUB_TOKEN);
  const existingIssueNumbers = new Set(
    [...issueStates.entries()].filter(([, state]) => state && state !== 'MISSING').map(([issueNumber]) => issueNumber),
  );
  const activeExecutionPlans = new Set(listExecutionPlanPaths(root, ACTIVE_EXECUTION_PLANS_DIR));

  const evaluation = evaluatePullRequestGovernance({
    body,
    changedFiles,
    existingIssueNumbers,
    repoFullName,
    activeExecutionPlans,
  });

  if (evaluation.ok) {
    console.log(`[validate-pr-governance] ${evaluation.message}`);
    process.exit(0);
  }

  console.error(`[validate-pr-governance] ${evaluation.message}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(`[validate-pr-governance] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
