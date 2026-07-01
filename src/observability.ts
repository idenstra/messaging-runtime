import {
  type Attributes,
  type Context,
  context,
  type Meter,
  type ObservableResult,
  SpanKind,
  SpanStatusCode,
  type TextMapGetter,
  type TextMapPropagator,
  type TextMapSetter,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import type {
  SqsWorkerHandler,
  SqsWorkerHandlerContext,
  SqsWorkerManagerSnapshot,
  SqsWorkerMessage,
  SqsWorkerRuntimeEvent,
  SqsWorkerRuntimeEventHook,
} from './core';
import type { SnsMessageAttributes, SqsMessageAttributes } from './transport';

export type {
  SqsWorkerAckAction,
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
  SqsWorkerMessageKeepEvent,
  SqsWorkerMessagesReceivedEvent,
  SqsWorkerReceiveEmptyEvent,
  SqsWorkerRouteCounters,
  SqsWorkerRouteStatus,
  SqsWorkerRuntimeEvent,
  SqsWorkerRuntimeEventBase,
  SqsWorkerRuntimeEventHook,
  SqsWorkerTimeoutStrategy,
} from './core';
export type { SnsMessageAttributes, SqsMessageAttributes } from './transport';

const DEFAULT_METRIC_PREFIX = 'messaging_runtime';
const MESSAGE_ATTRIBUTE_STRING_TYPE = 'String';

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

export function createOpenTelemetrySqsWorkerMetricsAdapter(
  options: OpenTelemetrySqsWorkerMetricsOptions,
): OpenTelemetrySqsWorkerMetricsAdapter {
  const { meter, metricPrefix = DEFAULT_METRIC_PREFIX, staticAttributes = {}, getSnapshot, onError } = options;

  const receiveEmptyCounter = meter.createCounter(`${metricPrefix}.receive_empty_total`, {
    description: 'Number of empty SQS receive polls observed by the worker runtime.',
  });
  const messagesReceivedCounter = meter.createCounter(`${metricPrefix}.messages_received_total`, {
    description: 'Number of SQS messages received by the worker runtime.',
  });
  const handlerStartedCounter = meter.createCounter(`${metricPrefix}.handler_started_total`, {
    description: 'Number of handler executions started by the worker runtime.',
  });
  const handlerSuccessCounter = meter.createCounter(`${metricPrefix}.handler_success_total`, {
    description: 'Number of successful handler executions.',
  });
  const handlerFailureCounter = meter.createCounter(`${metricPrefix}.handler_failure_total`, {
    description: 'Number of failed handler executions.',
  });
  const handlerTimeoutCounter = meter.createCounter(`${metricPrefix}.handler_timeout_total`, {
    description: 'Number of handler timeouts observed by the worker runtime.',
  });
  const lateSettlementCounter = meter.createCounter(`${metricPrefix}.late_settlement_total`, {
    description: 'Number of handler settlements observed after abandon timeout finalization.',
  });
  const messageDeleteCounter = meter.createCounter(`${metricPrefix}.message_delete_total`, {
    description: 'Number of messages deleted by the worker runtime.',
  });
  const messageKeepCounter = meter.createCounter(`${metricPrefix}.message_keep_total`, {
    description: 'Number of messages intentionally kept for redelivery by the worker runtime.',
  });
  const heartbeatSuccessCounter = meter.createCounter(`${metricPrefix}.heartbeat_success_total`, {
    description: 'Number of successful visibility heartbeat extensions.',
  });
  const heartbeatFailureCounter = meter.createCounter(`${metricPrefix}.heartbeat_failure_total`, {
    description: 'Number of failed visibility heartbeat extensions.',
  });
  const handlerDurationHistogram = meter.createHistogram(`${metricPrefix}.handler_duration_ms`, {
    description: 'Handler execution duration recorded by the worker runtime.',
    unit: 'ms',
  });
  const lateSettlementDurationHistogram = meter.createHistogram(`${metricPrefix}.late_settlement_duration_ms`, {
    description: 'Late settlement duration recorded after abandon timeout finalization.',
    unit: 'ms',
  });

  if (getSnapshot) {
    const routeCountGauge = meter.createObservableGauge(`${metricPrefix}.route_count`, {
      description: 'Number of active routes known to the current worker process.',
    });
    routeCountGauge.addCallback((result) => {
      observeSnapshotMetric(result, getSnapshot, onError, (snapshot) => {
        result.observe(snapshot.routeCount, staticAttributes);
      });
    });

    const totalInFlightGauge = meter.createObservableGauge(`${metricPrefix}.in_flight`, {
      description: 'Current in-flight message count observed by the current worker process.',
    });
    totalInFlightGauge.addCallback((result) => {
      observeSnapshotMetric(result, getSnapshot, onError, (snapshot) => {
        result.observe(snapshot.totalInFlight, staticAttributes);
        for (const route of snapshot.routes) {
          result.observe(route.inFlight, buildMetricAttributes(staticAttributes, route, { scope: 'route' }));
        }
      });
    });

    const workerStateGauge = meter.createObservableGauge(`${metricPrefix}.state`, {
      description: 'Process-local worker lifecycle state, emitted as 1 for active flags and 0 for inactive flags.',
    });
    workerStateGauge.addCallback((result) => {
      observeSnapshotMetric(result, getSnapshot, onError, (snapshot) => {
        result.observe(snapshot.started ? 1 : 0, { ...staticAttributes, state: 'started' });
        result.observe(snapshot.stopping ? 1 : 0, { ...staticAttributes, state: 'stopping' });
      });
    });
  }

  return {
    onEvent: (event) => {
      try {
        const attributes = buildMetricAttributes(staticAttributes, event, getEventSpecificAttributes(event));

        switch (event.type) {
          case 'receive-empty':
            receiveEmptyCounter.add(1, attributes);
            return;
          case 'messages-received':
            messagesReceivedCounter.add(event.messageCount, attributes);
            return;
          case 'handler-start':
            handlerStartedCounter.add(1, attributes);
            return;
          case 'handler-success':
            handlerSuccessCounter.add(1, attributes);
            handlerDurationHistogram.record(event.durationMs, attributes);
            return;
          case 'handler-failure':
            handlerFailureCounter.add(1, attributes);
            handlerDurationHistogram.record(event.durationMs, attributes);
            return;
          case 'handler-timeout':
            handlerTimeoutCounter.add(1, attributes);
            handlerDurationHistogram.record(event.durationMs, attributes);
            return;
          case 'late-settlement':
            lateSettlementCounter.add(1, attributes);
            lateSettlementDurationHistogram.record(event.durationMs, attributes);
            return;
          case 'message-delete':
            messageDeleteCounter.add(1, attributes);
            return;
          case 'message-keep':
            messageKeepCounter.add(1, attributes);
            return;
          case 'heartbeat-success':
            heartbeatSuccessCounter.add(1, attributes);
            return;
          case 'heartbeat-failure':
            heartbeatFailureCounter.add(1, attributes);
            return;
        }
      } catch (error) {
        onError?.(error);
      }
    },
  };
}

export function injectTraceContextIntoSqsMessageAttributes(
  options: TraceContextMessageAttributeOptions<SqsMessageAttributes>,
): SqsMessageAttributes {
  return injectTraceContextIntoMessageAttributes(options);
}

export function injectTraceContextIntoSnsMessageAttributes(
  options: TraceContextMessageAttributeOptions<SnsMessageAttributes>,
): SnsMessageAttributes {
  return injectTraceContextIntoMessageAttributes(options);
}

export function extractTraceContextFromSqsMessage(
  message: SqsWorkerMessage,
  options: ExtractTraceContextFromSqsMessageOptions,
): Context {
  const carrier = extractStringMessageAttributeCarrier(message.messageAttributes);
  return options.propagator.extract(options.carrierContext ?? context.active(), carrier, textMapGetter);
}

export function withOpenTelemetrySqsWorkerTracing<TPayload, TRoute extends { handle: SqsWorkerHandler<TPayload> }>(
  route: TRoute,
  options: OpenTelemetrySqsWorkerTracingOptions<TPayload>,
): TRoute;
export function withOpenTelemetrySqsWorkerTracing<TPayload, TRoute extends { handle: SqsWorkerHandler<TPayload> }>(
  route: TRoute,
  options: OpenTelemetrySqsWorkerTracingOptions<TPayload>,
): TRoute {
  return {
    ...route,
    handle: async (handlerContext) => {
      const parentContext = extractTraceContextFromSqsMessage(handlerContext.message, {
        propagator: options.propagator,
        carrierContext: options.carrierContext,
      });
      const spanName = resolveSpanName(handlerContext, options.spanName);
      const span = options.tracer.startSpan(
        spanName,
        {
          kind: SpanKind.CONSUMER,
          attributes: {
            'messaging.system': 'aws_sqs',
            'messaging.operation': 'process',
            'messaging_runtime.route_name': handlerContext.routeName,
            'messaging_runtime.queue_url': handlerContext.queueUrl,
            'messaging_runtime.message_id': handlerContext.message.messageId,
            ...resolveSpanAttributes(handlerContext, options.spanAttributes),
          },
        },
        parentContext,
      );

      return context.with(trace.setSpan(parentContext, span), async () => {
        try {
          const result = await route.handle(handlerContext);
          if (result?.action) {
            span.setAttribute('messaging_runtime.action', result.action);
          }
          return result;
        } catch (error) {
          if (error instanceof Error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
          } else {
            span.recordException({ name: 'NonErrorThrow', message: describeUnknownError(error) });
            span.setStatus({ code: SpanStatusCode.ERROR, message: describeUnknownError(error) });
          }
          throw error;
        } finally {
          span.end();
        }
      });
    },
  };
}

function observeSnapshotMetric(
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

function buildMetricAttributes(
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

function getEventSpecificAttributes(event: SqsWorkerRuntimeEvent): Attributes {
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
    case 'heartbeat-success':
    case 'heartbeat-failure':
      return { ...shared, heartbeat_source: event.source };
    default:
      return shared;
  }
}

function injectTraceContextIntoMessageAttributes<
  TMessageAttributes extends Record<string, { DataType?: string; StringValue?: string }>,
>(options: TraceContextMessageAttributeOptions<TMessageAttributes>): TMessageAttributes {
  const carrier: Record<string, string> = {};
  options.propagator.inject(options.carrierContext ?? context.active(), carrier, textMapSetter);

  const messageAttributes = { ...(options.messageAttributes ?? {}) };
  for (const [key, value] of Object.entries(carrier)) {
    messageAttributes[key] = { DataType: MESSAGE_ATTRIBUTE_STRING_TYPE, StringValue: value };
  }

  return messageAttributes as TMessageAttributes;
}

function extractStringMessageAttributeCarrier(
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

function resolveSpanName<TPayload>(
  context: SqsWorkerHandlerContext<TPayload>,
  spanName: OpenTelemetrySqsWorkerTracingOptions<TPayload>['spanName'],
): string {
  if (typeof spanName === 'function') {
    return spanName(context);
  }

  return spanName ?? `sqs.worker ${context.routeName}`;
}

function resolveSpanAttributes<TPayload>(
  context: SqsWorkerHandlerContext<TPayload>,
  spanAttributes: OpenTelemetrySqsWorkerTracingOptions<TPayload>['spanAttributes'],
): Attributes {
  if (typeof spanAttributes === 'function') {
    return spanAttributes(context);
  }

  return spanAttributes ?? {};
}

function describeUnknownError(error: unknown): string {
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

const textMapSetter: TextMapSetter<Record<string, string>> = {
  set: (carrier, key, value) => {
    carrier[key] = value;
  },
};

const textMapGetter: TextMapGetter<Record<string, string>> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => carrier[key],
};
