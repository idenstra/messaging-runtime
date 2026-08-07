import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { relativeUnix, walkFiles } from './fs-utils.mjs';

export const ACTIVE_EXECUTION_PLANS_DIR = 'docs/exec-plans/active';
export const COMPLETED_EXECUTION_PLANS_DIR = 'docs/exec-plans/completed';

const issueNumberedExecutionPlanPattern = /^docs\/exec-plans\/(?:active|completed)\/(\d+)-[^/]+\.md$/;

export function normalizeExecutionPlanPath(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/^`+/, '').replace(/`+$/, '').replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isExplicitNoExecutionPlan(value) {
  const normalizedValue = normalizeExecutionPlanPath(value).toLowerCase();
  return normalizedValue === 'n/a' || normalizedValue === 'none';
}

export function isExecutionPlanReadmePath(relativePath) {
  return path.posix.basename(normalizeExecutionPlanPath(relativePath)) === 'README.md';
}

export function isActiveExecutionPlanPath(relativePath) {
  return /^docs\/exec-plans\/active\/\d+-[^/]+\.md$/.test(normalizeExecutionPlanPath(relativePath));
}

export function isCompletedExecutionPlanPath(relativePath) {
  return /^docs\/exec-plans\/completed\/\d+-[^/]+\.md$/.test(normalizeExecutionPlanPath(relativePath));
}

export function extractIssueNumberFromExecutionPlanPath(relativePath) {
  const match = normalizeExecutionPlanPath(relativePath).match(issueNumberedExecutionPlanPattern);

  if (!match?.[1]) {
    return null;
  }

  const issueNumber = Number.parseInt(match[1], 10);
  return Number.isInteger(issueNumber) ? issueNumber : null;
}

export function createCompletedExecutionPlanPath(activePlanPath) {
  const normalizedPath = normalizeExecutionPlanPath(activePlanPath);

  if (!normalizedPath.startsWith(`${ACTIVE_EXECUTION_PLANS_DIR}/`)) {
    return null;
  }

  return normalizedPath.replace(`${ACTIVE_EXECUTION_PLANS_DIR}/`, `${COMPLETED_EXECUTION_PLANS_DIR}/`);
}

export function listExecutionPlanPaths(repoRoot, relativeDir) {
  const directoryPath = path.join(repoRoot, relativeDir);
  return walkFiles(directoryPath, (filePath) => filePath.endsWith('.md')).map((filePath) =>
    relativeUnix(repoRoot, filePath),
  );
}

export function moveExecutionPlanToCompleted(repoRoot, activePlanPath) {
  const normalizedActivePath = normalizeExecutionPlanPath(activePlanPath);
  const completedPlanPath = createCompletedExecutionPlanPath(normalizedActivePath);

  if (!completedPlanPath) {
    throw new Error(`not an active execution plan path: ${normalizedActivePath}`);
  }

  const sourcePath = path.join(repoRoot, normalizedActivePath);
  const targetPath = path.join(repoRoot, completedPlanPath);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`active execution plan does not exist: ${normalizedActivePath}`);
  }

  if (fs.existsSync(targetPath)) {
    throw new Error(`completed execution plan already exists: ${completedPlanPath}`);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.renameSync(sourcePath, targetPath);

  return completedPlanPath;
}

export function parseRepoFullNameFromRemoteUrl(remoteUrl) {
  const normalizedRemoteUrl = remoteUrl.trim();
  const match = normalizedRemoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1] ?? null;
}

export function readOriginRepoFullName(repoRoot) {
  const remoteUrl = childProcess.execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const repoFullName = parseRepoFullNameFromRemoteUrl(remoteUrl);

  if (!repoFullName) {
    throw new Error(`unable to determine GitHub repo from origin remote: ${remoteUrl.trim()}`);
  }

  return repoFullName;
}
