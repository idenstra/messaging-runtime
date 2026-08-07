import net from 'node:net';
import path from 'node:path';
import {
  assertDockerAvailable,
  composeArgs,
  createRunId,
  repoRoot,
  run,
  runCapture,
  sleep,
} from '../shared/common.mjs';
import { localstackComposeFile, localstackEndpoint, waitForLocalstack } from '../shared/localstack.mjs';

export { assertDockerAvailable, createRunId, localstackEndpoint, repoRoot, run, runCapture, sleep, waitForLocalstack };

export const observabilityComposeFile = path.join(repoRoot, 'scripts/e2e/observability/compose.yaml');
export const observabilityProjectName =
  process.env.MESSAGING_RUNTIME_OBSERVABILITY_COMPOSE_PROJECT_NAME ?? 'messaging-runtime-observability';
export const localstackProjectName =
  process.env.MESSAGING_RUNTIME_OBSERVABILITY_LOCALSTACK_PROJECT_NAME ?? 'messaging-runtime-observability-localstack';
export const signozUiPort = Number.parseInt(process.env.MESSAGING_RUNTIME_SIGNOZ_UI_PORT ?? '18080', 10);
export const signozOtlpGrpcPort = Number.parseInt(process.env.MESSAGING_RUNTIME_SIGNOZ_OTLP_GRPC_PORT ?? '14317', 10);
export const signozOtlpHttpPort = Number.parseInt(process.env.MESSAGING_RUNTIME_SIGNOZ_OTLP_HTTP_PORT ?? '14318', 10);
export const clickhouseServiceName =
  process.env.MESSAGING_RUNTIME_SIGNOZ_CLICKHOUSE_SERVICE ?? 'signoz-telemetrystore-clickhouse-0-0';

export function observabilityComposeArgs(...args) {
  return composeArgs({ projectName: observabilityProjectName, composeFile: observabilityComposeFile }, ...args);
}

export function localstackComposeArgs(...args) {
  return composeArgs({ projectName: localstackProjectName, composeFile: localstackComposeFile }, ...args);
}

export async function waitForSignozUi(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${signozUiPort}/api/v1/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(2_000);
  }

  throw new Error(
    `SigNoz UI did not become healthy within ${timeoutMs}ms on port ${signozUiPort}.${lastError ? ` Last error: ${String(lastError)}` : ''}`,
  );
}

export async function waitForTcpPort(port, { host = '127.0.0.1', timeoutMs = 90_000, label = `tcp:${port}` } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const remainingMs = Math.max(250, Math.min(5_000, deadline - Date.now()));
        const socket = net.createConnection({ host, port });
        socket.setTimeout(remainingMs);
        socket.once('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.once('timeout', () => {
          socket.destroy();
          reject(new Error(`${label} connection attempt timed out after ${remainingMs}ms`));
        });
        socket.once('error', (error) => {
          socket.destroy();
          reject(error);
        });
      });
      return;
    } catch (error) {
      lastError = error;
    }

    await sleep(1_000);
  }

  throw new Error(
    `${label} did not become reachable within ${timeoutMs}ms.${lastError ? ` Last error: ${String(lastError)}` : ''}`,
  );
}

export async function waitForClickhouseWritable(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = 'unknown';

  while (Date.now() < deadline) {
    try {
      lastValue = clickhouseQuery(
        "SELECT count() FROM system.replicas WHERE database LIKE 'signoz_%' AND is_readonly = 1",
      ).replaceAll('\r', '');
      if (lastValue === '0') {
        return;
      }
    } catch (error) {
      lastValue = error instanceof Error ? error.message : String(error);
    }

    await sleep(2_000);
  }

  throw new Error(`SigNoz ClickHouse backend never became writable. Last observed value: ${lastValue}`);
}

export function clickhouseQuery(query) {
  return runCapture('docker', [
    ...observabilityComposeArgs('exec', '-T', clickhouseServiceName, 'clickhouse-client', '--query', query),
  ]);
}
