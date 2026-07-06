import path from 'node:path';
import { repoRoot, sleep } from './common.mjs';

export const localstackComposeFile = path.join(repoRoot, 'scripts/e2e/localstack/compose.yaml');
export const localstackEndpoint = process.env.MESSAGING_RUNTIME_LOCALSTACK_ENDPOINT ?? 'http://127.0.0.1:4566';

export async function waitForLocalstack(endpoint = localstackEndpoint, timeoutMs = 90_000) {
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

    await sleep(1_000);
  }

  throw new Error(
    `LocalStack did not become healthy within ${timeoutMs}ms.${lastError ? ` Last error: ${String(lastError)}` : ''}`,
  );
}

function isReadyServiceStatus(status) {
  return status === 'available' || status === 'running';
}
