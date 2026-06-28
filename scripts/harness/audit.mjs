#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const jsonMode = process.argv.includes('--json');

function exists(relativePath, repoRoot = root) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function read(relativePath, repoRoot = root) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function hasText(relativePath, expectedText, repoRoot = root) {
  return exists(relativePath, repoRoot) && read(relativePath, repoRoot).includes(expectedText);
}

function createCheck(id, status, detail, action) {
  return { id, status, detail, action };
}

function categoryStatus(checks) {
  if (checks.some((check) => check.status === 'fail')) {
    return 'fail';
  }

  if (checks.some((check) => check.status === 'warn')) {
    return 'warn';
  }

  return 'pass';
}

function createGovernanceCategory(repoRoot) {
  const pullRequestTemplate = exists('.github/PULL_REQUEST_TEMPLATE.md', repoRoot)
    ? read('.github/PULL_REQUEST_TEMPLATE.md', repoRoot)
    : '';

  const checks = [
    exists('AGENTS.md', repoRoot) &&
    hasText('AGENTS.md', 'WORKFLOW.md', repoRoot) &&
    hasText('AGENTS.md', 'docs/HARNESS.md', repoRoot) &&
    hasText('AGENTS.md', 'docs/QUALITY_BAR.md', repoRoot) &&
    hasText('AGENTS.md', 'docs/AI_ENGINEERING.md', repoRoot) &&
    hasText('AGENTS.md', 'docs/EXECUTION_PLANS.md', repoRoot) &&
    hasText('AGENTS.md', 'docs/ISSUE_TRACKING.md', repoRoot)
      ? createCheck('canonical-doc-links', 'pass', 'AGENTS.md links the harness docs')
      : createCheck('canonical-doc-links', 'fail', 'AGENTS.md is missing one or more harness doc references', 'Refresh AGENTS.md canonical doc links.'),
    exists('WORKFLOW.md', repoRoot) &&
    hasText('WORKFLOW.md', 'verify-fast', repoRoot) &&
    hasText('WORKFLOW.md', 'make verify', repoRoot) &&
    hasText('WORKFLOW.md', 'docs/ISSUE_TRACKING.md', repoRoot)
      ? createCheck('workflow-proof-matrix', 'pass', 'WORKFLOW.md defines verify tiers and proof requirements')
      : createCheck('workflow-proof-matrix', 'fail', 'WORKFLOW.md does not define the expected proof matrix', 'Update WORKFLOW.md with work types and verify tiers.'),
    exists('docs/templates/execution-plan.md', repoRoot) &&
    exists('docs/templates/handoff.md', repoRoot) &&
    hasText('docs/EXECUTION_PLANS.md', 'docs/templates/execution-plan.md', repoRoot) &&
    hasText('docs/EXECUTION_PLANS.md', 'docs/templates/handoff.md', repoRoot)
      ? createCheck('execution-plan-templates', 'pass', 'Execution plan docs point at the default templates')
      : createCheck('execution-plan-templates', 'fail', 'Execution plan templates are missing or not referenced', 'Add the plan and handoff templates and reference them in docs/EXECUTION_PLANS.md.'),
    exists('docs/ISSUE_TRACKING.md', repoRoot) &&
    hasText('docs/ISSUE_TRACKING.md', 'issue -> plan -> PR', repoRoot) &&
    hasText('docs/ISSUE_TRACKING.md', 'Idenstra Backlog', repoRoot)
      ? createCheck('issue-tracking-doc', 'pass', 'Issue tracking doc defines backlog ownership and board usage')
      : createCheck('issue-tracking-doc', 'fail', 'docs/ISSUE_TRACKING.md is missing or incomplete', 'Add the issue-tracking doc and define backlog ownership there.'),
    ['docs/ARCHITECTURE.md', 'docs/SECURITY.md', 'docs/RELIABILITY.md'].every((relativePath) => exists(relativePath, repoRoot))
      ? createCheck('library-docs', 'pass', 'Architecture, security, and reliability docs are present')
      : createCheck('library-docs', 'fail', 'One or more core library docs are missing', 'Add docs/ARCHITECTURE.md, docs/SECURITY.md, and docs/RELIABILITY.md.'),
    ['epic.yml', 'feature.yml', 'task.yml', 'bug.yml', 'improvement.yml', 'debt.yml', 'config.yml'].every((fileName) =>
      exists(`.github/ISSUE_TEMPLATE/${fileName}`, repoRoot),
    ) && exists('.github/PULL_REQUEST_TEMPLATE.md', repoRoot) &&
    pullRequestTemplate.includes('Execution plan:') &&
    pullRequestTemplate.includes('Plan-free exemption:') &&
    pullRequestTemplate.includes('Issue-free exemption:')
      ? createCheck('github-templates', 'pass', 'Issue forms and the PR template are present')
      : createCheck('github-templates', 'fail', 'Issue forms are missing, or the PR template does not include the governance fields', 'Add the issue forms and the governed PR template under .github/.'),
  ];

  return { id: 'governance', status: categoryStatus(checks), checks };
}

function createVerificationCategory(repoRoot) {
  const makefile = exists('Makefile', repoRoot) ? read('Makefile', repoRoot) : '';
  const verifyScript = exists('scripts/harness/verify.sh', repoRoot) ? read('scripts/harness/verify.sh', repoRoot) : '';
  const ciWorkflow = exists('.github/workflows/ci.yml', repoRoot) ? read('.github/workflows/ci.yml', repoRoot) : '';

  const checks = [
    ['audit', 'verify-fast', 'verify', 'plan-sync'].every((target) => makefile.includes(`${target}:`))
      ? createCheck('make-targets', 'pass', 'Makefile exposes the harness targets')
      : createCheck('make-targets', 'fail', 'Makefile is missing one or more harness targets', 'Wire audit, verify-fast, verify, and plan-sync into Makefile.'),
    exists('scripts/harness/verify.sh', repoRoot) &&
    verifyScript.includes('node --test scripts/ci/*.test.mjs scripts/harness/*.test.mjs') &&
    verifyScript.includes('validate-no-personal-paths.mjs') &&
    verifyScript.includes('validate-workflow-security.mjs') &&
    verifyScript.includes('validate-pr-governance.mjs') &&
    verifyScript.includes('validate-backlog-ownership.mjs') &&
    verifyScript.includes('npm ci') &&
    verifyScript.includes('npm test') &&
    verifyScript.includes('npm run build') &&
    verifyScript.includes('audit.mjs')
      ? createCheck('verify-wrapper', 'pass', 'verify.sh runs the expected library checks')
      : createCheck('verify-wrapper', 'fail', 'verify.sh is missing one or more expected checks', 'Update verify.sh to run validators, package checks, and the audit.'),
    exists('scripts/harness/check-execution-plan-lifecycle.mjs', repoRoot) &&
    hasText('docs/EXECUTION_PLANS.md', 'make plan-sync', repoRoot)
      ? createCheck('execution-plan-lifecycle', 'pass', 'Execution plan lifecycle tooling is wired and documented')
      : createCheck('execution-plan-lifecycle', 'fail', 'Execution plan lifecycle tooling is missing or undocumented', 'Add check-execution-plan-lifecycle.mjs, expose make plan-sync, and document the flow.'),
    ciWorkflow.includes('harness-validate:') &&
    ciWorkflow.includes('package-checks:') &&
    ciWorkflow.includes('make audit') &&
    ciWorkflow.includes('make verify-fast')
      ? createCheck('ci-lanes', 'pass', 'CI exposes the expected harness lane split')
      : createCheck('ci-lanes', 'fail', 'CI does not expose the expected harness lane split', 'Reshape .github/workflows/ci.yml into harness-validate and package-checks.'),
  ];

  return { id: 'verification', status: categoryStatus(checks), checks };
}

function createRepoDocsCategory(repoRoot) {
  const checks = [
    exists('docs/HARNESS.md', repoRoot) &&
    hasText('docs/HARNESS.md', 'scripts/README.md', repoRoot) &&
    hasText('docs/HARNESS.md', 'docs/ISSUE_TRACKING.md', repoRoot) &&
    hasText('docs/HARNESS.md', 'docs/EXECUTION_PLANS.md', repoRoot) &&
    hasText('docs/HARNESS.md', 'docs/ARCHITECTURE.md', repoRoot)
      ? createCheck('harness-links', 'pass', 'Harness overview points to the canonical detailed docs')
      : createCheck('harness-links', 'fail', 'docs/HARNESS.md does not link the canonical detailed docs', 'Link scripts/README.md and the canonical docs from docs/HARNESS.md.'),
    exists('README.md', repoRoot) &&
    hasText('README.md', 'WORKFLOW.md', repoRoot) &&
    hasText('README.md', 'docs/HARNESS.md', repoRoot)
      ? createCheck('readme-entrypoints', 'pass', 'README.md points readers to the harness docs')
      : createCheck('readme-entrypoints', 'fail', 'README.md does not point to the harness docs', 'Refresh README.md to reference WORKFLOW.md and docs/HARNESS.md.'),
    exists('docs/ARCHITECTURE.md', repoRoot) &&
    hasText('docs/ARCHITECTURE.md', 'SNS/SQS', repoRoot) &&
    hasText('docs/ARCHITECTURE.md', 'Not owned here', repoRoot)
      ? createCheck('architecture-boundaries', 'pass', 'Architecture doc defines repo ownership boundaries')
      : createCheck('architecture-boundaries', 'fail', 'docs/ARCHITECTURE.md does not define the expected repo boundaries', 'Refresh docs/ARCHITECTURE.md with owned and non-owned surfaces.'),
  ];

  return { id: 'repo-docs', status: categoryStatus(checks), checks };
}

export function buildReport(repoRoot = root) {
  const categories = [
    createGovernanceCategory(repoRoot),
    createVerificationCategory(repoRoot),
    createRepoDocsCategory(repoRoot),
  ];

  const overallStatus = categoryStatus(categories.map((category) => ({ status: category.status })));
  return { repo: 'messaging-runtime', overall_status: overallStatus, categories };
}

function runCli() {
  const report = buildReport();

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  console.log(`[audit] messaging-runtime overall=${report.overall_status}`);
  for (const category of report.categories) {
    console.log(`- ${category.id}: ${category.status}`);
    for (const check of category.checks) {
      console.log(`  - [${check.status}] ${check.id}: ${check.detail}`);
    }
  }

  process.exit(report.overall_status === 'pass' ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

