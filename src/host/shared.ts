import type { SqsWorkerManagerSnapshot, SqsWorkerReceivePolicy, SqsWorkerRouteConfig } from '../core';

const DEFAULT_SIGNALS = ['SIGINT', 'SIGTERM'] as const satisfies readonly NodeJS.Signals[];
const ROUTE_CONFIG_KEYS = new Set<keyof SqsWorkerRouteConfig>([
  'concurrency',
  'waitTimeSeconds',
  'visibilityTimeoutSeconds',
  'heartbeatIntervalMs',
  'emptyReceiveDelayMs',
  'errorBackoffMs',
  'maxMessagesPerPoll',
  'handlerTimeoutMs',
  'timeoutStrategy',
  'failureAction',
]);
const RECEIVE_POLICY_KEYS = new Set<keyof SqsWorkerReceivePolicy>(['requestAttemptIdMode']);

export function normalizeSignals(signals: readonly NodeJS.Signals[] | undefined): NodeJS.Signals[] {
  const configuredSignals = signals ?? DEFAULT_SIGNALS;
  const uniqueSignals = [...new Set(configuredSignals)];

  if (uniqueSignals.length === 0) {
    throw new Error('SQS worker service runner must be configured with at least one stop signal.');
  }

  return uniqueSignals;
}

export function parseJsonRecord(source: string, label: string): Record<string, unknown> {
  try {
    return assertRecord(JSON.parse(source), label);
  } catch (error) {
    throw new Error(`Invalid ${label}.`, { cause: error });
  }
}

export function readOptionalRouteConfigPatch(value: unknown, label: string): Partial<SqsWorkerRouteConfig> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const config = assertRecord(value, label);
  const patch: Partial<SqsWorkerRouteConfig> = {};

  for (const [key, rawValue] of Object.entries(config)) {
    if (!ROUTE_CONFIG_KEYS.has(key as keyof SqsWorkerRouteConfig)) {
      throw new Error(`Invalid ${label} field ${key}.`);
    }

    switch (key) {
      case 'timeoutStrategy':
        if (rawValue !== 'cooperative' && rawValue !== 'abandon') {
          throw new Error(`Invalid ${label} timeoutStrategy; expected cooperative or abandon.`);
        }
        patch.timeoutStrategy = rawValue;
        break;
      case 'failureAction':
        if (rawValue !== 'delete' && rawValue !== 'keep') {
          throw new Error(`Invalid ${label} failureAction; expected delete or keep.`);
        }
        patch.failureAction = rawValue;
        break;
      case 'concurrency':
      case 'waitTimeSeconds':
      case 'visibilityTimeoutSeconds':
      case 'heartbeatIntervalMs':
      case 'emptyReceiveDelayMs':
      case 'errorBackoffMs':
      case 'maxMessagesPerPoll':
      case 'handlerTimeoutMs':
        patch[key] = readInteger(rawValue, `${label} field ${key}`);
        break;
      default:
        throw new Error(`Unhandled ${label} field ${key}.`);
    }
  }

  return patch;
}

export function readOptionalReceivePolicyPatch(
  value: unknown,
  label: string,
): Partial<SqsWorkerReceivePolicy> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const policy = assertRecord(value, label);
  const patch: Partial<SqsWorkerReceivePolicy> = {};

  for (const [key, rawValue] of Object.entries(policy)) {
    if (!RECEIVE_POLICY_KEYS.has(key as keyof SqsWorkerReceivePolicy)) {
      throw new Error(`Invalid ${label} field ${key}.`);
    }

    switch (key) {
      case 'requestAttemptIdMode':
        if (rawValue !== 'off' && rawValue !== 'runtime' && rawValue !== 'custom') {
          throw new Error(`Invalid ${label} requestAttemptIdMode; expected off, runtime, or custom.`);
        }
        patch.requestAttemptIdMode = rawValue;
        break;
      default:
        throw new Error(`Unhandled ${label} field ${key}.`);
    }
  }

  return patch;
}

export function readOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${label}; expected a boolean.`);
  }
  return value;
}

export function readOptionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${label}; expected a non-empty string.`);
  }
  return value.trim();
}

export function assertRouteName(routeName: string): string {
  if (!routeName.trim()) {
    throw new Error('SQS worker service route name must be a non-empty string.');
  }
  return routeName.trim();
}

export function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}; expected an object.`);
  }
  return value as Record<string, unknown>;
}

export function createEmptyCounters(): SqsWorkerManagerSnapshot['counters'] {
  return {
    receiveEmptyCount: 0,
    messagesReceivedCount: 0,
    handlerStartedCount: 0,
    handlerSuccessCount: 0,
    handlerFailureCount: 0,
    handlerTimeoutCount: 0,
    lateSettlementCount: 0,
    messageDeleteCount: 0,
    messageKeepCount: 0,
    heartbeatSuccessCount: 0,
    heartbeatFailureCount: 0,
    pollErrorCount: 0,
    deleteBatchFailureCount: 0,
    messageDeleteFailureCount: 0,
    preDispatchVisibilityFailureCount: 0,
    bufferedMessageDropCount: 0,
  };
}

function readInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid ${label}; expected an integer.`);
  }

  return value as number;
}
