# Operations

`messaging-runtime` keeps operational ownership explicit. The library owns reusable SNS/SQS mechanics. The application owns deployment, configuration, idempotency, persistence, alerting policy, and rollout.

Use this guide for runtime operations. Use [`ADOPTION.md`](ADOPTION.md) when you are rolling the library into a real service for the first time.

## Configuration ownership

The library does not read environment variables, files, or secrets. Load config in the application and pass concrete values into the runtime.

Recommended pattern:

1. load application config;
2. construct AWS SDK clients;
3. create runtime and transport adapters;
4. preload queue and topic mappings when known;
5. parse the worker manifest;
6. construct the host and any route-owned resources captured by lifecycle hooks;
7. start the host through the signal runner or framework lifecycle.

This keeps the package deterministic and easy to test.

## Route-owned resource lifecycle

Use `route.lifecycle` when a worker route needs startup or cleanup affordances for resources that stay owned by the consuming app, such as:

- database pools
- HTTP clients
- telemetry exporters
- local buffers or caches

Recommended split:

- `beforeStart`
  - connect or warm up resources that must exist before the worker is considered started
- `afterStart`
  - emit readiness side effects after route loops are active
- `beforeStop`
  - signal shutdown or flip local state while handlers may still drain
- `afterStop`
  - close resources after the route has fully drained

Keep destructive cleanup in `afterStop`, not `beforeStop`. `beforeStop` runs after polling is halted but before in-flight work has necessarily finished.

## Queue and topic resolution

Prefer preloaded mappings in production.

```ts
const queueResolver = new SqsQueueUrlResolver(transportClient, {
  preload: {
    jobs: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
  },
  allowNetworkLookup: false,
});
```

`allowNetworkLookup: false` makes missing configuration fail during startup rather than discovering queues dynamically at runtime.

Use network lookup only when that behavior is deliberate and monitored.

When a consumer must resolve an existing queue name in another AWS account, use the typed overload and typed preload entries:

```ts
const queueResolver = new SqsQueueUrlResolver(transportClient, {
  preloadEntries: [
    {
      queue: 'audit-queue',
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/210987654321/audit-queue',
      ownerAccountId: '210987654321',
    },
  ],
  allowNetworkLookup: false,
});

const auditQueueUrl = await queueResolver.resolve({
  queue: 'audit-queue',
  ownerAccountId: '210987654321',
});
```

Use the typed owner-account field only with queue names. Queue URLs and ARNs already encode the account and should be passed directly.

## Worker manifests

A manifest decides which registered routes a worker process activates.

```ts
const manifest = parseSqsWorkerServiceManifest({
  defaults: { concurrency: 8 },
  routes: {
    jobs: { queue: 'jobs' },
    audit: { enabled: false },
  },
});
```

Rules:

- a manifest route must match a registered route name;
- enabled routes need a queue binding in either the manifest or the route definition;
- disabled routes are ignored;
- manifest route config overrides route config.

Use manifests to run multiple worker process shapes from the same route catalog without dynamic handler loading.

## Health and readiness

Use `getSnapshot()` for process-local health.

```ts
const snapshot = host.getSnapshot();

const ready = snapshot.started && !snapshot.stopping && snapshot.routes.every((route) => route.running);
```

A basic readiness check should consider:

- host started;
- host not stopping;
- expected route count active;
- no recent persistent polling failures;
- in-flight count below an application-defined saturation threshold.
- buffered count below an application-defined backlog threshold for that worker shape.

Do not use snapshots as the only source of business-level delivery assurance. They are runtime process state, not end-to-end message processing state.

## Metrics, traces, and scaling

The runtime emits process-local events and snapshots. The recommended path is:

1. use `@idenstra/messaging-runtime/observability` to map those events into OTEL metrics and worker spans;
2. use AWS-native queue metrics for queue-depth and oldest-message-age signals;
3. derive scaling decisions from queue pressure first, then use runtime metrics as health/saturation guardrails.

The full OTEL and SigNoz wiring guidance lives in [`OBSERVABILITY.md`](OBSERVABILITY.md). A compile-checked example also exists at [`../examples/observability/otel-signoz-worker.ts`](../examples/observability/otel-signoz-worker.ts).

`onEvent` remains the lowest-level hook and can still be mapped directly when a consumer does not use the OTEL helper surface.

```ts
const host = new SqsWorkerServiceHost({
  client: runtimeClient,
  queueResolver,
  manifest,
  managerOptions: {
    onEvent: (event) => {
      metrics.increment(`messaging_runtime.${event.type}`, {
        route: event.routeName,
      });
    },
  },
  routes,
});
```

Recommended counters:

- messages received;
- handler starts, successes, failures, and timeouts;
- deletes and keeps;
- polling failures;
- batched delete failures;
- individual delete retry failures;
- pre-dispatch visibility failures;
- buffered-message drops;
- heartbeat successes and failures;
- late settlements;
- buffered depth from snapshots or OTEL observable gauges;

Recommended alerting:

- repeated polling failures;
- sustained handler failures;
- sustained timeout count;
- repeated delete-batch failures;
- repeated individual delete failures;
- repeated pre-dispatch visibility failures;
- repeated buffered-message drops;
- heartbeat failures;
- late settlements after abandon timeout;
- rising in-flight count with low success count;
- queue age and dead-letter queue depth from AWS metrics.
- failed or stuck native DLQ redrive tasks.

Recommended scaling signals:

- backlog per worker/task, not raw queue depth alone;
- oldest visible message age for latency-sensitive queues;
- runtime in-flight saturation from `getSnapshot()` or OTEL observable gauges;
- runtime buffered depth from `getSnapshot()` or OTEL observable gauges when hot queues are expected to stay prefetched;
- failure and timeout rate as scale-in guardrails, not as the only scale-out trigger.

## Idempotency and duplicates

SQS is at-least-once. Duplicate processing is possible.

The runtime does not provide idempotency storage. Consumers should implement idempotency in their domain layer when duplicate processing is unsafe.

At minimum, production consumers should define:

- idempotency key strategy;
- duplicate write behavior;
- poison-message handling;
- dead-letter queue redrive policy;
- max receive count;
- visibility timeout sizing;
- whether failure should delete or keep.

## Timeout selection

Use `cooperative` when correctness is more important than freeing worker capacity quickly.

Use `abandon` only when:

- the handler may hang indefinitely;
- duplicate processing is acceptable;
- the message should not be deleted after timeout finalization;
- late settlement is monitored.

Handlers should observe `abortSignal`.

```ts
handle: async ({ abortSignal }) => {
  abortSignal.throwIfAborted();
  await doWork({ signal: abortSignal });
};
```

## Testing without AWS by default

The runtime is designed around small client interfaces, so unit and contract tests can use fake clients.

```ts
class FakeSqsRuntimeClient {
  async receiveMessage() {
    return { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: '{"ok":true}' }] };
  }

  async deleteMessage() {}

  async deleteMessageBatch() {
    return { Successful: [], Failed: [] };
  }

  async changeMessageVisibility() {}
}
```

Default repository verification must not require live AWS or Docker. Use the optional LocalStack lane when a change needs end-to-end proof against the built package output:

```bash
make verify-localstack
npm run e2e:localstack -- --suite runtime,publishers
```

The full local testing story, suite names, prerequisites, and emulator boundaries live in [`TESTING.md`](TESTING.md).

When LocalStack is green but the question is still about real AWS SNS/SQS behavior, escalate to the optional live AWS smoke lane:

```bash
make verify-aws-smoke
```

The public self-test path, fixture-safety rules, teardown posture, suite names, manual GitHub workflow usage, and release-time AWS smoke gate live in [`AWS_SMOKE.md`](AWS_SMOKE.md).

## Queue operations and DLQ recovery

Use the read-only discovery and queue-ops helpers for operational inspection and native SQS redrive:

- `SqsQueueDiscovery.listQueues(...)`
- `SnsTopicDiscovery.listTopics(...)`
- `SqsQueueInspector.inspectQueue(...)`
- `SqsQueueInspector.listDeadLetterSourceQueues(...)`
- `SqsDlqRedriveManager.listRedriveTasks(...)`
- `SqsDlqRedriveManager.startRedrive(...)`
- `SqsDlqRedriveManager.cancelRedrive(...)`
- `SqsMessageBatchOperator.deleteMessages(...)`
- `SqsMessageBatchOperator.changeMessageVisibility(...)`

These helpers intentionally stop at the queue-operation boundary:
- read-only queue and topic discovery are package-owned;
- queue inspection is package-owned;
- native SQS DLQ redrive is package-owned;
- transport-level SQS batch message operations are package-owned;
- manual message-level replay remains consumer-owned.

Discovery boundaries stay explicit:
- `ListQueues` remains same-account and same-region because that is the native AWS boundary;
- cross-account queue resolution is supported only for explicit `GetQueueUrl` name lookups;
- topic discovery remains read-only and does not create, tag, or subscribe topics.

This boundary is deliberate. Manual replay needs consumer-domain rules for:
- idempotency;
- payload validation;
- destination selection;
- safe mutation order;
- auditability and rollback.

Start from the consumer-owned example script in [`../examples/queue-ops/native-dlq-redrive.ts`](../examples/queue-ops/native-dlq-redrive.ts) and keep any message-level replay logic in the consuming system, not in the shared library.

## Nest adapter

Use `@idenstra/messaging-runtime/nest` only when the worker already runs inside Nest.

The Nest adapter provides:

- lifecycle wiring;
- logger bridging.

It does not provide:

- different queue semantics;
- higher throughput;
- different retry behavior;
- a dependency on Nest in the framework-agnostic runtime path.

## Production adoption checklist

This is the runtime-facing checklist. For the broader rollout sequence, read [`ADOPTION.md`](ADOPTION.md).

Before a worker uses this package in production, confirm:

- queue names, URLs, or ARNs are configured explicitly;
- network lookup policy is intentional;
- visibility timeout exceeds expected handler duration or heartbeats are enabled;
- handler timeout policy is documented;
- failure ack policy is documented per route;
- idempotency and DLQ behavior are owned by the consumer;
- DLQ inspection and native redrive use a documented operator path;
- manual replay, if it exists at all, is owned and guarded in the consumer application;
- runtime events are mapped to metrics;
- W3C trace propagation is either intentionally enabled or intentionally omitted;
- raw SNS -> SQS delivery is enabled if trace attributes must survive SNS fanout into worker queues;
- queue depth, oldest message age, and DLQ depth are monitored;
- autoscaling uses queue-aware metrics rather than CPU-only policies;
- shutdown behavior is tested in the service runtime.
