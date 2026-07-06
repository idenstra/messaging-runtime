import childProcess from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function run(command, args, options = {}) {
  childProcess.execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit', ...options });
}

export function runCapture(command, args, options = {}) {
  return childProcess
    .execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
    .trim();
}

export function assertDockerAvailable({ label = 'E2E' } = {}) {
  try {
    runCapture('docker', ['version', '--format', '{{.Server.Version}}']);
  } catch {
    throw new Error(`Docker is required for ${label}, but \`docker version\` failed.`);
  }

  try {
    runCapture('docker', ['compose', 'version']);
  } catch {
    throw new Error(`Docker Compose is required for ${label}, but \`docker compose version\` failed.`);
  }
}

export function parseNamedSuites(argv, suiteFiles, { emptyMessage, unknownMessagePrefix } = {}) {
  const suiteIndex = argv.indexOf('--suite');
  if (suiteIndex === -1) {
    return Object.keys(suiteFiles);
  }

  const rawSuites = argv[suiteIndex + 1];
  if (!rawSuites) {
    throw new Error('--suite requires a comma-separated value.');
  }

  const suites = rawSuites
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (suites.length === 0) {
    throw new Error(emptyMessage ?? 'At least one suite must be selected.');
  }

  const unknownSuites = suites.filter((suite) => !(suite in suiteFiles));
  if (unknownSuites.length > 0) {
    throw new Error(`${unknownMessagePrefix ?? 'Unknown suite(s)'}: ${unknownSuites.join(', ')}.`);
  }

  return suites;
}

export function composeArgs({ projectName, composeFile }, ...args) {
  return ['compose', '--project-name', projectName, '-f', composeFile, ...args];
}

export function createRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
