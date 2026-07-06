import { type Meter } from '@opentelemetry/api';
import {
  buildMetricAttributes,
  DEFAULT_METRIC_PREFIX,
  getEventSpecificAttributes,
  observeSnapshotMetric,
} from './shared';
import type { OpenTelemetrySqsWorkerMetricsAdapter, OpenTelemetrySqsWorkerMetricsOptions } from './types';

export function createOpenTelemetrySqsWorkerMetricsAdapter(
  options: OpenTelemetrySqsWorkerMetricsOptions,
): OpenTelemetrySqsWorkerMetricsAdapter {
  const { meter, metricPrefix = DEFAULT_METRIC_PREFIX, staticAttributes = {}, getSnapshot, onError } = options;

  const receiveEmptyCounter = createCounter(meter, `${metricPrefix}.receive_empty_total`, {
    description: 'Number of empty SQS receive polls observed by the worker runtime.',
  });
  const messagesReceivedCounter = createCounter(meter, `${metricPrefix}.messages_received_total`, {
    description: 'Number of SQS messages received by the worker runtime.',
  });
  const handlerStartedCounter = createCounter(meter, `${metricPrefix}.handler_started_total`, {
    description: 'Number of handler executions started by the worker runtime.',
  });
  const handlerSuccessCounter = createCounter(meter, `${metricPrefix}.handler_success_total`, {
    description: 'Number of successful handler executions.',
  });
  const handlerFailureCounter = createCounter(meter, `${metricPrefix}.handler_failure_total`, {
    description: 'Number of failed handler executions.',
  });
  const handlerTimeoutCounter = createCounter(meter, `${metricPrefix}.handler_timeout_total`, {
    description: 'Number of handler timeouts observed by the worker runtime.',
  });
  const lateSettlementCounter = createCounter(meter, `${metricPrefix}.late_settlement_total`, {
    description: 'Number of handler settlements observed after abandon timeout finalization.',
  });
  const messageDeleteCounter = createCounter(meter, `${metricPrefix}.message_delete_total`, {
    description: 'Number of messages deleted by the worker runtime.',
  });
  const messageKeepCounter = createCounter(meter, `${metricPrefix}.message_keep_total`, {
    description: 'Number of messages intentionally kept for redelivery by the worker runtime.',
  });
  const heartbeatSuccessCounter = createCounter(meter, `${metricPrefix}.heartbeat_success_total`, {
    description: 'Number of successful visibility heartbeat extensions.',
  });
  const heartbeatFailureCounter = createCounter(meter, `${metricPrefix}.heartbeat_failure_total`, {
    description: 'Number of failed visibility heartbeat extensions.',
  });
  const pollErrorCounter = createCounter(meter, `${metricPrefix}.poll_error_total`, {
    description: 'Number of SQS polling failures observed by the worker runtime.',
  });
  const deleteBatchFailureCounter = createCounter(meter, `${metricPrefix}.delete_batch_failure_total`, {
    description: 'Number of batched delete failures observed before individual retry fallback.',
  });
  const messageDeleteFailureCounter = createCounter(meter, `${metricPrefix}.message_delete_failure_total`, {
    description: 'Number of individual delete failures observed after batch-delete fallback.',
  });
  const preDispatchVisibilityFailureCounter = createCounter(
    meter,
    `${metricPrefix}.pre_dispatch_visibility_failure_total`,
    { description: 'Number of pre-dispatch visibility extension failures for buffered messages.' },
  );
  const bufferedMessageDropCounter = createCounter(meter, `${metricPrefix}.buffered_message_drop_total`, {
    description: 'Number of buffered messages dropped locally before handler dispatch.',
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

    const totalBufferedGauge = meter.createObservableGauge(`${metricPrefix}.buffered`, {
      description: 'Current buffered message count observed by the current worker process.',
    });
    totalBufferedGauge.addCallback((result) => {
      observeSnapshotMetric(result, getSnapshot, onError, (snapshot) => {
        result.observe(snapshot.totalBuffered, staticAttributes);
        for (const route of snapshot.routes) {
          result.observe(route.buffered, buildMetricAttributes(staticAttributes, route, { scope: 'route' }));
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
          case 'poll-error':
            pollErrorCounter.add(1, attributes);
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
          case 'delete-batch-failure':
            deleteBatchFailureCounter.add(1, attributes);
            return;
          case 'message-delete-failure':
            messageDeleteFailureCounter.add(1, attributes);
            return;
          case 'pre-dispatch-visibility-failure':
            preDispatchVisibilityFailureCounter.add(1, attributes);
            return;
          case 'buffered-message-drop':
            bufferedMessageDropCounter.add(1, attributes);
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

function createCounter(meter: Meter, name: string, options: { description: string }) {
  return meter.createCounter(name, options);
}
