import type { Attributes, ObservableResult, TextMapGetter, TextMapSetter } from '@opentelemetry/api';
import type {
  OpenTelemetrySqsWorkerTracingOptions,
  SqsWorkerHandlerContext,
  SqsWorkerManagerSnapshot,
  SqsWorkerMessage,
  SqsWorkerRuntimeEvent,
} from './types';

export const DEFAULT_METRIC_PREFIX = 'messaging_runtime';
const MESSAGE_ATTRIBUTE_STRING_TYPE = 'String';

export function observeSnapshotMetric(
  _result: ObservableResult,
  getSnapshot: () => SqsWorkerManagerSnapshot,
  onError: ((error: unknown) => void) | undefined,
  observe: (snapshot: SqsWorkerManagerSnapshot) => void,
): void {
  try {
    observe(getSnapshot());
  } catch (error) {
    onError?.(error);
  }
}

export function buildMetricAttributes(
  staticAttributes: Attributes,
  target: { routeName?: string; name?: string; queueUrl: string },
  eventAttributes: Attributes,
): Attributes {
  return {
    ...staticAttributes,
    route_name: target.routeName ?? target.name ?? 'unknown',
    queue_url: target.queueUrl,
    ...eventAttributes,
  };
}

export function getEventSpecificAttributes(event: SqsWorkerRuntimeEvent): Attributes {
  const shared = { event_type: event.type };

  switch (event.type) {
    case 'messages-received':
      return shared;
    case 'handler-failure':
      return { ...shared, failure_kind: event.failureKind, action: event.action };
    case 'handler-timeout':
      return { ...shared, timeout_strategy: event.timeoutStrategy, settlement_outcome: event.settlementOutcome };
    case 'late-settlement':
      return { ...shared, settlement_outcome: event.outcome };
    case 'message-delete':
    case 'message-keep':
      return { ...shared, reason: event.reason };
    case 'delete-batch-failure':
      return { ...shared, failure_mode: event.failureMode };
    case 'message-delete-failure':
      return { ...shared, reason: event.reason };
    case 'buffered-message-drop':
      return { ...shared, drop_reason: event.dropReason };
    case 'heartbeat-success':
    case 'heartbeat-failure':
      return { ...shared, heartbeat_source: event.source };
    default:
      return shared;
  }
}

export function injectTraceContextIntoMessageAttributes<
  TMessageAttributes extends Record<string, { DataType?: string; StringValue?: string }>,
>(messageAttributes: TMessageAttributes | undefined, carrier: Record<string, string>): TMessageAttributes {
  const nextMessageAttributes = { ...(messageAttributes ?? {}) };
  for (const [key, value] of Object.entries(carrier)) {
    nextMessageAttributes[key] = { DataType: MESSAGE_ATTRIBUTE_STRING_TYPE, StringValue: value };
  }

  return nextMessageAttributes as TMessageAttributes;
}

export function extractStringMessageAttributeCarrier(
  messageAttributes: SqsWorkerMessage['messageAttributes'],
): Record<string, string> {
  const carrier: Record<string, string> = {};

  for (const [key, value] of Object.entries(messageAttributes)) {
    const attributeValue = value as { StringValue?: string; stringValue?: string };
    if (attributeValue.stringValue) {
      carrier[key] = attributeValue.stringValue;
      continue;
    }
    if (attributeValue.StringValue) {
      carrier[key] = attributeValue.StringValue;
    }
  }

  return carrier;
}

export function resolveSpanName<TPayload>(
  context: SqsWorkerHandlerContext<TPayload>,
  spanName: OpenTelemetrySqsWorkerTracingOptions<TPayload>['spanName'],
): string {
  if (typeof spanName === 'function') {
    return spanName(context);
  }

  return spanName ?? `sqs.worker ${context.routeName}`;
}

export function resolveSpanAttributes<TPayload>(
  context: SqsWorkerHandlerContext<TPayload>,
  spanAttributes: OpenTelemetrySqsWorkerTracingOptions<TPayload>['spanAttributes'],
): Attributes {
  if (typeof spanAttributes === 'function') {
    return spanAttributes(context);
  }

  return spanAttributes ?? {};
}

export function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export const textMapSetter: TextMapSetter<Record<string, string>> = {
  set: (carrier, key, value) => {
    carrier[key] = value;
  },
};

export const textMapGetter: TextMapGetter<Record<string, string>> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => carrier[key],
};
