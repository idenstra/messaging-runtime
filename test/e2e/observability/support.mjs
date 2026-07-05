import { randomBytes, randomUUID } from 'node:crypto';
import { context, ROOT_CONTEXT, TraceFlags, trace } from '@opentelemetry/api';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import * as runtime from '../../../dist/index.js';
import * as observability from '../../../dist/observability.js';
import { clickhouseQuery, signozOtlpHttpPort, sleep } from '../../../scripts/e2e/observability/shared.mjs';
import {
  createQueue,
  createSdkClients,
  createStandardRuntimeDefaults,
  createSuitePrefix,
  createTopic,
  publishTopicStringMessage,
  sendQueueJsonMessage,
  subscribeTopicToQueue,
  waitForApproximateVisibleMessageCount,
  waitForCondition,
} from '../localstack/support.mjs';

export const OBSERVABILITY_RUN_ID = process.env.MESSAGING_RUNTIME_OBSERVABILITY_RUN_ID ?? 'manual';
export const OTLP_HTTP_BASE_URL = `http://127.0.0.1:${signozOtlpHttpPort}`;
const OBSERVABILITY_METER_NAME = 'messaging-runtime-observability-e2e';
const OBSERVABILITY_TRACER_NAME = 'messaging-runtime-observability-e2e';
const DEFAULT_QUERY_TIMEOUT_MS = 90_000;

export function createCaseId(label) {
  return `${createSuitePrefix(`obs-${label}`)}-${randomUUID().slice(0, 8)}`;
}

export function createSmokeAttributes(caseId, extra = {}) {
  return { 'smoke.run_id': OBSERVABILITY_RUN_ID, 'smoke.case_id': caseId, ...extra };
}

export function createPropagator() {
  return new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] });
}

export function createParentTraceContext() {
  const traceId = randomBytes(16).toString('hex');
  const spanId = randomBytes(8).toString('hex');
  const parentContext = trace.setSpanContext(ROOT_CONTEXT, { traceId, spanId, traceFlags: TraceFlags.SAMPLED });
  return { parentContext, traceId, spanId };
}

export function createTelemetryProviders() {
  const metricExporter = new OTLPMetricExporter({ url: `${OTLP_HTTP_BASE_URL}/v1/metrics` });
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 1_000,
    exportTimeoutMillis: 1_000,
  });
  const meterProvider = new MeterProvider({ readers: [metricReader] });
  const traceExporter = new OTLPTraceExporter({ url: `${OTLP_HTTP_BASE_URL}/v1/traces` });
  const tracerProvider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(traceExporter)] });

  return {
    meter: meterProvider.getMeter(OBSERVABILITY_METER_NAME),
    tracer: tracerProvider.getTracer(OBSERVABILITY_TRACER_NAME),
    propagator: createPropagator(),
    async flush() {
      await tracerProvider.forceFlush();
      await meterProvider.forceFlush();
      await sleep(1_500);
    },
    async shutdown() {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
    },
  };
}

export function createInstrumentedHost({ client, queue, route, telemetry, caseId }) {
  let host;
  const metrics = observability.createOpenTelemetrySqsWorkerMetricsAdapter({
    meter: telemetry.meter,
    getSnapshot: () => host.getSnapshot(),
    staticAttributes: createSmokeAttributes(caseId),
  });
  const tracedRoute = observability.withOpenTelemetrySqsWorkerTracing(route, {
    tracer: telemetry.tracer,
    propagator: telemetry.propagator,
    spanAttributes: createSmokeAttributes(caseId),
  });

  host = new runtime.SqsWorkerServiceHost({
    client,
    queueResolver: new runtime.SqsQueueUrlResolver(client),
    manifest: runtime.parseSqsWorkerServiceManifest({ routes: { [route.name]: { queue } } }),
    managerOptions: { onEvent: metrics.onEvent },
    routes: [tracedRoute],
  });

  return host;
}

export function createRouteConfig(overrides = {}) {
  return {
    concurrency: 1,
    maxMessagesPerPoll: 1,
    visibilityTimeoutSeconds: 2,
    ...createStandardRuntimeDefaults(),
    ...overrides,
  };
}

export function createDeleteBatchFailureSqsAdapter(sdkClient) {
  let failedBatchDelete = false;

  return new runtime.AwsSqsAdapter({
    send: async (command, options) => {
      if (command?.constructor?.name === 'DeleteMessageBatchCommand' && !failedBatchDelete) {
        failedBatchDelete = true;
        throw new Error('Injected delete batch failure for observability E2E.');
      }

      return sdkClient.send(command, options);
    },
  });
}

export async function waitForMetricSeries(
  metricName,
  caseId,
  { extraConditions = [], timeoutMs = DEFAULT_QUERY_TIMEOUT_MS } = {},
) {
  const conditions = [
    `t.metric_name = '${sqlLiteral(metricName)}'`,
    `t.attrs['smoke.run_id'] = '${sqlLiteral(OBSERVABILITY_RUN_ID)}'`,
    `t.attrs['smoke.case_id'] = '${sqlLiteral(caseId)}'`,
    ...extraConditions,
  ];

  const query = [
    'SELECT count()',
    'FROM signoz_metrics.samples_v4 AS s',
    'INNER JOIN signoz_metrics.time_series_v4 AS t ON s.fingerprint = t.fingerprint',
    `WHERE ${conditions.join(' AND ')}`,
  ].join(' ');

  await waitForCountQuery(`metric ${metricName}`, query, timeoutMs);
}

export async function waitForTraceRows(caseId, { extraConditions = [], timeoutMs = DEFAULT_QUERY_TIMEOUT_MS } = {}) {
  const conditions = [
    `attributes_string['smoke.run_id'] = '${sqlLiteral(OBSERVABILITY_RUN_ID)}'`,
    `attributes_string['smoke.case_id'] = '${sqlLiteral(caseId)}'`,
    ...extraConditions,
  ];
  const query = `SELECT count() FROM signoz_traces.signoz_index_v3 WHERE ${conditions.join(' AND ')}`;
  await waitForCountQuery('trace rows', query, timeoutMs);
}

export async function createInfrastructure() {
  return createSdkClients();
}

export async function createStandardQueueFixture(sqsClient, label, overrides = {}) {
  return createQueue(sqsClient, { name: `${createSuitePrefix(label)}-${randomUUID().slice(0, 8)}`, ...overrides });
}

export async function createRawSnsSubscriptionFixture(snsClient, sqsClient, label) {
  const topic = await createTopic(snsClient, {
    name: `${createSuitePrefix(`${label}-topic`)}-${randomUUID().slice(0, 8)}`,
  });
  const queue = await createStandardQueueFixture(sqsClient, `${label}-queue`);
  await subscribeTopicToQueue(snsClient, sqsClient, {
    topicArn: topic.arn,
    queueArn: queue.arn,
    queueUrl: queue.url,
    rawMessageDelivery: true,
  });
  return { topic, queue };
}

export async function publishRawSnsJsonMessage(snsClient, topicArn, payload, { messageAttributes } = {}) {
  await publishTopicStringMessage(snsClient, topicArn, JSON.stringify(payload), { messageAttributes });
}

export async function flushAndShutdownTelemetry(telemetry) {
  await telemetry.flush();
  await telemetry.shutdown();
}

async function waitForCountQuery(description, query, timeoutMs) {
  await waitForCondition(
    async () => {
      const count = Number.parseInt(clickhouseQuery(query).replaceAll('\r', ''), 10);
      return Number.isFinite(count) && count > 0;
    },
    { timeoutMs, intervalMs: 2_000, description },
  );
}

function sqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

export {
  context,
  observability,
  runtime,
  sendQueueJsonMessage,
  waitForApproximateVisibleMessageCount,
  waitForCondition,
};
