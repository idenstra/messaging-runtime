import childProcess from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const localstackComposeFile = path.join(repoRoot, 'scripts/e2e/localstack/compose.yaml');
export const observabilityComposeFile = path.join(repoRoot, 'scripts/e2e/observability/compose.yaml');
export const observabilityProjectName =
  process.env.MESSAGING_RUNTIME_OBSERVABILITY_COMPOSE_PROJECT_NAME ?? 'messaging-runtime-observability';
export const localstackProjectName =
  process.env.MESSAGING_RUNTIME_OBSERVABILITY_LOCALSTACK_PROJECT_NAME ?? 'messaging-runtime-observability-localstack';
export const signozUiPort = Number.parseInt(process.env.MESSAGING_RUNTIME_SIGNOZ_UI_PORT ?? '18080', 10);
export const signozOtlpGrpcPort = Number.parseInt(process.env.MESSAGING_RUNTIME_SIGNOZ_OTLP_GRPC_PORT ?? '14317', 10);
export const signozOtlpHttpPort = Number.parseInt(process.env.MESSAGING_RUNTIME_SIGNOZ_OTLP_HTTP_PORT ?? '14318', 10);
export const localstackEndpoint = process.env.MESSAGING_RUNTIME_LOCALSTACK_ENDPOINT ?? 'http://127.0.0.1:4566';
export const clickhouseServiceName =
  process.env.MESSAGING_RUNTIME_SIGNOZ_CLICKHOUSE_SERVICE ?? 'signoz-telemetrystore-clickhouse-0-0';

export function run(command, args, options = {}) {
  childProcess.execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit', ...options });
}

export function runCapture(command, args, options = {}) {
  return childProcess
    .execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
    .trim();
}

export function observabilityComposeArgs(...args) {
  return ['compose', '--project-name', observabilityProjectName, '-f', observabilityComposeFile, ...args];
}

export function localstackComposeArgs(...args) {
  return ['compose', '--project-name', localstackProjectName, '-f', localstackComposeFile, ...args];
}

export function assertDockerAvailable() {
  try {
    runCapture('docker', ['version', '--format', '{{.Server.Version}}']);
  } catch {
    throw new Error('Docker is required for observability E2E, but `docker version` failed.');
  }

  try {
    runCapture('docker', ['compose', 'version']);
  } catch {
    throw new Error('Docker Compose is required for observability E2E, but `docker compose version` failed.');
  }
}

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

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isReadyServiceStatus(status) {
  return status === 'available' || status === 'running';
}
