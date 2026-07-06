#!/usr/bin/env node
import childProcess from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const suiteFiles = {
  transport: 'test/e2e/aws-smoke/flows.test.mjs',
  worker: 'test/e2e/aws-smoke/worker.test.mjs',
  routing: 'test/e2e/aws-smoke/routing.test.mjs',
  discovery: 'test/e2e/aws-smoke/discovery.test.mjs',
  'queue-ops': 'test/e2e/aws-smoke/queue-ops.test.mjs',
  redrive: 'test/e2e/aws-smoke/redrive.test.mjs',
};
const defaultRegion = process.env.AWS_REGION ?? 'us-east-1';
const defaultProfileLabel = process.env.AWS_PROFILE ?? '(default provider chain)';
const forbiddenEndpointEnvVars = [
  'MESSAGING_RUNTIME_LOCALSTACK_ENDPOINT',
  'AWS_ENDPOINT_URL',
  'AWS_ENDPOINT_URL_SQS',
  'AWS_ENDPOINT_URL_SNS',
];

function run(command, args, options = {}) {
  childProcess.execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit', ...options });
}

function createRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
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
    throw new Error('At least one live AWS smoke suite must be selected.');
  }

  const unknownSuites = suites.filter((suite) => !(suite in suiteFiles));
  if (unknownSuites.length > 0) {
    throw new Error(`Unknown live AWS smoke suite(s): ${unknownSuites.join(', ')}.`);
  }

  return suites;
}

function assertLiveAwsEnvironment() {
  for (const envVar of forbiddenEndpointEnvVars) {
    if (process.env[envVar]) {
      throw new Error(
        `Live AWS smoke rejected because ${envVar} is set. Clear LocalStack or custom AWS endpoint overrides first.`,
      );
    }
  }

  if (
    process.env.AWS_ACCESS_KEY_ID === 'test' ||
    process.env.AWS_SECRET_ACCESS_KEY === 'test' ||
    process.env.AWS_SESSION_TOKEN === 'test'
  ) {
    throw new Error('Live AWS smoke rejected because the current shell is still using test credentials.');
  }
}

async function verifyAwsIdentity() {
  const client = new STSClient({ region: defaultRegion });

  try {
    const response = await client.send(new GetCallerIdentityCommand({}));
    if (typeof response.Account !== 'string' || response.Account.length !== 12) {
      throw new Error('STS returned no AWS account ID.');
    }
    return response;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Unable to validate live AWS credentials for profile ${defaultProfileLabel} in region ${defaultRegion}.`,
        'If you are using AWS SSO, run `aws sso login --profile "$AWS_PROFILE"` first.',
        `Underlying error: ${detail}`,
      ].join(' '),
    );
  } finally {
    client.destroy();
  }
}

async function main() {
  const suites = parseSuites(process.argv.slice(2));
  const ciMode = process.argv.includes('--ci');
  const runId = process.env.MESSAGING_RUNTIME_AWS_SMOKE_RUN_ID ?? createRunId();
  process.env.MESSAGING_RUNTIME_AWS_SMOKE_RUN_ID = runId;
  process.env.AWS_REGION = defaultRegion;

  assertLiveAwsEnvironment();

  console.log(`[messaging-runtime aws-smoke] suites: ${suites.join(', ')}`);
  console.log(`[messaging-runtime aws-smoke] run id: ${runId}`);
  console.log(`[messaging-runtime aws-smoke] profile: ${defaultProfileLabel}`);
  console.log(`[messaging-runtime aws-smoke] region: ${defaultRegion}`);

  console.log('[messaging-runtime aws-smoke] building package');
  run('npm', ['run', 'build']);

  console.log('[messaging-runtime aws-smoke] verifying AWS identity');
  const identity = await verifyAwsIdentity();
  console.log(`[messaging-runtime aws-smoke] account: ${identity.Account}`);
  if (identity.Arn) {
    console.log(`[messaging-runtime aws-smoke] caller ARN: ${identity.Arn}`);
  }

  console.log('[messaging-runtime aws-smoke] running live AWS smoke suites');
  run('node', ['--test', '--test-concurrency=1', ...suites.map((suite) => suiteFiles[suite])], {
    env: { ...process.env, MESSAGING_RUNTIME_AWS_SMOKE_CI: ciMode ? '1' : '0' },
  });
}

main().catch((error) => {
  console.error(`[messaging-runtime aws-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
