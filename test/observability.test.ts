import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type Attributes,
  type Context,
  type Meter,
  type ObservableResult,
  propagation,
  ROOT_CONTEXT,
  type SpanContext,
  type TextMapPropagator,
  TraceFlags,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import type {
  SqsWorkerHandlerContext,
  SqsWorkerHandlerResult,
  SqsWorkerManagerSnapshot,
  SqsWorkerMessage,
  SqsWorkerRoute,
  SqsWorkerRuntimeEvent,
} from '../src';
import {
  createOpenTelemetrySqsWorkerMetricsAdapter,
  extractTraceContextFromSqsMessage,
  injectTraceContextIntoSnsMessageAttributes,
  injectTraceContextIntoSqsMessageAttributes,
  withOpenTelemetrySqsWorkerTracing,
} from '../src/observability';

class FakeCounter {
  readonly calls: Array<{ value: number; attributes?: Attributes }> = [];

  add(value: number, attributes?: Attributes): void {
    this.calls.push({ value, attributes });
  }
}

class FakeHistogram {
  readonly calls: Array<{ value: number; attributes?: Attributes }> = [];

  record(value: number, attributes?: Attributes): void {
    this.calls.push({ value, attributes });
  }
}

class FakeObservableGauge {
  private callback?: (result: ObservableResult) => void;

  addCallback(callback: (result: ObservableResult) => void): void {
    this.callback = callback;
  }

  run(result: ObservableResult): void {
    this.callback?.(result);
  }
}

class FakeObservableResult {
  readonly observations: Array<{ value: number; attributes?: Attributes }> = [];

  observe(value: number, attributes?: Attributes): void {
    this.observations.push({ value, attributes });
  }
}

class FakeMeter {
  readonly counters = new Map<string, FakeCounter>();
  readonly histograms = new Map<string, FakeHistogram>();
  readonly gauges = new Map<string, FakeObservableGauge>();

  createCounter(name: string): FakeCounter {
    const counter = new FakeCounter();
    this.counters.set(name, counter);
    return counter;
  }

  createHistogram(name: string): FakeHistogram {
    const histogram = new FakeHistogram();
    this.histograms.set(name, histogram);
    return histogram;
  }

  createObservableGauge(name: string): FakeObservableGauge {
    const gauge = new FakeObservableGauge();
    this.gauges.set(name, gauge);
    return gauge;
  }
}

class ThrowingCounter extends FakeCounter {
  override add(): void {
    throw new Error('counter down');
  }
}

class ThrowingMeter extends FakeMeter {
  override createCounter(name: string): FakeCounter {
    const counter = new ThrowingCounter();
    this.counters.set(name, counter);
    return counter;
  }
}

class FakeSpan {
  ended = false;
  readonly attributes = new Map<string, unknown>();
  readonly exceptions: unknown[] = [];
  status?: { code: number; message?: string };

  setAttribute(key: string, value: unknown): this {
    this.attributes.set(key, value);
    return this;
  }

  recordException(error: unknown): void {
    this.exceptions.push(error);
  }

  setStatus(status: { code: number; message?: string }): void {
    this.status = status;
  }

  end(): void {
    this.ended = true;
  }
}

class FakeTracer {
  readonly started: Array<{ name: string; parentContext: Context; span: FakeSpan }> = [];

  startSpan(name: string, options: { attributes?: Attributes } | undefined, parentContext: Context): FakeSpan {
    const span = new FakeSpan();
    for (const [key, value] of Object.entries(options?.attributes ?? {})) {
      span.setAttribute(key, value);
    }
    this.started.push({ name, parentContext, span });
    return span;
  }
}

function createCompositePropagator(): TextMapPropagator {
  return new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] });
}

function createWorkerMessage(messageAttributes: SqsWorkerMessage['messageAttributes'] = {}): SqsWorkerMessage {
  return {
    messageId: 'message-1',
    receiptHandle: 'receipt-1',
    body: JSON.stringify({ jobId: 'job-1' }),
    attributes: {},
    systemAttributes: {},
    messageAttributes,
    raw: { MessageId: 'message-1', ReceiptHandle: 'receipt-1', Body: JSON.stringify({ jobId: 'job-1' }) },
  };
}

function createSnapshot(): SqsWorkerManagerSnapshot {
  return {
    started: true,
    stopping: false,
    routeCount: 1,
    totalInFlight: 2,
    totalBuffered: 1,
    counters: {
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
    },
    routes: [
      {
        name: 'dispatch-email',
        queueUrl: 'https://queue.test/dispatch-email',
        running: true,
        stopping: false,
        inFlight: 2,
        buffered: 1,
        counters: {
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
        },
      },
    ],
  };
}

test('metrics adapter maps runtime events into counters, histograms, and optional snapshot gauges', () => {
  const meter = new FakeMeter();
  const adapter = createOpenTelemetrySqsWorkerMetricsAdapter({
    meter: meter as unknown as Meter,
    staticAttributes: { service_name: 'worker-a' },
    getSnapshot: createSnapshot,
  });

  const events: SqsWorkerRuntimeEvent[] = [
    {
      type: 'messages-received',
      at: new Date(),
      routeName: 'dispatch-email',
      queueUrl: 'https://queue.test/dispatch-email',
      messageCount: 3,
    },
    {
      type: 'handler-timeout',
      at: new Date(),
      routeName: 'dispatch-email',
      queueUrl: 'https://queue.test/dispatch-email',
      messageId: 'message-1',
      durationMs: 42,
      timeoutStrategy: 'cooperative',
      settlementOutcome: 'pending',
      error: new Error('timeout'),
    },
    {
      type: 'message-keep',
      at: new Date(),
      routeName: 'dispatch-email',
      queueUrl: 'https://queue.test/dispatch-email',
      messageId: 'message-1',
      reason: 'timeout',
    },
  ];

  for (const event of events) {
    adapter.onEvent(event);
  }

  assert.equal(meter.counters.get('messaging_runtime.messages_received_total')?.calls[0]?.value, 3);
  assert.equal(
    meter.counters.get('messaging_runtime.handler_timeout_total')?.calls[0]?.attributes?.timeout_strategy,
    'cooperative',
  );
  assert.equal(meter.histograms.get('messaging_runtime.handler_duration_ms')?.calls[0]?.value, 42);
  assert.equal(meter.counters.get('messaging_runtime.message_keep_total')?.calls[0]?.attributes?.reason, 'timeout');

  const routeCountGauge = meter.gauges.get('messaging_runtime.route_count');
  const inFlightGauge = meter.gauges.get('messaging_runtime.in_flight');
  const bufferedGauge = meter.gauges.get('messaging_runtime.buffered');
  const workerStateGauge = meter.gauges.get('messaging_runtime.state');
  const routeCountResult = new FakeObservableResult();
  const inFlightResult = new FakeObservableResult();
  const bufferedResult = new FakeObservableResult();
  const stateResult = new FakeObservableResult();

  routeCountGauge?.run(routeCountResult as unknown as ObservableResult);
  inFlightGauge?.run(inFlightResult as unknown as ObservableResult);
  bufferedGauge?.run(bufferedResult as unknown as ObservableResult);
  workerStateGauge?.run(stateResult as unknown as ObservableResult);

  assert.deepEqual(routeCountResult.observations[0], { value: 1, attributes: { service_name: 'worker-a' } });
  assert.equal(inFlightResult.observations[0]?.value, 2);
  assert.equal(inFlightResult.observations[1]?.attributes?.scope, 'route');
  assert.equal(inFlightResult.observations[1]?.attributes?.route_name, 'dispatch-email');
  assert.equal(bufferedResult.observations[0]?.value, 1);
  assert.equal(bufferedResult.observations[1]?.attributes?.scope, 'route');
  assert.equal(bufferedResult.observations[1]?.attributes?.route_name, 'dispatch-email');
  assert.deepEqual(
    stateResult.observations.map((observation) => observation.attributes?.state),
    ['started', 'stopping'],
  );
});

test('metrics adapter swallows adapter-side metric failures', () => {
  const adapter = createOpenTelemetrySqsWorkerMetricsAdapter({ meter: new ThrowingMeter() as unknown as Meter });

  assert.doesNotThrow(() =>
    adapter.onEvent({
      type: 'receive-empty',
      at: new Date(),
      routeName: 'dispatch-email',
      queueUrl: 'https://queue.test/dispatch-email',
    }),
  );
});

test('injects and extracts W3C tracecontext and baggage through SQS message attributes', () => {
  const propagator = createCompositePropagator();
  const spanContext: SpanContext = {
    traceId: '0123456789abcdef0123456789abcdef',
    spanId: '0123456789abcdef',
    traceFlags: TraceFlags.SAMPLED,
  };
  const baseContext = propagation.setBaggage(
    trace.setSpan(ROOT_CONTEXT, trace.wrapSpanContext(spanContext)),
    propagation.createBaggage({ tenant: { value: 'alpha' } }),
  );

  const messageAttributes = injectTraceContextIntoSqsMessageAttributes({ propagator, carrierContext: baseContext });
  assert.ok(messageAttributes.traceparent?.StringValue);
  assert.ok(messageAttributes.baggage?.StringValue);

  const extracted = extractTraceContextFromSqsMessage(createWorkerMessage(messageAttributes), { propagator });
  assertSpanContextMatches(trace.getSpanContext(extracted), spanContext);
  assert.equal(propagation.getBaggage(extracted)?.getEntry('tenant')?.value, 'alpha');
});

test('supports raw SNS to SQS propagation through shared message attributes', () => {
  const propagator = createCompositePropagator();
  const spanContext: SpanContext = {
    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    spanId: 'bbbbbbbbbbbbbbbb',
    traceFlags: TraceFlags.SAMPLED,
  };
  const baseContext = trace.setSpan(ROOT_CONTEXT, trace.wrapSpanContext(spanContext));

  const snsAttributes = injectTraceContextIntoSnsMessageAttributes({ propagator, carrierContext: baseContext });

  const extracted = extractTraceContextFromSqsMessage(
    createWorkerMessage(snsAttributes as unknown as SqsWorkerMessage['messageAttributes']),
    { propagator },
  );

  assertSpanContextMatches(trace.getSpanContext(extracted), spanContext);
});

test('withOpenTelemetrySqsWorkerTracing starts a consumer span with extracted parent context', async () => {
  const tracer = new FakeTracer();
  const propagator = createCompositePropagator();
  const parentSpanContext: SpanContext = {
    traceId: 'cccccccccccccccccccccccccccccccc',
    spanId: 'dddddddddddddddd',
    traceFlags: TraceFlags.SAMPLED,
  };
  const parentContext = trace.setSpan(ROOT_CONTEXT, trace.wrapSpanContext(parentSpanContext));

  const messageAttributes = injectTraceContextIntoSqsMessageAttributes({ propagator, carrierContext: parentContext });

  const route = withOpenTelemetrySqsWorkerTracing(
    {
      name: 'dispatch-email',
      queueUrl: 'https://queue.test/dispatch-email',
      handle: async () => ({ action: 'delete' }),
    } satisfies SqsWorkerRoute<undefined>,
    { tracer: tracer as unknown as Tracer, propagator, spanAttributes: { worker_kind: 'email' } },
  );

  const result = await route.handle({
    routeName: 'dispatch-email',
    queueUrl: 'https://queue.test/dispatch-email',
    payload: undefined,
    message: createWorkerMessage(messageAttributes),
    abortSignal: new AbortController().signal,
    heartbeat: async () => undefined,
  } satisfies SqsWorkerHandlerContext<undefined>);

  assert.deepEqual(result, { action: 'delete' } satisfies SqsWorkerHandlerResult);
  assert.equal(tracer.started[0]?.name, 'sqs.worker dispatch-email');
  assertSpanContextMatches(trace.getSpanContext(tracer.started[0]?.parentContext), parentSpanContext);
  assert.equal(tracer.started[0]?.span.attributes.get('worker_kind'), 'email');
  assert.equal(tracer.started[0]?.span.attributes.get('messaging_runtime.action'), 'delete');
  assert.equal(tracer.started[0]?.span.ended, true);
});

test('withOpenTelemetrySqsWorkerTracing records exceptions and rethrows handler errors', async () => {
  const tracer = new FakeTracer();
  const propagator = createCompositePropagator();
  const wrapped = withOpenTelemetrySqsWorkerTracing(
    {
      name: 'dispatch-email',
      queueUrl: 'https://queue.test/dispatch-email',
      handle: async () => {
        throw new Error('boom');
      },
    } satisfies SqsWorkerRoute<undefined>,
    { tracer: tracer as unknown as Tracer, propagator },
  );

  await assert.rejects(
    () =>
      wrapped.handle({
        routeName: 'dispatch-email',
        queueUrl: 'https://queue.test/dispatch-email',
        payload: undefined,
        message: createWorkerMessage(),
        abortSignal: new AbortController().signal,
        heartbeat: async () => undefined,
      } satisfies SqsWorkerHandlerContext<undefined>),
    /boom/,
  );

  assert.equal(tracer.started[0]?.span.exceptions.length, 1);
  assert.ok(tracer.started[0]?.span.status);
  assert.equal(tracer.started[0]?.span.ended, true);
});

function assertSpanContextMatches(actual: SpanContext | undefined, expected: SpanContext): void {
  assert.ok(actual);
  assert.equal(actual.traceId, expected.traceId);
  assert.equal(actual.spanId, expected.spanId);
  assert.equal(actual.traceFlags, expected.traceFlags);
}
