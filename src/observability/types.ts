import type { Attributes, Context, Meter, TextMapPropagator, Tracer } from '@opentelemetry/api';
import type { SqsWorkerHandlerContext, SqsWorkerManagerSnapshot, SqsWorkerRuntimeEventHook } from '../core';

export type {
  SqsWorkerAckAction,
  SqsWorkerBufferedMessageDropEvent,
  SqsWorkerBufferedMessageDropReason,
  SqsWorkerDeleteBatchFailureEvent,
  SqsWorkerDeleteBatchFailureMode,
  SqsWorkerFailureKind,
  SqsWorkerHandler,
  SqsWorkerHandlerContext,
  SqsWorkerHandlerFailureEvent,
  SqsWorkerHandlerResult,
  SqsWorkerHandlerStartEvent,
  SqsWorkerHandlerSuccessEvent,
  SqsWorkerHandlerTimeoutEvent,
  SqsWorkerHeartbeatFailureEvent,
  SqsWorkerHeartbeatSource,
  SqsWorkerHeartbeatSuccessEvent,
  SqsWorkerLateSettlementEvent,
  SqsWorkerLateSettlementOutcome,
  SqsWorkerManagerSnapshot,
  SqsWorkerMessage,
  SqsWorkerMessageAttributeValue,
  SqsWorkerMessageDeleteEvent,
  SqsWorkerMessageDeleteFailureEvent,
  SqsWorkerMessageFinalizationReason,
  SqsWorkerMessageKeepEvent,
  SqsWorkerMessageSystemAttributes,
  SqsWorkerMessagesReceivedEvent,
  SqsWorkerPollErrorEvent,
  SqsWorkerPreDispatchVisibilityFailureEvent,
  SqsWorkerReceiveEmptyEvent,
  SqsWorkerRouteCounters,
  SqsWorkerRouteStatus,
  SqsWorkerRuntimeEvent,
  SqsWorkerRuntimeEventBase,
  SqsWorkerRuntimeEventHook,
  SqsWorkerTimeoutStrategy,
} from '../core';
export type { SnsMessageAttributes, SqsMessageAttributes } from '../transport';

export interface OpenTelemetrySqsWorkerMetricsAdapter {
  onEvent: SqsWorkerRuntimeEventHook;
}

export interface OpenTelemetrySqsWorkerMetricsOptions {
  meter: Meter;
  metricPrefix?: string;
  staticAttributes?: Attributes;
  getSnapshot?: () => SqsWorkerManagerSnapshot;
  onError?: (error: unknown) => void;
}

export interface TraceContextMessageAttributeOptions<TMessageAttributes> {
  propagator: TextMapPropagator;
  carrierContext?: Context;
  messageAttributes?: TMessageAttributes;
}

export interface ExtractTraceContextFromSqsMessageOptions {
  propagator: TextMapPropagator;
  carrierContext?: Context;
}

export interface OpenTelemetrySqsWorkerTracingOptions<TPayload> {
  tracer: Tracer;
  propagator: TextMapPropagator;
  carrierContext?: Context;
  spanName?: string | ((context: SqsWorkerHandlerContext<TPayload>) => string);
  spanAttributes?: Attributes | ((context: SqsWorkerHandlerContext<TPayload>) => Attributes);
}
