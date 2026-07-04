import type { Message as SqsSdkMessage } from '@aws-sdk/client-sqs';
import { BUFFERED_VISIBILITY_EXTENSION_THRESHOLD_RATIO } from './config';
import { toWorkerMessage } from './message';
import type { BufferedRouteMessage, RouteRuntime, SqsWorkerHandlerOutcome } from './runtime-state';
import { recordFailure } from './status';
import {
  SqsRuntimeClient,
  SqsWorkerAckAction,
  SqsWorkerErrorContext,
  SqsWorkerHeartbeatSource,
  SqsWorkerLateSettlementOutcome,
  SqsWorkerLogger,
  type SqsWorkerMessage,
  SqsWorkerMessageFinalizationReason,
  SqsWorkerRouteStatus,
  SqsWorkerRuntimeEvent,
  SqsWorkerTimeoutError,
  SqsWorkerTimeoutStrategy,
} from './types';
import { clearTimer, describeUnknownError, settlePromise, sleep } from './utils';

export interface WorkerProcessingDependencies {
  client: SqsRuntimeClient;
  logger: SqsWorkerLogger;
  emitRuntimeEvent(status: SqsWorkerRouteStatus, event: SqsWorkerRuntimeEvent): void;
  emitInfrastructureRuntimeEvent(status: SqsWorkerRouteStatus, event: SqsWorkerRuntimeEvent): void;
  recordInfrastructureError(status: SqsWorkerRouteStatus, error: unknown): void;
  queueDelete<TPayload>(
    runtime: RouteRuntime<TPayload>,
    message: SqsWorkerMessage,
    reason: SqsWorkerMessageFinalizationReason,
  ): Promise<void>;
  signalRouteActivity<TPayload>(runtime: RouteRuntime<TPayload>): void;
}

export function calculateRouteDemand<TPayload>(runtime: RouteRuntime<TPayload>): number {
  const prefetchLimit = Math.min(runtime.route.config.concurrency, runtime.route.config.maxMessagesPerPoll);
  return Math.max(
    0,
    runtime.route.config.concurrency + prefetchLimit - (runtime.status.inFlight + runtime.buffer.length),
  );
}

export async function dispatchBufferedMessages<TPayload>(
  runtime: RouteRuntime<TPayload>,
  dependencies: WorkerProcessingDependencies,
): Promise<void> {
  const { route, status } = runtime;

  while (runtime.buffer.length > 0 && status.inFlight < route.config.concurrency) {
    const bufferedMessage = runtime.buffer.shift();
    status.buffered = runtime.buffer.length;
    if (!bufferedMessage) {
      return;
    }

    const ready = await prepareBufferedMessageForDispatch(runtime, bufferedMessage, dependencies);
    if (!ready) {
      continue;
    }

    startMessageTask(runtime, bufferedMessage.rawMessage, dependencies);
  }
}

export function startMessageTask<TPayload>(
  runtime: RouteRuntime<TPayload>,
  rawMessage: SqsSdkMessage,
  dependencies: WorkerProcessingDependencies,
): void {
  const { route, status } = runtime;

  const task = processMessage(runtime, rawMessage, dependencies)
    .catch((error: unknown) => {
      const detail = describeUnknownError(error);
      dependencies.recordInfrastructureError(status, error);
      dependencies.logger.error('SQS worker message processing failed.', {
        routeName: route.name,
        queueUrl: route.queueUrl,
        messageId: rawMessage.MessageId,
        error: detail,
      });
    })
    .finally(() => {
      status.inFlight -= 1;
      runtime.tasks.delete(task);
      dependencies.signalRouteActivity(runtime);
    });

  status.inFlight += 1;
  runtime.tasks.add(task);
}

export async function waitForRouteActivity<TPayload>(
  runtime: RouteRuntime<TPayload>,
  timeoutMs: number,
  observedActivityVersion: number,
): Promise<void> {
  if (runtime.activityVersion !== observedActivityVersion) {
    return;
  }

  if (timeoutMs <= 0) {
    await sleep(0);
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const complete = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer(timer);
      if (runtime.activityWaiter === complete) {
        runtime.activityWaiter = undefined;
      }
      resolve();
    };

    runtime.activityWaiter = complete;
    timer = setTimeout(complete, timeoutMs);
  });
}

async function prepareBufferedMessageForDispatch<TPayload>(
  runtime: RouteRuntime<TPayload>,
  bufferedMessage: BufferedRouteMessage,
  dependencies: WorkerProcessingDependencies,
): Promise<boolean> {
  const { route, status } = runtime;
  const visibilityThresholdMs =
    route.config.visibilityTimeoutSeconds * 1_000 * BUFFERED_VISIBILITY_EXTENSION_THRESHOLD_RATIO;
  if (visibilityThresholdMs <= 0) {
    return true;
  }

  const bufferedAgeMs = Date.now() - bufferedMessage.receivedAtMs;
  if (bufferedAgeMs < visibilityThresholdMs) {
    return true;
  }

  if (!bufferedMessage.rawMessage.ReceiptHandle) {
    const error = new Error('Buffered SQS message is missing a ReceiptHandle before dispatch.');
    const errorDetail = describeUnknownError(error);
    dependencies.emitInfrastructureRuntimeEvent(status, {
      type: 'buffered-message-drop',
      at: new Date(),
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: bufferedMessage.rawMessage.MessageId ?? '__missing-message-id__',
      dropReason: 'missing-receipt-handle',
      bufferedAgeMs,
      error,
      errorDetail,
    });
    dependencies.logger.warn('Dropping buffered SQS message before dispatch because the receipt handle is missing.', {
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: bufferedMessage.rawMessage.MessageId,
    });
    return false;
  }

  try {
    await dependencies.client.changeMessageVisibility({
      QueueUrl: route.queueUrl,
      ReceiptHandle: bufferedMessage.rawMessage.ReceiptHandle,
      VisibilityTimeout: route.config.visibilityTimeoutSeconds,
    });
    return true;
  } catch (error: unknown) {
    const errorDetail = describeUnknownError(error);
    dependencies.emitInfrastructureRuntimeEvent(status, {
      type: 'pre-dispatch-visibility-failure',
      at: new Date(),
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: bufferedMessage.rawMessage.MessageId ?? '__missing-message-id__',
      bufferedAgeMs,
      error,
      errorDetail,
    });
    dependencies.emitInfrastructureRuntimeEvent(status, {
      type: 'buffered-message-drop',
      at: new Date(),
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: bufferedMessage.rawMessage.MessageId ?? '__missing-message-id__',
      dropReason: 'pre-dispatch-visibility-failure',
      bufferedAgeMs,
      error,
      errorDetail,
    });
    dependencies.logger.warn('Dropping buffered SQS message after a pre-dispatch visibility extension failure.', {
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: bufferedMessage.rawMessage.MessageId,
      error: errorDetail,
    });
    return false;
  }
}

async function processMessage<TPayload>(
  runtime: RouteRuntime<TPayload>,
  rawMessage: SqsSdkMessage,
  dependencies: WorkerProcessingDependencies,
): Promise<void> {
  const { route, status } = runtime;
  const message = toWorkerMessage(rawMessage);
  const startedAtMs = Date.now();
  const abortController = new AbortController();
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let heartbeatEnabled = true;
  let heartbeatRunning = false;
  let timeoutObserved = false;

  const emitHeartbeatSuccess = (source: SqsWorkerHeartbeatSource): void => {
    dependencies.emitRuntimeEvent(status, {
      type: 'heartbeat-success',
      at: new Date(),
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: message.messageId,
      source,
    });
  };

  const emitHeartbeatFailure = (source: SqsWorkerHeartbeatSource, error: unknown): void => {
    dependencies.emitRuntimeEvent(status, {
      type: 'heartbeat-failure',
      at: new Date(),
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: message.messageId,
      source,
      error,
    });
  };

  const heartbeat = async (source: SqsWorkerHeartbeatSource = 'manual'): Promise<void> => {
    if (!heartbeatEnabled) {
      const error = new Error('SQS worker heartbeat is no longer available for this message.');
      emitHeartbeatFailure(source, error);
      throw error;
    }

    try {
      await dependencies.client.changeMessageVisibility({
        QueueUrl: route.queueUrl,
        ReceiptHandle: message.receiptHandle,
        VisibilityTimeout: route.config.visibilityTimeoutSeconds,
      });
      emitHeartbeatSuccess(source);
    } catch (error: unknown) {
      emitHeartbeatFailure(source, error);
      throw error;
    }
  };

  const disableHeartbeat = (): void => {
    heartbeatEnabled = false;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  const runHeartbeat = async (): Promise<void> => {
    if (!heartbeatEnabled || heartbeatRunning) {
      return;
    }

    heartbeatRunning = true;
    try {
      await heartbeat('interval');
    } catch (error: unknown) {
      dependencies.logger.warn('SQS worker heartbeat failed.', {
        routeName: route.name,
        queueUrl: route.queueUrl,
        messageId: message.messageId,
        error: describeUnknownError(error),
      });
    } finally {
      heartbeatRunning = false;
    }
  };

  if (route.config.heartbeatIntervalMs > 0) {
    heartbeatTimer = setInterval(() => {
      void runHeartbeat();
    }, route.config.heartbeatIntervalMs);
  }

  try {
    const payload = route.decodePayload?.(message);
    dependencies.emitRuntimeEvent(status, {
      type: 'handler-start',
      at: new Date(),
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: message.messageId,
    });
    const handlerPromise = Promise.resolve().then(() =>
      route.handle({
        routeName: route.name,
        queueUrl: route.queueUrl,
        payload,
        message,
        abortSignal: abortController.signal,
        heartbeat: () => heartbeat('manual'),
      }),
    );

    if (route.config.handlerTimeoutMs === undefined) {
      await handleWithoutTimeout(
        runtime,
        message,
        payload,
        handlerPromise,
        startedAtMs,
        abortController.signal,
        dependencies,
      );
      return;
    }

    const timedOutcome = await awaitWithTimeout(runtime, message, handlerPromise, abortController, () => {
      timeoutObserved = true;
    });

    if (timedOutcome.type === 'resolved') {
      await finishSuccess(runtime, message, timedOutcome.result, startedAtMs, dependencies);
      return;
    }

    if (timedOutcome.type === 'rejected') {
      await finishFailure({
        runtime,
        message,
        payload,
        abortSignal: abortController.signal,
        failureKind: 'handler',
        error: timedOutcome.error,
        durationMs: Date.now() - startedAtMs,
        allowDelete: true,
        dependencies,
      });
      return;
    }

    const timeoutError = timedOutcome.error;
    dependencies.emitRuntimeEvent(status, {
      type: 'handler-timeout',
      at: timedOutcome.timedOutAt,
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: message.messageId,
      durationMs: Date.now() - startedAtMs,
      timeoutStrategy: route.config.timeoutStrategy,
      settlementOutcome: 'pending',
      error: timeoutError,
    });

    if (route.config.timeoutStrategy === 'abandon') {
      disableHeartbeat();
      await finishFailure({
        runtime,
        message,
        payload,
        abortSignal: abortController.signal,
        failureKind: 'timeout',
        error: timeoutError,
        durationMs: Date.now() - startedAtMs,
        allowDelete: false,
        timeoutStrategy: 'abandon',
        settlementOutcome: 'pending',
        dependencies,
      });

      void observeLateSettlement(runtime, message, handlerPromise, startedAtMs, dependencies);
      return;
    }

    const settlement = await settlePromise(handlerPromise);
    const settlementOutcome: SqsWorkerLateSettlementOutcome = settlement.outcome;
    await finishFailure({
      runtime,
      message,
      payload,
      abortSignal: abortController.signal,
      failureKind: 'timeout',
      error: timeoutError,
      durationMs: Date.now() - startedAtMs,
      allowDelete: true,
      timeoutStrategy: 'cooperative',
      settlementOutcome,
      settlementError: settlement.outcome === 'rejected' ? settlement.error : undefined,
      dependencies,
    });
  } catch (error: unknown) {
    await finishFailure({
      runtime,
      message,
      payload: undefined,
      abortSignal: abortController.signal,
      failureKind: 'decode',
      error,
      durationMs: Date.now() - startedAtMs,
      allowDelete: true,
      dependencies,
    });
  } finally {
    if (!timeoutObserved || route.config.timeoutStrategy === 'cooperative') {
      disableHeartbeat();
    }
  }
}

async function handleWithoutTimeout<TPayload>(
  runtime: RouteRuntime<TPayload>,
  message: SqsWorkerMessage,
  payload: TPayload,
  handlerPromise: Promise<SqsWorkerHandlerOutcome>,
  startedAtMs: number,
  abortSignal: AbortSignal,
  dependencies: WorkerProcessingDependencies,
): Promise<void> {
  try {
    const result = await handlerPromise;
    await finishSuccess(runtime, message, result, startedAtMs, dependencies);
  } catch (error: unknown) {
    await finishFailure({
      runtime,
      message,
      payload,
      abortSignal,
      failureKind: 'handler',
      error,
      durationMs: Date.now() - startedAtMs,
      allowDelete: true,
      dependencies,
    });
  }
}

async function awaitWithTimeout<TPayload>(
  runtime: RouteRuntime<TPayload>,
  message: SqsWorkerMessage,
  handlerPromise: Promise<SqsWorkerHandlerOutcome>,
  abortController: AbortController,
  onTimeoutObserved: () => void,
): Promise<
  | { type: 'resolved'; result: SqsWorkerHandlerOutcome }
  | { type: 'rejected'; error: unknown }
  | { type: 'timeout'; error: SqsWorkerTimeoutError; timedOutAt: Date }
> {
  const { route, status } = runtime;
  const timeoutMs = route.config.handlerTimeoutMs;
  if (timeoutMs === undefined) {
    throw new Error('handlerTimeoutMs must be defined when awaiting with timeout.');
  }

  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      handlerPromise.then(
        (result) => ({ type: 'resolved' as const, result }),
        (error) => ({ type: 'rejected' as const, error }),
      ),
      new Promise<{ type: 'timeout'; error: SqsWorkerTimeoutError; timedOutAt: Date }>((resolve) => {
        timeoutHandle = setTimeout(() => {
          onTimeoutObserved();
          const timedOutAt = new Date();
          const timeoutError = new SqsWorkerTimeoutError({
            routeName: route.name,
            messageId: message.messageId,
            timeoutMs,
            timeoutStrategy: route.config.timeoutStrategy,
          });
          recordFailure(status, 'timeout', timeoutError, timedOutAt);
          abortController.abort(timeoutError);
          resolve({ type: 'timeout', error: timeoutError, timedOutAt });
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimer(timeoutHandle);
  }
}

async function finishSuccess<TPayload>(
  runtime: RouteRuntime<TPayload>,
  message: SqsWorkerMessage,
  result: SqsWorkerHandlerOutcome,
  startedAtMs: number,
  dependencies: WorkerProcessingDependencies,
): Promise<void> {
  const { route, status } = runtime;
  const action = result?.action ?? 'delete';

  dependencies.emitRuntimeEvent(status, {
    type: 'handler-success',
    at: new Date(),
    routeName: route.name,
    queueUrl: route.queueUrl,
    messageId: message.messageId,
    durationMs: Date.now() - startedAtMs,
  });

  await applyAction(runtime, message, action, 'success', dependencies);
}

async function finishFailure<TPayload>(params: {
  runtime: RouteRuntime<TPayload>;
  message: SqsWorkerMessage;
  payload?: TPayload;
  abortSignal: AbortSignal;
  failureKind: import('./types').SqsWorkerFailureKind;
  error: unknown;
  durationMs: number;
  allowDelete: boolean;
  timeoutStrategy?: SqsWorkerTimeoutStrategy;
  settlementOutcome?: SqsWorkerLateSettlementOutcome | 'pending';
  settlementError?: unknown;
  dependencies: WorkerProcessingDependencies;
}): Promise<void> {
  const {
    runtime,
    message,
    payload,
    abortSignal,
    failureKind,
    error,
    durationMs,
    allowDelete,
    timeoutStrategy,
    settlementOutcome,
    settlementError,
    dependencies,
  } = params;
  const { route, status } = runtime;

  recordFailure(status, failureKind, error, new Date());
  const action = await resolveFailureAction(
    route,
    {
      routeName: route.name,
      queueUrl: route.queueUrl,
      message,
      payload,
      abortSignal,
      failureKind,
      error,
      durationMs,
      timeoutStrategy,
      settlementOutcome,
      settlementError,
    },
    allowDelete,
    dependencies,
  );

  if (failureKind === 'timeout') {
    await applyAction(runtime, message, action, 'timeout', dependencies);
    return;
  }

  dependencies.emitRuntimeEvent(status, {
    type: 'handler-failure',
    at: new Date(),
    routeName: route.name,
    queueUrl: route.queueUrl,
    messageId: message.messageId,
    failureKind,
    durationMs,
    action,
    error,
  });

  await applyAction(runtime, message, action, 'failure', dependencies);
}

async function resolveFailureAction<TPayload>(
  route: RouteRuntime<TPayload>['route'],
  context: SqsWorkerErrorContext<TPayload>,
  allowDelete: boolean,
  dependencies: WorkerProcessingDependencies,
): Promise<SqsWorkerAckAction> {
  let action = route.config.failureAction;

  if (route.onError) {
    try {
      const override = await route.onError(context);
      if (override === 'delete' || override === 'keep') {
        action = override;
      } else if (override !== undefined) {
        dependencies.logger.warn('SQS worker error hook returned an invalid action.', {
          routeName: route.name,
          queueUrl: route.queueUrl,
          returned: String(override),
        });
      }
    } catch (hookError: unknown) {
      dependencies.logger.warn('SQS worker error hook failed; using route default failure action.', {
        routeName: route.name,
        queueUrl: route.queueUrl,
        error: describeUnknownError(hookError),
      });
    }
  }

  if (!allowDelete) {
    return 'keep';
  }

  return action;
}

async function applyAction<TPayload>(
  runtime: RouteRuntime<TPayload>,
  message: SqsWorkerMessage,
  action: SqsWorkerAckAction,
  reason: SqsWorkerMessageFinalizationReason,
  dependencies: WorkerProcessingDependencies,
): Promise<void> {
  const { route, status } = runtime;
  if (action === 'delete') {
    await dependencies.queueDelete(runtime, message, reason);
    return;
  }

  dependencies.emitRuntimeEvent(status, {
    type: 'message-keep',
    at: new Date(),
    routeName: route.name,
    queueUrl: route.queueUrl,
    messageId: message.messageId,
    reason,
  });
}

async function observeLateSettlement<TPayload>(
  runtime: RouteRuntime<TPayload>,
  message: SqsWorkerMessage,
  handlerPromise: Promise<SqsWorkerHandlerOutcome>,
  startedAtMs: number,
  dependencies: WorkerProcessingDependencies,
): Promise<void> {
  const { route, status } = runtime;
  const settled = await settlePromise(handlerPromise);
  const event =
    settled.outcome === 'resolved'
      ? {
          type: 'late-settlement' as const,
          at: new Date(),
          routeName: route.name,
          queueUrl: route.queueUrl,
          messageId: message.messageId,
          durationMs: Date.now() - startedAtMs,
          outcome: 'resolved' as const,
        }
      : {
          type: 'late-settlement' as const,
          at: new Date(),
          routeName: route.name,
          queueUrl: route.queueUrl,
          messageId: message.messageId,
          durationMs: Date.now() - startedAtMs,
          outcome: 'rejected' as const,
          error: settled.error,
        };

  dependencies.emitRuntimeEvent(status, event);
  dependencies.logger.warn('SQS worker handler settled after abandon timeout finalization.', {
    routeName: route.name,
    queueUrl: route.queueUrl,
    messageId: message.messageId,
    outcome: event.outcome,
    error: event.outcome === 'rejected' && event.error ? describeUnknownError(event.error) : undefined,
  });
}
