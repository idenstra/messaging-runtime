import assert from 'node:assert/strict';
import test from 'node:test';
import type { SpanContext, Tracer } from '@opentelemetry/api';
import type { SqsWorkerHandlerContext, SqsWorkerHandlerResult, SqsWorkerRoute } from '../../src';
import { injectTraceContextIntoSqsMessageAttributes, withOpenTelemetrySqsWorkerTracing } from '../../src/observability';
import {
  assertSpanContextMatches,
  createCompositePropagator,
  createParentTraceContext,
  createWorkerMessage,
  FakeTracer,
  TraceFlags,
  trace,
} from './support';

test('withOpenTelemetrySqsWorkerTracing starts a consumer span with extracted parent context', async () => {
  const tracer = new FakeTracer();
  const propagator = createCompositePropagator();
  const parentSpanContext: SpanContext = {
    traceId: 'cccccccccccccccccccccccccccccccc',
    spanId: 'dddddddddddddddd',
    traceFlags: TraceFlags.SAMPLED,
  };
  const parentContext = createParentTraceContext(parentSpanContext);

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
