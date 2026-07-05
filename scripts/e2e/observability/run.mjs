#!/usr/bin/env node
import {
  assertDockerAvailable,
  localstackComposeArgs,
  localstackEndpoint,
  observabilityComposeArgs,
  run,
  signozOtlpGrpcPort,
  signozOtlpHttpPort,
  signozUiPort,
  waitForClickhouseWritable,
  waitForLocalstack,
  waitForSignozUi,
  waitForTcpPort,
} from './shared.mjs';

const suiteFiles = ['test/e2e/observability/flows.test.mjs'];

function createRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

async function main() {
  const ciMode = process.argv.includes('--ci');
  const runId = process.env.MESSAGING_RUNTIME_OBSERVABILITY_RUN_ID ?? createRunId();
  process.env.MESSAGING_RUNTIME_OBSERVABILITY_RUN_ID = runId;
  process.env.MESSAGING_RUNTIME_LOCALSTACK_RUN_ID = process.env.MESSAGING_RUNTIME_LOCALSTACK_RUN_ID ?? runId;
  process.env.MESSAGING_RUNTIME_LOCALSTACK_ENDPOINT = localstackEndpoint;
  process.env.MESSAGING_RUNTIME_SIGNOZ_UI_PORT = String(signozUiPort);
  process.env.MESSAGING_RUNTIME_SIGNOZ_OTLP_GRPC_PORT = String(signozOtlpGrpcPort);
  process.env.MESSAGING_RUNTIME_SIGNOZ_OTLP_HTTP_PORT = String(signozOtlpHttpPort);

  console.log(`[messaging-runtime observability] run id: ${runId}`);

  assertDockerAvailable();

  console.log('[messaging-runtime observability] building package');
  run('npm', ['run', 'build']);

  console.log('[messaging-runtime observability] starting SigNoz stack');
  run('docker', observabilityComposeArgs('up', '-d'));

  console.log('[messaging-runtime observability] starting LocalStack');
  run('docker', localstackComposeArgs('up', '-d'));

  try {
    console.log('[messaging-runtime observability] waiting for SigNoz health');
    await waitForSignozUi();
    await waitForTcpPort(signozOtlpGrpcPort, { label: `otlp-grpc:${signozOtlpGrpcPort}` });
    await waitForTcpPort(signozOtlpHttpPort, { label: `otlp-http:${signozOtlpHttpPort}` });
    await waitForClickhouseWritable();

    console.log('[messaging-runtime observability] waiting for LocalStack health');
    await waitForLocalstack(localstackEndpoint);

    console.log('[messaging-runtime observability] warming up worker metrics and traces');
    const { warmupObservabilityBackend } = await import('./warmup.mjs');
    await warmupObservabilityBackend(runId);

    console.log('[messaging-runtime observability] running observability E2E suites');
    run('node', ['--test', '--test-concurrency=1', ...suiteFiles], {
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
        AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
        MESSAGING_RUNTIME_OBSERVABILITY_CI: ciMode ? '1' : '0',
      },
    });
  } finally {
    console.log('[messaging-runtime observability] stopping LocalStack');
    run('docker', localstackComposeArgs('down', '-v', '--remove-orphans'));

    console.log('[messaging-runtime observability] stopping SigNoz stack');
    run('docker', observabilityComposeArgs('down', '-v', '--remove-orphans'));
  }
}

main().catch((error) => {
  console.error(`[messaging-runtime observability] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
