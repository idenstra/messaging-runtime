import assert from 'node:assert/strict';
import test from 'node:test';
import type { SpanContext } from '@opentelemetry/api';
import {
  extractTraceContextFromSqsMessage,
  injectTraceContextIntoSnsMessageAttributes,
  injectTraceContextIntoSqsMessageAttributes,
} from '../../src/observability';
import {
  assertSpanContextMatches,
  createBaggageContext,
  createCompositePropagator,
  createParentTraceContext,
  createWorkerMessage,
  propagation,
  TraceFlags,
  trace,
} from './support';

test('injects and extracts W3C tracecontext and baggage through SQS message attributes', () => {
  const propagator = createCompositePropagator();
  const spanContext: SpanContext = {
    traceId: '0123456789abcdef0123456789abcdef',
    spanId: '0123456789abcdef',
    traceFlags: TraceFlags.SAMPLED,
  };
  const baseContext = createBaggageContext(spanContext, 'alpha');

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
  const baseContext = createParentTraceContext(spanContext);

  const snsAttributes = injectTraceContextIntoSnsMessageAttributes({ propagator, carrierContext: baseContext });

  const extracted = extractTraceContextFromSqsMessage(
    createWorkerMessage(snsAttributes as unknown as ReturnType<typeof createWorkerMessage>['messageAttributes']),
    { propagator },
  );

  assertSpanContextMatches(trace.getSpanContext(extracted), spanContext);
});
