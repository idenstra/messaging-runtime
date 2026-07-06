import assert from 'node:assert/strict';
import test from 'node:test';
import type { Meter, ObservableResult } from '@opentelemetry/api';
import type { SqsWorkerRuntimeEvent } from '../../src';
import { createOpenTelemetrySqsWorkerMetricsAdapter } from '../../src/observability';
import { createSnapshot, FakeMeter, FakeObservableResult, ThrowingMeter } from './support';

test('metrics adapter maps runtime events into counters, histograms, and optional snapshot gauges', () => {
  const meter = new FakeMeter();
  const adapter = createOpenTelemetrySqsWorkerMetricsAdapter({
    meter: meter as unknown as Meter,
    staticAttributes: { service_name: 'worker-a' },
    getSnapshot: createSnapshot,
  });

  const events: SqsWorkerRuntimeEvent[] = [
    {
      type: 'poll-error',
      at: new Date(),
      routeName: 'dispatch-email',
      queueUrl: 'https://queue.test/dispatch-email',
      error: new Error('poll down'),
      errorDetail: 'poll down',
      backoffMs: 250,
    },
    {
      type: 'messages-received',
      at: new Date(),
      routeName: 'dispatch-email',
      queueUrl: 'https://queue.test/dispatch-email',
      messageCount: 3,
    },
    {
      type: 'delete-batch-failure',
      at: new Date(),
      routeName: 'dispatch-email',
      queueUrl: 'https://queue.test/dispatch-email',
      batchSize: 2,
      failedCount: 1,
      messageIds: ['message-2'],
      failureMode: 'response-failure',
      errorDetail: 'delete-1 code=InternalError message=boom',
    },
    {
      type: 'message-delete-failure',
      at: new Date(),
      routeName: 'dispatch-email',
      queueUrl: 'https://queue.test/dispatch-email',
      messageId: 'message-2',
      reason: 'success',
      error: new Error('still broken'),
      errorDetail: 'still broken',
    },
    {
      type: 'pre-dispatch-visibility-failure',
      at: new Date(),
      routeName: 'dispatch-email',
      queueUrl: 'https://queue.test/dispatch-email',
      messageId: 'message-3',
      bufferedAgeMs: 900,
      error: new Error('visibility down'),
      errorDetail: 'visibility down',
    },
    {
      type: 'buffered-message-drop',
      at: new Date(),
      routeName: 'dispatch-email',
      queueUrl: 'https://queue.test/dispatch-email',
      messageId: 'message-3',
      dropReason: 'pre-dispatch-visibility-failure',
      bufferedAgeMs: 900,
      error: new Error('visibility down'),
      errorDetail: 'visibility down',
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

  assert.equal(meter.counters.get('messaging_runtime.poll_error_total')?.calls[0]?.value, 1);
  assert.equal(meter.counters.get('messaging_runtime.messages_received_total')?.calls[0]?.value, 3);
  assert.equal(
    meter.counters.get('messaging_runtime.delete_batch_failure_total')?.calls[0]?.attributes?.failure_mode,
    'response-failure',
  );
  assert.equal(
    meter.counters.get('messaging_runtime.message_delete_failure_total')?.calls[0]?.attributes?.reason,
    'success',
  );
  assert.equal(meter.counters.get('messaging_runtime.pre_dispatch_visibility_failure_total')?.calls[0]?.value, 1);
  assert.equal(
    meter.counters.get('messaging_runtime.buffered_message_drop_total')?.calls[0]?.attributes?.drop_reason,
    'pre-dispatch-visibility-failure',
  );
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
