# Observability

`@idenstra/messaging-runtime/observability` is the package surface for OTEL metrics, W3C trace propagation, and worker tracing helpers.

The package stays vendor-neutral here:
- package code depends on injected OpenTelemetry API objects
- package code does not configure exporters
- package code does not assume SigNoz, Datadog, Grafana, or another backend

SigNoz is the first documented backend example because it speaks OTLP cleanly and fits the long-running worker model well.

## Supported import

```ts
import {
  createOpenTelemetrySqsWorkerMetricsAdapter,
  extractTraceContextFromSqsMessage,
  injectTraceContextIntoSnsMessageAttributes,
  injectTraceContextIntoSqsMessageAttributes,
  withOpenTelemetrySqsWorkerTracing,
} from '@idenstra/messaging-runtime/observability';
```

## Metrics adapter

Use an injected `Meter` to translate runtime events into OTEL counters and histograms.

```ts
const metrics = createOpenTelemetrySqsWorkerMetricsAdapter({
  meter,
  getSnapshot: () => host.getSnapshot(),
  staticAttributes: {
    service_name: 'worker-email',
    deployment_environment: 'production',
  },
});

const host = new SqsWorkerServiceHost({
  client: sqsAdapter,
  queueResolver,
  manifest,
  managerOptions: {
    onEvent: metrics.onEvent,
  },
  routes,
});
```

The adapter maps runtime events into OTEL instruments for:
- empty receives
- messages received
- handler starts
- handler successes
- handler failures
- handler timeouts
- late settlements after abandon timeout
- delete and keep outcomes
- heartbeat successes and failures
- handler duration
- late-settlement duration

When `getSnapshot()` is injected, the adapter also emits observable gauges for:
- route count
- total in-flight work
- per-route in-flight work
- started/stopping state flags

Recommended metric attributes include:
- `route_name`
- `queue_url`
- `event_type`
- `failure_kind`
- `timeout_strategy`
- `settlement_outcome`
- `heartbeat_source`

## Worker tracing

Use an injected `Tracer` plus a W3C propagator to create consumer spans around handlers.

```ts
const tracedRoute = withOpenTelemetrySqsWorkerTracing(route, {
  tracer,
  propagator,
  spanAttributes: {
    worker_kind: 'email',
  },
});
```

The wrapper:
- extracts parent trace context from SQS message attributes
- starts a consumer span for the handler execution
- records exceptions on handler failures
- preserves normal worker ack semantics
- works with both core routes and service-host routes

The helper does not change:
- delete vs keep behavior
- timeout strategy
- heartbeat behavior
- worker concurrency

## W3C propagation

The package standardizes on:
- `traceparent`
- `tracestate`
- `baggage`

Producer helpers inject those values into AWS message attributes:

```ts
const sqsAttributes = injectTraceContextIntoSqsMessageAttributes({
  propagator,
  carrierContext: producerContext,
  messageAttributes: existingAttributes,
});

const snsAttributes = injectTraceContextIntoSnsMessageAttributes({
  propagator,
  carrierContext: producerContext,
  messageAttributes: existingAttributes,
});
```

Consumer helpers extract the parent context from `SqsWorkerMessage.messageAttributes`:

```ts
const parentContext = extractTraceContextFromSqsMessage(message, { propagator });
```

Supported propagation paths:
- direct SQS producer -> SQS worker
- SNS producer -> SQS worker only when the SNS subscription uses raw delivery

Raw SNS -> SQS delivery is the supported mode because the package relies on message attributes surviving fanout. AWS also caps SQS message attributes at 10, and raw SNS delivery to SQS inherits that practical limit for forwarded attributes. Trace context normally consumes up to three attribute keys before application-specific attributes are added.

Non-raw SNS -> SQS propagation is intentionally out of scope in this slice.

## SigNoz via OTLP

SigNoz should be treated as an OTLP backend, not as a runtime-specific adapter.

Typical self-hosted OTLP endpoints are:
- gRPC: `http://<signoz-host>:4317`
- HTTP: `http://<signoz-host>:4318`

The compile-checked example in [`../examples/observability/otel-signoz-worker.ts`](../examples/observability/otel-signoz-worker.ts) uses OTLP/HTTP exporters and targets:
- `http://<signoz-host>:4318/v1/metrics`
- `http://<signoz-host>:4318/v1/traces`

Recommended dashboard groups:
- queue pressure
- worker saturation
- handler reliability
- timeout and heartbeat health
- DLQ and native redrive state

Recommended alerts:
- oldest visible message age rising above the route SLO
- backlog per worker/task rising while throughput stays flat
- sustained handler failures
- sustained timeouts
- repeated heartbeat failures
- DLQ depth growth
- native redrive tasks stuck in `RUNNING` longer than expected

## Health and readiness

`getSnapshot()` remains the package-native health surface.

Good readiness inputs:
- host started
- host not stopping
- expected route count active
- total in-flight work below a consumer-defined saturation threshold
- no persistent heartbeat-failure trend

Good liveness inputs:
- the process is still polling or intentionally idle
- in-flight work is still settling
- the runtime is not deadlocked in a permanent stop transition

Avoid treating `getSnapshot()` as end-to-end business delivery truth. It is worker-process state, not a message ledger.

## AWS-aware autoscaling guidance

Use queue-aware scaling first. CPU-only policies are usually too indirect for long-poll workers.

### ECS/Fargate

Recommended scaling inputs:
- backlog per running task
- oldest visible message age
- runtime in-flight saturation

Recommended posture:
- scale out from queue backlog per task, not raw queue depth alone
- use oldest visible message age as a latency guardrail for slow-moving queues
- use failure and timeout rates to slow or block scale-in when the system is unhealthy
- keep cooldowns conservative enough that long-poll workers are not constantly thrashing

Operationally, the cleanest AWS pattern is CloudWatch-backed scaling with metric math that divides queue backlog by running task count.

### Kubernetes on AWS

Recommended scaling inputs:
- external queue metrics such as SQS backlog or oldest message age
- pod-level saturation signals such as in-flight work per worker
- failure and timeout trends as scale-in guardrails

Recommended posture:
- prefer KEDA or another external-metric path when scaling from SQS
- do not rely only on CPU or memory HPA targets for event-driven workers
- keep minimum replicas intentional when cold-start latency matters
- keep queue visibility timeout and pod termination grace periods aligned with worker shutdown behavior

## What this slice does not include

Out of scope here:
- structured log adapters
- log-correlation helpers
- Lambda-specific guidance
- non-raw SNS -> SQS propagation helpers
- vendor-specific SigNoz code in the package
