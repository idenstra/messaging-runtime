#!/usr/bin/env node
import childProcess from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  ACTIVE_EXECUTION_PLANS_DIR,
  COMPLETED_EXECUTION_PLANS_DIR,
  createCompletedExecutionPlanPath,
  extractIssueNumberFromExecutionPlanPath,
  isExecutionPlanReadmePath,
  listExecutionPlanPaths,
  moveExecutionPlanToCompleted,
  normalizeExecutionPlanPath,
  readOriginRepoFullName,
} from './lib/execution-plan-utils.mjs';

const root = process.cwd();
const writeMode = process.argv.includes('--write');
const jsonMode = process.argv.includes('--json');

function normalizeIssueState(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function findExecutionPlanLifecycleFindings({
  activePlanPaths,
  completedPlanPaths,
  issueStatesByNumber,
}) {
  const findings = [];
  const completedPlanPathSet = new Set(
    completedPlanPaths.map((relativePath) => normalizeExecutionPlanPath(relativePath)),
  );

  for (const activePlanPath of activePlanPaths) {
    const normalizedPath = normalizeExecutionPlanPath(activePlanPath);

    if (isExecutionPlanReadmePath(normalizedPath)) {
      continue;
    }

    const issueNumber = extractIssueNumberFromExecutionPlanPath(normalizedPath);
    if (!issueNumber) {
      findings.push({ code: 'invalid-plan-path', path: normalizedPath });
      continue;
    }

    const issueState = normalizeIssueState(issueStatesByNumber.get(issueNumber));

    if (!issueState) {
      findings.push({ code: 'unresolved-issue-state', path: normalizedPath, issueNumber });
      continue;
    }

    if (issueState === 'MISSING') {
      findings.push({ code: 'missing-issue', path: normalizedPath, issueNumber });
      continue;
    }

    if (issueState !== 'CLOSED') {
      continue;
    }

    const completedPlanPath = createCompletedExecutionPlanPath(normalizedPath);
    if (!completedPlanPath) {
      findings.push({ code: 'invalid-plan-path', path: normalizedPath });
      continue;
    }

    if (completedPlanPathSet.has(completedPlanPath)) {
      findings.push({
        code: 'completed-path-conflict',
        path: normalizedPath,
        issueNumber,
        nextPath: completedPlanPath,
      });
      continue;
    }

    findings.push({
      code: 'closed-issue-active-plan',
      path: normalizedPath,
      issueNumber,
      nextPath: completedPlanPath,
    });
  }

  return findings.sort((left, right) =>
    `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`, undefined, { numeric: true }),
  );
}

export function buildLifecycleJsonReport({
  repoFullName,
  writeMode,
  findings,
  movedPlans = [],
}) {
  return {
    repo: repoFullName,
    write_mode: writeMode,
    findings,
    movedPlans,
  };
}

export function filterResolvedWriteFindings(findings, movedPlans = []) {
  if (movedPlans.length === 0) {
    return findings;
  }

  const movedPlanPaths = new Set(movedPlans.map((movedPlan) => normalizeExecutionPlanPath(movedPlan.path)));

  return findings.filter((finding) => {
    if (finding.code !== 'closed-issue-active-plan') {
      return true;
    }

    return !movedPlanPaths.has(normalizeExecutionPlanPath(finding.path));
  });
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

function isMissingIssueStatus(status) {
  return status === 404 || status === 410;
}

async function resolveIssueStatesWithToken(repoFullName, issueNumbers, token) {
  const issueStatesByNumber = new Map();

  for (const issueNumber of issueNumbers) {
    try {
      const payload = await fetchJson(
        `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}`,
        token,
      );
      issueStatesByNumber.set(
        issueNumber,
        payload?.pull_request ? 'MISSING' : String(payload?.state ?? '').toUpperCase(),
      );
    } catch (error) {
      const status = Number.parseInt(String(error.message).match(/\((\d+)\)/)?.[1] ?? '', 10);
      if (isMissingIssueStatus(status)) {
        issueStatesByNumber.set(issueNumber, 'MISSING');
        continue;
      }
      throw error;
    }
  }

  return issueStatesByNumber;
}

function resolveIssueStatesWithGh(repoFullName, issueNumbers) {
  const issueStatesByNumber = new Map();

  for (const issueNumber of issueNumbers) {
    try {
      const payload = childProcess.execFileSync('gh', ['api', `repos/${repoFullName}/issues/${issueNumber}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const parsedPayload = JSON.parse(payload);
      issueStatesByNumber.set(
        issueNumber,
        parsedPayload?.pull_request ? 'MISSING' : String(parsedPayload?.state ?? '').toUpperCase(),
      );
    } catch (error) {
      const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : '';
      if (/404|not found/i.test(stderr)) {
        issueStatesByNumber.set(issueNumber, 'MISSING');
        continue;
      }

      throw new Error(
        `unable to resolve issue #${issueNumber} for ${repoFullName} via gh; set GITHUB_TOKEN or authenticate gh`,
      );
    }
  }

  return issueStatesByNumber;
}

async function resolveIssueStates(repoFullName, issueNumbers) {
  if (issueNumbers.length === 0) {
    return new Map();
  }

  if (process.env.GITHUB_TOKEN) {
    return resolveIssueStatesWithToken(repoFullName, issueNumbers, process.env.GITHUB_TOKEN);
  }

  return resolveIssueStatesWithGh(repoFullName, issueNumbers);
}

function printFindings(findings) {
  console.log(`[check-execution-plan-lifecycle] ${findings.length} finding(s)`);

  for (const finding of findings) {
    if (finding.code === 'closed-issue-active-plan') {
      console.log(`- ${finding.path} still lives in active/, but issue #${finding.issueNumber} is closed; move it to ${finding.nextPath} or run make plan-sync`);
      continue;
    }

    if (finding.code === 'completed-path-conflict') {
      console.log(`- ${finding.path} references closed issue #${finding.issueNumber}, but ${finding.nextPath} already exists; resolve the duplicate manually`);
      continue;
    }

    if (finding.code === 'missing-issue') {
      console.log(`- ${finding.path} does not map to a live same-repo issue #${finding.issueNumber}; rename it or fix the linked issue`);
      continue;
    }

    if (finding.code === 'unresolved-issue-state') {
      console.log(`- ${finding.path} could not resolve the state for issue #${finding.issueNumber}; retry with GITHUB_TOKEN or authenticated gh`);
      continue;
    }

    console.log(`- ${finding.path} is not using the required issue-numbered filename format under ${ACTIVE_EXECUTION_PLANS_DIR}/`);
  }
}

async function runCli() {
  const activePlanPaths = listExecutionPlanPaths(root, ACTIVE_EXECUTION_PLANS_DIR);
  const completedPlanPaths = listExecutionPlanPaths(root, COMPLETED_EXECUTION_PLANS_DIR);
  const issueNumbers = [...new Set(activePlanPaths.map(extractIssueNumberFromExecutionPlanPath).filter(Boolean))];
  const repoFullName = readOriginRepoFullName(root);
  const issueStatesByNumber = await resolveIssueStates(repoFullName, issueNumbers);
  const findings = findExecutionPlanLifecycleFindings({
    activePlanPaths,
    completedPlanPaths,
    issueStatesByNumber,
  });
  const movedPlans = [];

  if (writeMode) {
    for (const finding of findings) {
      if (finding.code !== 'closed-issue-active-plan') {
        continue;
      }

      const nextPath = moveExecutionPlanToCompleted(root, finding.path);
      movedPlans.push({
        path: finding.path,
        nextPath,
        issueNumber: finding.issueNumber,
      });
    }
  }

  const remainingFindings = writeMode ? filterResolvedWriteFindings(findings, movedPlans) : findings;

  if (jsonMode) {
    console.log(
      JSON.stringify(
        buildLifecycleJsonReport({ repoFullName, writeMode, findings: remainingFindings, movedPlans }),
        null,
        2,
      ),
    );
    process.exit(0);
  }

  if (remainingFindings.length === 0) {
    console.log('[check-execution-plan-lifecycle] no findings');

    if (writeMode) {
      for (const movedPlan of movedPlans) {
        console.log(`moved ${movedPlan.path} -> ${movedPlan.nextPath}`);
      }
    }

    process.exit(0);
  }

  printFindings(remainingFindings);

  if (writeMode) {
    for (const movedPlan of movedPlans) {
      console.log(`moved ${movedPlan.path} -> ${movedPlan.nextPath}`);
    }
  }

  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(`[check-execution-plan-lifecycle] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
