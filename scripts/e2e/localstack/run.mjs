#!/usr/bin/env node
import { assertDockerAvailable, composeArgs, createRunId, parseNamedSuites, repoRoot, run } from '../shared/common.mjs';
import { localstackComposeFile, localstackEndpoint, waitForLocalstack } from '../shared/localstack.mjs';

const suiteFiles = {
  runtime: 'test/e2e/localstack/runtime.test.mjs',
  publishers: 'test/e2e/localstack/publishers.test.mjs',
  routing: 'test/e2e/localstack/routing.test.mjs',
  discovery: 'test/e2e/localstack/discovery.test.mjs',
  'queue-ops': 'test/e2e/localstack/queue-ops.test.mjs',
};
const localstackProjectName = 'messaging-runtime-localstack';
const localstackCompose = (...args) =>
  composeArgs({ projectName: localstackProjectName, composeFile: localstackComposeFile }, ...args);

async function main() {
  const suites = parseNamedSuites(process.argv.slice(2), suiteFiles, {
    emptyMessage: 'At least one LocalStack E2E suite must be selected.',
    unknownMessagePrefix: 'Unknown LocalStack E2E suite(s)',
  });
  const ciMode = process.argv.includes('--ci');
  const runId = process.env.MESSAGING_RUNTIME_LOCALSTACK_RUN_ID ?? createRunId();

  console.log(`[messaging-runtime localstack] suites: ${suites.join(', ')}`);
  console.log(`[messaging-runtime localstack] run id: ${runId}`);

  assertDockerAvailable({ label: 'LocalStack E2E' });

  console.log('[messaging-runtime localstack] building package');
  run('npm', ['run', 'build']);

  console.log('[messaging-runtime localstack] starting LocalStack');
  run('docker', localstackCompose('up', '-d'));

  try {
    console.log('[messaging-runtime localstack] waiting for LocalStack health');
    await waitForLocalstack(localstackEndpoint, 90_000);

    console.log('[messaging-runtime localstack] running E2E suites');
    run('node', ['--test', '--test-concurrency=1', ...suites.map((suite) => suiteFiles[suite])], {
      cwd: repoRoot,
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
    run('docker', localstackCompose('down', '-v', '--remove-orphans'));
  }
}

main().catch((error) => {
  console.error(`[messaging-runtime localstack] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
