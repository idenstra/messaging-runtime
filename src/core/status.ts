import type { DeleteMessageBatchCommandOutput } from '@aws-sdk/client-sqs';
import type {
  SqsWorkerFailureKind,
  SqsWorkerRouteCounters,
  SqsWorkerRouteStatus,
  SqsWorkerRuntimeEvent,
} from './types';
import { describeUnknownError } from './utils';

export function createRouteStatus(name: string, queueUrl: string): SqsWorkerRouteStatus {
  return { name, queueUrl, running: false, stopping: false, inFlight: 0, buffered: 0, counters: createCounters() };
}

export function createCounters(): SqsWorkerRouteCounters {
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

export function addCounters(target: SqsWorkerRouteCounters, source: SqsWorkerRouteCounters): SqsWorkerRouteCounters {
  return {
    receiveEmptyCount: target.receiveEmptyCount + source.receiveEmptyCount,
    messagesReceivedCount: target.messagesReceivedCount + source.messagesReceivedCount,
    handlerStartedCount: target.handlerStartedCount + source.handlerStartedCount,
    handlerSuccessCount: target.handlerSuccessCount + source.handlerSuccessCount,
    handlerFailureCount: target.handlerFailureCount + source.handlerFailureCount,
    handlerTimeoutCount: target.handlerTimeoutCount + source.handlerTimeoutCount,
    lateSettlementCount: target.lateSettlementCount + source.lateSettlementCount,
    messageDeleteCount: target.messageDeleteCount + source.messageDeleteCount,
    messageKeepCount: target.messageKeepCount + source.messageKeepCount,
    heartbeatSuccessCount: target.heartbeatSuccessCount + source.heartbeatSuccessCount,
    heartbeatFailureCount: target.heartbeatFailureCount + source.heartbeatFailureCount,
    pollErrorCount: target.pollErrorCount + source.pollErrorCount,
    deleteBatchFailureCount: target.deleteBatchFailureCount + source.deleteBatchFailureCount,
    messageDeleteFailureCount: target.messageDeleteFailureCount + source.messageDeleteFailureCount,
    preDispatchVisibilityFailureCount:
      target.preDispatchVisibilityFailureCount + source.preDispatchVisibilityFailureCount,
    bufferedMessageDropCount: target.bufferedMessageDropCount + source.bufferedMessageDropCount,
  };
}

export function cloneRouteStatus(status: SqsWorkerRouteStatus): SqsWorkerRouteStatus {
  return { ...status, counters: { ...status.counters } };
}

export function recordFailure(
  status: SqsWorkerRouteStatus,
  kind: SqsWorkerFailureKind,
  error: unknown,
  at: Date,
): void {
  status.lastErrorAt = at;
  status.lastErrorMessage = describeUnknownError(error);
  status.lastFailureKind = kind;
}

export function recordEvent(status: SqsWorkerRouteStatus, event: SqsWorkerRuntimeEvent): void {
  switch (event.type) {
    case 'receive-empty':
      status.counters.receiveEmptyCount += 1;
      status.lastReceiveEmptyAt = event.at;
      return;
    case 'poll-error':
      status.counters.pollErrorCount += 1;
      status.lastPollErrorAt = event.at;
      status.lastPollErrorMessage = event.errorDetail;
      return;
    case 'messages-received':
      status.counters.messagesReceivedCount += event.messageCount;
      status.lastReceiveAt = event.at;
      return;
    case 'handler-start':
      status.counters.handlerStartedCount += 1;
      status.lastStartedAt = event.at;
      return;
    case 'handler-success':
      status.counters.handlerSuccessCount += 1;
      status.lastSuccessAt = event.at;
      return;
    case 'handler-failure':
      status.counters.handlerFailureCount += 1;
      return;
    case 'handler-timeout':
      status.counters.handlerTimeoutCount += 1;
      status.lastTimeoutAt = event.at;
      return;
    case 'late-settlement':
      status.counters.lateSettlementCount += 1;
      status.lastLateSettlementAt = event.at;
      status.lastLateSettlementOutcome = event.outcome;
      return;
    case 'message-delete':
      status.counters.messageDeleteCount += 1;
      status.lastDeleteAt = event.at;
      return;
    case 'delete-batch-failure':
      status.counters.deleteBatchFailureCount += 1;
      status.lastDeleteBatchFailureAt = event.at;
      status.lastDeleteBatchFailureMessage = event.errorDetail;
      return;
    case 'message-delete-failure':
      status.counters.messageDeleteFailureCount += 1;
      status.lastMessageDeleteFailureAt = event.at;
      status.lastMessageDeleteFailureMessage = event.errorDetail;
      return;
    case 'pre-dispatch-visibility-failure':
      status.counters.preDispatchVisibilityFailureCount += 1;
      status.lastPreDispatchVisibilityFailureAt = event.at;
      status.lastPreDispatchVisibilityFailureMessage = event.errorDetail;
      return;
    case 'buffered-message-drop':
      status.counters.bufferedMessageDropCount += 1;
      status.lastBufferedMessageDropAt = event.at;
      status.lastBufferedMessageDropReason = event.dropReason;
      return;
    case 'message-keep':
      status.counters.messageKeepCount += 1;
      status.lastKeepAt = event.at;
      return;
    case 'heartbeat-success':
      status.counters.heartbeatSuccessCount += 1;
      status.lastHeartbeatSuccessAt = event.at;
      return;
    case 'heartbeat-failure':
      status.counters.heartbeatFailureCount += 1;
      status.lastHeartbeatFailureAt = event.at;
      status.lastHeartbeatFailureMessage = describeUnknownError(event.error);
      return;
  }
}

export function recordInfrastructureEvent(status: SqsWorkerRouteStatus, event: SqsWorkerRuntimeEvent): void {
  const errorDetail = getInfrastructureEventErrorDetail(event);
  if (!errorDetail) {
    return;
  }

  status.lastErrorAt = event.at;
  status.lastErrorMessage = errorDetail;
}

export function recordInfrastructureError(status: SqsWorkerRouteStatus, error: unknown): void {
  status.lastErrorAt = new Date();
  status.lastErrorMessage = describeUnknownError(error);
}

export function describeDeleteBatchResponseFailure(
  batchOutput: DeleteMessageBatchCommandOutput | undefined,
  failedIds: string[],
  missingIds: string[],
): string {
  const parts: string[] = [];

  if ((batchOutput?.Failed?.length ?? 0) > 0) {
    const failureDetail = (batchOutput?.Failed ?? []).map((entry) => {
      const label = entry.Id ?? 'unknown';
      const code = entry.Code ? ` code=${entry.Code}` : '';
      const message = entry.Message ? ` message=${entry.Message}` : '';
      return `${label}${code}${message}`;
    });
    parts.push(`AWS reported failed delete batch entries: ${failureDetail.join(', ')}`);
  } else if (failedIds.length > 0) {
    parts.push(`AWS reported delete batch failures for entry ids: ${failedIds.join(', ')}`);
  }

  if (missingIds.length > 0) {
    parts.push(`AWS returned no delete batch result for entry ids: ${missingIds.join(', ')}`);
  }

  return parts.join('; ');
}

function getInfrastructureEventErrorDetail(event: SqsWorkerRuntimeEvent): string | undefined {
  switch (event.type) {
    case 'poll-error':
    case 'delete-batch-failure':
    case 'message-delete-failure':
    case 'pre-dispatch-visibility-failure':
      return event.errorDetail;
    case 'buffered-message-drop':
      return event.errorDetail;
    default:
      return undefined;
  }
}
