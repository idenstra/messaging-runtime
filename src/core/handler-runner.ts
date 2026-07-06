import type { Message as SqsSdkMessage } from '@aws-sdk/client-sqs';
import { recordFiniteRunHandlerStart } from './finite-run';
import { toWorkerMessage } from './message';
import { finishFailure, finishSuccess, observeLateSettlement } from './message-finalization';
import type { WorkerProcessingDependencies } from './processing';
import type { RouteRuntime, SqsWorkerHandlerOutcome } from './runtime-state';
import { recordFailure } from './status';
import {
  SqsWorkerHeartbeatSource,
  SqsWorkerLateSettlementOutcome,
  type SqsWorkerMessage,
  SqsWorkerTimeoutError,
} from './types';
import { clearTimer, describeUnknownError, settlePromise } from './utils';

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
    recordFiniteRunHandlerStart(runtime);
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
