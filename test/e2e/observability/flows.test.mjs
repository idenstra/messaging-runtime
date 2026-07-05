import test from 'node:test';
import {
  createCaseId,
  createDeleteBatchFailureSqsAdapter,
  createInfrastructure,
  createInstrumentedHost,
  createParentTraceContext,
  createRawSnsSubscriptionFixture,
  createRouteConfig,
  createStandardQueueFixture,
  createTelemetryProviders,
  flushAndShutdownTelemetry,
  observability,
  publishRawSnsJsonMessage,
  runtime,
  sendQueueJsonMessage,
  waitForApproximateVisibleMessageCount,
  waitForCondition,
  waitForMetricSeries,
  waitForTraceRows,
} from './support.mjs';

test('direct SQS success flow exports metrics and consumer spans', async () => {
  const caseId = createCaseId('direct-success');
  const { sqs } = await createInfrastructure();
  const queue = await createStandardQueueFixture(sqs, 'direct-success');
  const telemetry = createTelemetryProviders();
  const adapter = new runtime.AwsSqsAdapter(sqs);
  const host = createInstrumentedHost({
    client: adapter,
    queue: queue.url,
    caseId,
    telemetry,
    route: runtime.sqsJsonRoute({ name: 'direct-success', config: createRouteConfig(), handle: async () => undefined }),
  });

  try {
    await sendQueueJsonMessage(sqs, queue.url, { jobId: 'job-success' });
    await host.runUntilIdle({ idleEmptyReceiveWaves: 1 });
    await telemetry.flush();

    await waitForMetricSeries('messaging_runtime.messages_received_total', caseId);
    await waitForMetricSeries('messaging_runtime.handler_started_total', caseId);
    await waitForMetricSeries('messaging_runtime.handler_success_total', caseId);
    await waitForMetricSeries('messaging_runtime.message_delete_total', caseId);
    await waitForTraceRows(caseId, { extraConditions: ["name = 'sqs.worker direct-success'"] });
  } finally {
    await flushAndShutdownTelemetry(telemetry);
  }
});

test('snapshot-derived gauges export route count, in-flight, buffered, and state metrics', async () => {
  const caseId = createCaseId('snapshot-gauges');
  const { sqs } = await createInfrastructure();
  const queue = await createStandardQueueFixture(sqs, 'snapshot-gauges', { visibilityTimeoutSeconds: 30 });
  const telemetry = createTelemetryProviders();
  const adapter = new runtime.AwsSqsAdapter(sqs);
  let releaseHandler;
  const releasePromise = new Promise((resolve) => {
    releaseHandler = resolve;
  });
  const host = createInstrumentedHost({
    client: adapter,
    queue: queue.url,
    caseId,
    telemetry,
    route: runtime.sqsJsonRoute({
      name: 'snapshot-gauges',
      config: createRouteConfig({ concurrency: 1, maxMessagesPerPoll: 2, visibilityTimeoutSeconds: 30 }),
      handle: async () => {
        await releasePromise;
      },
    }),
  });

  try {
    await sendQueueJsonMessage(sqs, queue.url, { jobId: 'job-gauge-1' });
    await sendQueueJsonMessage(sqs, queue.url, { jobId: 'job-gauge-2' });
    await host.start();

    await waitForCondition(
      () => {
        const snapshot = host.getSnapshot();
        return snapshot.started && snapshot.totalInFlight === 1 && snapshot.totalBuffered === 1;
      },
      { timeoutMs: 20_000, description: 'host snapshot with active in-flight and buffered work' },
    );

    await telemetry.flush();

    await waitForMetricSeries('messaging_runtime.route_count', caseId);
    await waitForMetricSeries('messaging_runtime.in_flight', caseId);
    await waitForMetricSeries('messaging_runtime.buffered', caseId);
    await waitForMetricSeries('messaging_runtime.state', caseId, { extraConditions: ["t.attrs['state'] = 'started'"] });
  } finally {
    releaseHandler?.();
    await waitForCondition(
      () => {
        const snapshot = host.getSnapshot();
        return snapshot.totalInFlight === 0 && snapshot.totalBuffered === 0;
      },
      { timeoutMs: 20_000, intervalMs: 200, description: 'host to drain after releasing snapshot test handler' },
    ).catch(() => {});
    await host.stop().catch(() => {});
    await flushAndShutdownTelemetry(telemetry);
  }
});

test('raw SNS to SQS propagation preserves the producer trace identity on the consumer span', async () => {
  const caseId = createCaseId('raw-sns-propagation');
  const { sqs, sns } = await createInfrastructure();
  const { topic, queue } = await createRawSnsSubscriptionFixture(sns, sqs, 'raw-sns-propagation');
  const telemetry = createTelemetryProviders();
  const adapter = new runtime.AwsSqsAdapter(sqs);
  const host = createInstrumentedHost({
    client: adapter,
    queue: queue.url,
    caseId,
    telemetry,
    route: runtime.sqsJsonRoute({
      name: 'raw-sns-propagation',
      config: createRouteConfig(),
      handle: async () => undefined,
    }),
  });

  try {
    const { parentContext, traceId } = createParentTraceContext();
    const messageAttributes = observability.injectTraceContextIntoSnsMessageAttributes({
      propagator: telemetry.propagator,
      carrierContext: parentContext,
    });

    await publishRawSnsJsonMessage(sns, topic.arn, { jobId: 'job-raw-sns' }, { messageAttributes });
    await waitForApproximateVisibleMessageCount(sqs, queue.url, { minCount: 1, timeoutMs: 15_000 });
    await host.runUntilIdle({ idleEmptyReceiveWaves: 1 });
    await telemetry.flush();

    await waitForTraceRows(caseId, {
      extraConditions: [`name = 'sqs.worker raw-sns-propagation'`, `traceID = '${traceId}'`],
    });
  } finally {
    await flushAndShutdownTelemetry(telemetry);
  }
});

test('handler failure flow exports failure metrics and error spans', async () => {
  const caseId = createCaseId('handler-failure');
  const { sqs } = await createInfrastructure();
  const queue = await createStandardQueueFixture(sqs, 'handler-failure');
  const telemetry = createTelemetryProviders();
  const adapter = new runtime.AwsSqsAdapter(sqs);
  const host = createInstrumentedHost({
    client: adapter,
    queue: queue.url,
    caseId,
    telemetry,
    route: runtime.sqsJsonRoute({
      name: 'handler-failure',
      config: createRouteConfig({ failureAction: 'delete' }),
      handle: async () => {
        throw new Error('intentional handler failure');
      },
    }),
  });

  try {
    await sendQueueJsonMessage(sqs, queue.url, { jobId: 'job-failure' });
    await host.runUntilIdle({ idleEmptyReceiveWaves: 1 });
    await telemetry.flush();

    await waitForMetricSeries('messaging_runtime.handler_failure_total', caseId);
    await waitForTraceRows(caseId, {
      extraConditions: ["name = 'sqs.worker handler-failure'", "status_code_string = 'Error'"],
    });
  } finally {
    await flushAndShutdownTelemetry(telemetry);
  }
});

test('timeout and heartbeat flows export timeout and heartbeat metrics', async () => {
  const caseId = createCaseId('timeout-heartbeat');
  const { sqs } = await createInfrastructure();
  const queue = await createStandardQueueFixture(sqs, 'timeout-heartbeat', { visibilityTimeoutSeconds: 2 });
  const telemetry = createTelemetryProviders();
  const adapter = new runtime.AwsSqsAdapter(sqs);
  const host = createInstrumentedHost({
    client: adapter,
    queue: queue.url,
    caseId,
    telemetry,
    route: runtime.sqsJsonRoute({
      name: 'timeout-heartbeat',
      config: createRouteConfig({
        visibilityTimeoutSeconds: 2,
        heartbeatIntervalMs: 400,
        handlerTimeoutMs: 1_200,
        failureAction: 'delete',
      }),
      handle: async ({ abortSignal }) => {
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 10_000);
          abortSignal.addEventListener(
            'abort',
            () => {
              clearTimeout(timeout);
              setTimeout(resolve, 200);
            },
            { once: true },
          );
        });
      },
    }),
  });

  try {
    await sendQueueJsonMessage(sqs, queue.url, { jobId: 'job-timeout' });
    await host.runUntilIdle({ idleEmptyReceiveWaves: 1 });
    await telemetry.flush();

    await waitForMetricSeries('messaging_runtime.handler_timeout_total', caseId);
    await waitForMetricSeries('messaging_runtime.heartbeat_success_total', caseId);
  } finally {
    await flushAndShutdownTelemetry(telemetry);
  }
});

test('delete batch failure telemetry is exported through the real LocalStack-backed delete path', async () => {
  const caseId = createCaseId('delete-batch-failure');
  const { sqs } = await createInfrastructure();
  const queue = await createStandardQueueFixture(sqs, 'delete-batch-failure');
  const telemetry = createTelemetryProviders();
  const adapter = createDeleteBatchFailureSqsAdapter(sqs);
  const host = createInstrumentedHost({
    client: adapter,
    queue: queue.url,
    caseId,
    telemetry,
    route: runtime.sqsJsonRoute({
      name: 'delete-batch-failure',
      config: createRouteConfig(),
      handle: async () => undefined,
    }),
  });

  try {
    await sendQueueJsonMessage(sqs, queue.url, { jobId: 'job-delete-batch-failure' });
    await host.runUntilIdle({ idleEmptyReceiveWaves: 1 });
    await telemetry.flush();

    await waitForMetricSeries('messaging_runtime.delete_batch_failure_total', caseId);
  } finally {
    await flushAndShutdownTelemetry(telemetry);
  }
});
