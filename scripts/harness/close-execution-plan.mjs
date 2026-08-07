#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  ACTIVE_EXECUTION_PLANS_DIR,
  extractIssueNumberFromExecutionPlanPath,
  isExecutionPlanReadmePath,
  listExecutionPlanPaths,
  moveExecutionPlanToCompleted,
} from './lib/execution-plan-utils.mjs';

const root = process.cwd();

function parseIssueNumber(rawValue) {
  const issueNumber = Number.parseInt(String(rawValue ?? '').trim(), 10);
  return Number.isInteger(issueNumber) && issueNumber > 0 ? issueNumber : null;
}

export function findCloseableExecutionPlan(activePlanPaths, issueNumber) {
  const matchingPlanPaths = activePlanPaths.filter((relativePath) => {
    if (isExecutionPlanReadmePath(relativePath)) {
      return false;
    }

    return extractIssueNumberFromExecutionPlanPath(relativePath) === issueNumber;
  });

  if (matchingPlanPaths.length === 0) {
    throw new Error(`no active execution plan found for issue #${issueNumber} under ${ACTIVE_EXECUTION_PLANS_DIR}/`);
  }

  if (matchingPlanPaths.length > 1) {
    throw new Error(
      `multiple active execution plans match issue #${issueNumber}; resolve the duplicate manually: ${matchingPlanPaths.join(', ')}`,
    );
  }

  return matchingPlanPaths[0];
}

export function closeExecutionPlanForIssue(repoRoot, issueNumber) {
  const activePlanPaths = listExecutionPlanPaths(repoRoot, ACTIVE_EXECUTION_PLANS_DIR);
  const activePlanPath = findCloseableExecutionPlan(activePlanPaths, issueNumber);
  const completedPlanPath = moveExecutionPlanToCompleted(repoRoot, activePlanPath);
  return { issueNumber, path: activePlanPath, nextPath: completedPlanPath };
}

async function runCli() {
  const issueFlagIndex = process.argv.indexOf('--issue');
  const rawIssueValue = issueFlagIndex >= 0 ? process.argv[issueFlagIndex + 1] : process.env.ISSUE;
  const issueNumber = parseIssueNumber(rawIssueValue);

  if (!issueNumber) {
    console.error('[close-execution-plan] provide a numeric issue via `--issue <number>` or `ISSUE=<number>`');
    process.exit(1);
  }

  const movedPlan = closeExecutionPlanForIssue(root, issueNumber);
  console.log(`[close-execution-plan] moved ${movedPlan.path} -> ${movedPlan.nextPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(`[close-execution-plan] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
