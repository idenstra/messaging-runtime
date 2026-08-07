import type { Message as SqsSdkMessage } from '@aws-sdk/client-sqs';
import { dispatchBufferedMessages } from './buffered-dispatch';
import { getFiniteRunDemandCap } from './finite-run';
import { startMessageTask } from './handler-runner';
import type { RouteRuntime } from './runtime-state';
import {
  SqsRuntimeClient,
  SqsWorkerLogger,
  type SqsWorkerMessage,
  SqsWorkerMessageFinalizationReason,
  SqsWorkerRouteStatus,
  SqsWorkerRuntimeEvent,
} from './types';
import { clearTimer, sleep } from './utils';

export interface WorkerProcessingDependencies {
  client: SqsRuntimeClient;
  logger: SqsWorkerLogger;
  emitRuntimeEvent(status: SqsWorkerRouteStatus, event: SqsWorkerRuntimeEvent): void;
  emitInfrastructureRuntimeEvent(status: SqsWorkerRouteStatus, event: SqsWorkerRuntimeEvent): void;
  recordInfrastructureError(status: SqsWorkerRouteStatus, error: unknown): void;
  startMessageTask<TPayload>(runtime: RouteRuntime<TPayload>, rawMessage: SqsSdkMessage): void;
  queueDelete<TPayload>(
    runtime: RouteRuntime<TPayload>,
    message: SqsWorkerMessage,
    reason: SqsWorkerMessageFinalizationReason,
  ): Promise<void>;
  signalRouteActivity<TPayload>(runtime: RouteRuntime<TPayload>): void;
}

export function calculateRouteDemand<TPayload>(runtime: RouteRuntime<TPayload>): number {
  const prefetchLimit = Math.min(runtime.route.config.concurrency, runtime.route.config.maxMessagesPerPoll);
  const demand = Math.max(
    0,
    runtime.route.config.concurrency + prefetchLimit - (runtime.status.inFlight + runtime.buffer.length),
  );
  const finiteRunCap = getFiniteRunDemandCap(runtime);
  return finiteRunCap === undefined ? demand : Math.min(demand, finiteRunCap);
}

export { dispatchBufferedMessages, startMessageTask };

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
