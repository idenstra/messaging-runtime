import type { SqsWorkerLogger, SqsWorkerReceivePolicy, SqsWorkerReceiveStrategy, SqsWorkerRouteConfig } from './types';

export const DEFAULT_ROUTE_CONFIG: SqsWorkerRouteConfig = {
  concurrency: 4,
  waitTimeSeconds: 20,
  visibilityTimeoutSeconds: 60,
  heartbeatIntervalMs: 20_000,
  emptyReceiveDelayMs: 250,
  errorBackoffMs: 1_000,
  maxMessagesPerPoll: 10,
  timeoutStrategy: 'cooperative',
  failureAction: 'keep',
};

export const DEFAULT_LOGGER: SqsWorkerLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const DEFAULT_RECEIVE_POLICY: SqsWorkerReceivePolicy = { requestAttemptIdMode: 'off' };

export const ROUTE_ACTIVITY_WAIT_MS = 25;
export const DELETE_BATCH_SIZE_LIMIT = 10;
export const DELETE_BATCH_FLUSH_DELAY_MS = 5;
export const BUFFERED_VISIBILITY_EXTENSION_THRESHOLD_RATIO = 0.5;
export const WORKER_RECEIVE_MESSAGE_SYSTEM_ATTRIBUTE_NAMES = ['All'] as const;
export const WORKER_RECEIVE_MESSAGE_ATTRIBUTE_NAMES = ['All'] as const;
export const RECEIVE_REQUEST_ATTEMPT_ID_TTL_MS = 5 * 60 * 1000;

export function validateRoute(
  routeName: string,
  queueUrl: string,
  config: SqsWorkerRouteConfig,
  receive?: SqsWorkerReceiveStrategy,
): void {
  if (!routeName.trim()) {
    throw new Error('SQS worker route name must be a non-empty string.');
  }
  if (!queueUrl.trim()) {
    throw new Error(`SQS worker route ${routeName} must declare a non-empty queueUrl.`);
  }

  validateInteger(routeName, 'concurrency', config.concurrency, 1);
  validateInteger(routeName, 'waitTimeSeconds', config.waitTimeSeconds, 0, 20);
  validateInteger(routeName, 'visibilityTimeoutSeconds', config.visibilityTimeoutSeconds, 0, 43_200);
  validateInteger(routeName, 'heartbeatIntervalMs', config.heartbeatIntervalMs, 0);
  validateInteger(routeName, 'emptyReceiveDelayMs', config.emptyReceiveDelayMs, 0);
  validateInteger(routeName, 'errorBackoffMs', config.errorBackoffMs, 0);
  validateInteger(routeName, 'maxMessagesPerPoll', config.maxMessagesPerPoll, 1, 10);

  if (
    config.handlerTimeoutMs !== undefined &&
    (!Number.isInteger(config.handlerTimeoutMs) || config.handlerTimeoutMs < 1)
  ) {
    throw new Error(`SQS worker route ${routeName} has invalid handlerTimeoutMs; expected an integer >= 1.`);
  }

  if (config.timeoutStrategy !== 'cooperative' && config.timeoutStrategy !== 'abandon') {
    throw new Error(`SQS worker route ${routeName} has invalid timeoutStrategy; expected cooperative or abandon.`);
  }

  if (config.failureAction !== 'delete' && config.failureAction !== 'keep') {
    throw new Error(`SQS worker route ${routeName} has invalid failureAction; expected delete or keep.`);
  }

  validateReceiveStrategy(routeName, queueUrl, receive);
}

export function normalizeReceivePolicy(
  ...patches: Array<Partial<SqsWorkerReceivePolicy> | undefined>
): SqsWorkerReceivePolicy {
  const policy: SqsWorkerReceivePolicy = { ...DEFAULT_RECEIVE_POLICY };

  for (const patch of patches) {
    if (!patch) {
      continue;
    }

    Object.assign(policy, patch);
  }

  return policy;
}

export function validateReceiveRequestAttemptId(routeName: string, value: string): string {
  if (!value.trim()) {
    throw new Error(`SQS worker route ${routeName} produced an empty ReceiveRequestAttemptId.`);
  }

  if (value.length > 128) {
    throw new Error(
      `SQS worker route ${routeName} produced an invalid ReceiveRequestAttemptId; expected length <= 128.`,
    );
  }

  if (!/^[A-Za-z0-9!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]+$/.test(value)) {
    throw new Error(
      `SQS worker route ${routeName} produced an invalid ReceiveRequestAttemptId; expected AWS-supported characters only.`,
    );
  }

  return value;
}

function validateInteger(
  routeName: string,
  field: keyof SqsWorkerRouteConfig,
  value: number,
  min: number,
  max?: number,
): void {
  if (!Number.isInteger(value) || value < min || (max !== undefined && value > max)) {
    const rangeDescription = max === undefined ? `>= ${min}` : `between ${min} and ${max}`;
    throw new Error(`SQS worker route ${routeName} has invalid ${field}; expected an integer ${rangeDescription}.`);
  }
}

function validateReceiveStrategy(routeName: string, queueUrl: string, receive?: SqsWorkerReceiveStrategy): void {
  const policy = normalizeReceivePolicy(receive?.policy);
  const mode = policy.requestAttemptIdMode ?? 'off';

  if (mode !== 'off' && !queueUrl.endsWith('.fifo')) {
    throw new Error(
      `SQS worker route ${routeName} enables ReceiveRequestAttemptId, but queue ${queueUrl} is not a FIFO queue.`,
    );
  }

  if (mode === 'custom' && !receive?.createRequestAttemptId) {
    throw new Error(
      `SQS worker route ${routeName} uses custom ReceiveRequestAttemptId mode but does not declare createRequestAttemptId.`,
    );
  }
}
