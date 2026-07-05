import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSqsAdapter,
  decodeSqsJsonBody,
  parseSqsWorkerServiceManifest,
  runSqsWorkerServiceUntilSignal,
  SqsQueueUrlResolver,
  type SqsWorkerMessage,
  SqsWorkerServiceHost,
} from '@idenstra/messaging-runtime';
import {
  createOpenTelemetrySqsWorkerMetricsAdapter,
  withOpenTelemetrySqsWorkerTracing,
} from '@idenstra/messaging-runtime/observability';
import { context } from '@opentelemetry/api';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

type JobMessage = { jobId: string };

async function main(): Promise<void> {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const queueUrl = process.env.SQS_QUEUE_URL ?? 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-email-jobs';
  const otlpBaseUrl = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://127.0.0.1:14318';

  const metricExporter = new OTLPMetricExporter({ url: `${otlpBaseUrl}/v1/metrics` });
  const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 15_000 });
  const meterProvider = new MeterProvider({ readers: [metricReader] });
  const meter = meterProvider.getMeter('messaging-runtime-example');

  const traceExporter = new OTLPTraceExporter({ url: `${otlpBaseUrl}/v1/traces` });
  const tracerProvider = new BasicTracerProvider({ spanProcessors: [new BatchSpanProcessor(traceExporter)] });
  const tracer = tracerProvider.getTracer('messaging-runtime-example');

  const propagator = new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  });

  const manifest = parseSqsWorkerServiceManifest({ routes: { 'dispatch-email': { queue: queueUrl } } });

  let host!: SqsWorkerServiceHost;
  const metrics = createOpenTelemetrySqsWorkerMetricsAdapter({
    meter,
    getSnapshot: () => host.getSnapshot(),
    staticAttributes: { service_name: 'communication-worker', telemetry_backend: 'signoz' },
  });
  const sqsAdapter = new AwsSqsAdapter(new SQSClient({ region }));
  const queueResolver = new SqsQueueUrlResolver(sqsAdapter);

  host = new SqsWorkerServiceHost({
    client: sqsAdapter,
    queueResolver,
    manifest,
    managerOptions: { onEvent: metrics.onEvent },
    routes: [
      withOpenTelemetrySqsWorkerTracing(
        {
          name: 'dispatch-email',
          queue: queueUrl,
          decodePayload: (message: SqsWorkerMessage) => decodeSqsJsonBody<JobMessage>(message.body),
          handle: async (handlerContext) => {
            const payload = handlerContext.payload as JobMessage;
            void context.active();
            process.stdout.write(`dispatching email job ${payload.jobId}\n`);
          },
        },
        { tracer, propagator, carrierContext: context.active() },
      ),
    ],
  });

  await runSqsWorkerServiceUntilSignal(host);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
