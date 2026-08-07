import {
  ROUTE_ACTIVITY_WAIT_MS,
  WORKER_RECEIVE_MESSAGE_ATTRIBUTE_NAMES,
  WORKER_RECEIVE_MESSAGE_SYSTEM_ATTRIBUTE_NAMES,
} from './config';
import { recordFiniteRunMessagesReceived, recordFiniteRunReceiveEmpty } from './finite-run';
import {
  calculateRouteDemand,
  dispatchBufferedMessages,
  type WorkerProcessingDependencies,
  waitForRouteActivity,
} from './processing';
import { getReceiveRequestAttemptId } from './receive-attempt';
import type { RouteRuntime } from './runtime-state';
import type { SqsRuntimeClient, SqsWorkerLogger, SqsWorkerRouteStatus, SqsWorkerRuntimeEvent } from './types';
import { describeUnknownError, isAbortError, sleep } from './utils';

export interface RouteLoopDependencies {
  client: SqsRuntimeClient;
  logger: SqsWorkerLogger;
  processingDependencies: WorkerProcessingDependencies;
  isStopping(): boolean;
  emitRuntimeEvent(status: SqsWorkerRouteStatus, event: SqsWorkerRuntimeEvent): void;
  emitInfrastructureRuntimeEvent(status: SqsWorkerRouteStatus, event: SqsWorkerRuntimeEvent): void;
  signalRouteActivity<TPayload>(runtime: RouteRuntime<TPayload>): void;
}

export async function runRouteLoop<TPayload>(
  runtime: RouteRuntime<TPayload>,
  dependencies: RouteLoopDependencies,
): Promise<void> {
  const { route, status } = runtime;

  while (true) {
    const activityVersion = runtime.activityVersion;
    await dispatchBufferedMessages(runtime, dependencies.processingDependencies);
    if (dependencies.isStopping()) {
      if (runtime.buffer.length === 0 && status.inFlight === 0) {
        break;
      }
      await waitForRouteActivity(runtime, ROUTE_ACTIVITY_WAIT_MS, activityVersion);
      continue;
    }

    const demand = calculateRouteDemand(runtime);
    if (demand <= 0) {
      await waitForRouteActivity(runtime, ROUTE_ACTIVITY_WAIT_MS, activityVersion);
      continue;
    }

    try {
      const abortController = new AbortController();
      runtime.pollAbortController = abortController;
      const receiveRequestAttemptId = getReceiveRequestAttemptId(runtime);
      const response = await dependencies.client.receiveMessage(
        {
          QueueUrl: route.queueUrl,
          MaxNumberOfMessages: Math.max(1, Math.min(10, demand, route.config.maxMessagesPerPoll)),
          WaitTimeSeconds: route.config.waitTimeSeconds,
          VisibilityTimeout: route.config.visibilityTimeoutSeconds,
          MessageSystemAttributeNames: [...WORKER_RECEIVE_MESSAGE_SYSTEM_ATTRIBUTE_NAMES],
          MessageAttributeNames: [...WORKER_RECEIVE_MESSAGE_ATTRIBUTE_NAMES],
          ...(receiveRequestAttemptId ? { ReceiveRequestAttemptId: receiveRequestAttemptId } : {}),
        },
        { abortSignal: abortController.signal },
      );
      if (runtime.pollAbortController === abortController) {
        runtime.pollAbortController = undefined;
      }
      runtime.pendingReceiveRequestAttempt = undefined;

      const messages = (response.Messages ?? []).slice(0, demand);
      if (messages.length === 0) {
        recordFiniteRunReceiveEmpty(runtime);
        dependencies.emitRuntimeEvent(status, {
          type: 'receive-empty',
          at: new Date(),
          routeName: route.name,
          queueUrl: route.queueUrl,
        });
        await waitForRouteActivity(runtime, route.config.emptyReceiveDelayMs, runtime.activityVersion);
        continue;
      }

      recordFiniteRunMessagesReceived(runtime);
      dependencies.emitRuntimeEvent(status, {
        type: 'messages-received',
        at: new Date(),
        routeName: route.name,
        queueUrl: route.queueUrl,
        messageCount: messages.length,
      });

      const immediateDispatchCount = Math.max(0, Math.min(messages.length, route.config.concurrency - status.inFlight));
      for (const rawMessage of messages.slice(0, immediateDispatchCount)) {
        dependencies.processingDependencies.startMessageTask(runtime, rawMessage);
      }

      const bufferedMessages = messages.slice(immediateDispatchCount);
      if (bufferedMessages.length > 0) {
        const receivedAtMs = Date.now();
        runtime.buffer.push(...bufferedMessages.map((rawMessage) => ({ rawMessage, receivedAtMs })));
        dependencies.signalRouteActivity(runtime);
      }

      status.buffered = runtime.buffer.length;
    } catch (error) {
      runtime.pollAbortController = undefined;
      if (dependencies.isStopping() && isAbortError(error)) {
        continue;
      }
      const detail = describeUnknownError(error);
      dependencies.emitInfrastructureRuntimeEvent(status, {
        type: 'poll-error',
        at: new Date(),
        routeName: route.name,
        queueUrl: route.queueUrl,
        error,
        errorDetail: detail,
        backoffMs: route.config.errorBackoffMs,
      });
      dependencies.logger.error('SQS worker polling failed.', {
        routeName: route.name,
        queueUrl: route.queueUrl,
        error: detail,
      });
      await sleep(route.config.errorBackoffMs);
    }
  }
}
