import type { WorkerProcessingDependencies } from './processing';
import type { RouteRuntime, SqsWorkerHandlerOutcome } from './runtime-state';
import { recordFailure } from './status';
import type {
  SqsWorkerAckAction,
  SqsWorkerErrorContext,
  SqsWorkerLateSettlementOutcome,
  SqsWorkerMessage,
  SqsWorkerMessageFinalizationReason,
  SqsWorkerTimeoutStrategy,
} from './types';
import { describeUnknownError, settlePromise } from './utils';

export async function finishSuccess<TPayload>(
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

export async function finishFailure<TPayload>(params: {
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

export async function observeLateSettlement<TPayload>(
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
