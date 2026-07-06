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
  trace,
} from '@opentelemetry/api';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import type { SqsWorkerManagerSnapshot, SqsWorkerMessage } from '../../src';

export class FakeCounter {
  readonly calls: Array<{ value: number; attributes?: Attributes }> = [];

  add(value: number, attributes?: Attributes): void {
    this.calls.push({ value, attributes });
  }
}

export class FakeHistogram {
  readonly calls: Array<{ value: number; attributes?: Attributes }> = [];

  record(value: number, attributes?: Attributes): void {
    this.calls.push({ value, attributes });
  }
}

export class FakeObservableGauge {
  private callback?: (result: ObservableResult) => void;

  addCallback(callback: (result: ObservableResult) => void): void {
    this.callback = callback;
  }

  run(result: ObservableResult): void {
    this.callback?.(result);
  }
}

export class FakeObservableResult {
  readonly observations: Array<{ value: number; attributes?: Attributes }> = [];

  observe(value: number, attributes?: Attributes): void {
    this.observations.push({ value, attributes });
  }
}

export class FakeMeter {
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

export class ThrowingCounter extends FakeCounter {
  override add(): void {
    throw new Error('counter down');
  }
}

export class ThrowingMeter extends FakeMeter {
  override createCounter(name: string): FakeCounter {
    const counter = new ThrowingCounter();
    this.counters.set(name, counter);
    return counter;
  }
}

export class FakeSpan {
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

export class FakeTracer {
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

export function createCompositePropagator(): TextMapPropagator {
  return new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] });
}

export function createWorkerMessage(messageAttributes: SqsWorkerMessage['messageAttributes'] = {}): SqsWorkerMessage {
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

export function createSnapshot(): SqsWorkerManagerSnapshot {
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
      pollErrorCount: 0,
      deleteBatchFailureCount: 0,
      messageDeleteFailureCount: 0,
      preDispatchVisibilityFailureCount: 0,
      bufferedMessageDropCount: 0,
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
          pollErrorCount: 0,
          deleteBatchFailureCount: 0,
          messageDeleteFailureCount: 0,
          preDispatchVisibilityFailureCount: 0,
          bufferedMessageDropCount: 0,
        },
      },
    ],
  };
}

export function createParentTraceContext(spanContext: SpanContext) {
  return trace.setSpan(ROOT_CONTEXT, trace.wrapSpanContext(spanContext));
}

export function createBaggageContext(spanContext: SpanContext, tenant: string) {
  return propagation.setBaggage(
    trace.setSpan(ROOT_CONTEXT, trace.wrapSpanContext(spanContext)),
    propagation.createBaggage({ tenant: { value: tenant } }),
  );
}

export function assertSpanContextMatches(actual: SpanContext | undefined, expected: SpanContext): void {
  if (!actual) {
    throw new Error('Expected a span context to be present.');
  }
  if (
    actual.traceId !== expected.traceId ||
    actual.spanId !== expected.spanId ||
    actual.traceFlags !== expected.traceFlags
  ) {
    throw new Error(`Span context mismatch. Actual=${JSON.stringify(actual)} Expected=${JSON.stringify(expected)}`);
  }
}

export { type Meter, type ObservableResult, propagation, ROOT_CONTEXT, TraceFlags, trace };
