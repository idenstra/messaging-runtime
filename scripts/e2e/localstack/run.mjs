#!/usr/bin/env node
import childProcess from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const composeFile = path.join(repoRoot, 'scripts/e2e/localstack/compose.yaml');
const suiteFiles = {
  runtime: 'test/e2e/localstack/runtime.test.mjs',
  publishers: 'test/e2e/localstack/publishers.test.mjs',
  routing: 'test/e2e/localstack/routing.test.mjs',
  discovery: 'test/e2e/localstack/discovery.test.mjs',
  'queue-ops': 'test/e2e/localstack/queue-ops.test.mjs',
};

function run(command, args, options = {}) {
  childProcess.execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit', ...options });
}

function runCapture(command, args) {
  return childProcess
    .execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .trim();
}

function parseSuites(argv) {
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
    throw new Error('At least one LocalStack E2E suite must be selected.');
  }

  const unknownSuites = suites.filter((suite) => !(suite in suiteFiles));
  if (unknownSuites.length > 0) {
    throw new Error(`Unknown LocalStack E2E suite(s): ${unknownSuites.join(', ')}.`);
  }

  return suites;
}

function assertDockerAvailable() {
  try {
    runCapture('docker', ['version', '--format', '{{.Server.Version}}']);
  } catch {
    throw new Error('Docker is required for LocalStack E2E, but `docker version` failed.');
  }

  try {
    runCapture('docker', ['compose', 'version']);
  } catch {
    throw new Error('Docker Compose is required for LocalStack E2E, but `docker compose version` failed.');
  }
}

async function waitForLocalstack(endpoint, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/_localstack/health`);
      if (response.ok) {
        const body = await response.json();
        const snsStatus = body?.services?.sns;
        const sqsStatus = body?.services?.sqs;
        if (isReadyServiceStatus(snsStatus) && isReadyServiceStatus(sqsStatus)) {
          return;
        }
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `LocalStack did not become healthy within ${timeoutMs}ms.${lastError ? ` Last error: ${String(lastError)}` : ''}`,
  );
}

function isReadyServiceStatus(status) {
  return status === 'available' || status === 'running';
}

function createRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

async function main() {
  const suites = parseSuites(process.argv.slice(2));
  const ciMode = process.argv.includes('--ci');
  const localstackEndpoint = process.env.MESSAGING_RUNTIME_LOCALSTACK_ENDPOINT ?? 'http://127.0.0.1:4566';
  const runId = process.env.MESSAGING_RUNTIME_LOCALSTACK_RUN_ID ?? createRunId();

  console.log(`[messaging-runtime localstack] suites: ${suites.join(', ')}`);
  console.log(`[messaging-runtime localstack] run id: ${runId}`);

  assertDockerAvailable();

  console.log('[messaging-runtime localstack] building package');
  run('npm', ['run', 'build']);

  console.log('[messaging-runtime localstack] starting LocalStack');
  run('docker', ['compose', '-f', composeFile, 'up', '-d']);

  try {
    console.log('[messaging-runtime localstack] waiting for LocalStack health');
    await waitForLocalstack(localstackEndpoint, 90_000);

    console.log('[messaging-runtime localstack] running E2E suites');
    run('node', ['--test', '--test-concurrency=1', ...suites.map((suite) => suiteFiles[suite])], {
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
        AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
        MESSAGING_RUNTIME_LOCALSTACK_ENDPOINT: localstackEndpoint,
        MESSAGING_RUNTIME_LOCALSTACK_RUN_ID: runId,
        MESSAGING_RUNTIME_LOCALSTACK_CI: ciMode ? '1' : '0',
      },
    });
  } finally {
    console.log('[messaging-runtime localstack] stopping LocalStack');
    run('docker', ['compose', '-f', composeFile, 'down', '-v', '--remove-orphans']);
  }
}

main().catch((error) => {
  console.error(`[messaging-runtime localstack] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
