import {
  createInfrastructure,
  createInstrumentedHost,
  createRouteConfig,
  createStandardQueueFixture,
  createTelemetryProviders,
  flushAndShutdownTelemetry,
  runtime,
  sendQueueJsonMessage,
  waitForMetricSeries,
  waitForTraceRows,
} from '../../../test/e2e/observability/support.mjs';

export async function warmupObservabilityBackend(runId) {
  await runWarmupFlow(`warmup-prime-${runId}`);
  const caseId = `warmup-verify-${runId}`;

  await runWarmupFlow(caseId);
  await waitForMetricSeries('messaging_runtime.messages_received_total', caseId, { timeoutMs: 120_000 });
  await waitForTraceRows(caseId, { timeoutMs: 120_000, extraConditions: ["name = 'sqs.worker observability-warmup'"] });
}

async function runWarmupFlow(caseId) {
  const { sqs } = await createInfrastructure();
  const telemetry = createTelemetryProviders();
  const queue = await createStandardQueueFixture(sqs, 'observability-warmup');
  const adapter = new runtime.AwsSqsAdapter(sqs);
  const host = createInstrumentedHost({
    client: adapter,
    queue: queue.url,
    caseId,
    telemetry,
    route: runtime.sqsJsonRoute({
      name: 'observability-warmup',
      config: createRouteConfig(),
      handle: async () => undefined,
    }),
  });

  try {
    await sendQueueJsonMessage(sqs, queue.url, { jobId: 'warmup-job' });
    await host.runUntilIdle({ idleEmptyReceiveWaves: 1 });
    await telemetry.flush();
  } finally {
    await flushAndShutdownTelemetry(telemetry);
  }
}
