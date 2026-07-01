# Operations

`messaging-runtime` keeps operational ownership explicit. The library owns reusable SNS/SQS mechanics. The application owns deployment, configuration, idempotency, persistence, and alerting policy.

## Configuration ownership

The library does not read environment variables, files, or secrets. Load config in the application and pass concrete values into the runtime.

Recommended pattern:

1. load application config;
2. construct AWS SDK clients;
3. create runtime and transport adapters;
4. preload queue and topic mappings when known;
5. parse the worker manifest;
6. construct the host;
7. start the host through the signal runner or framework lifecycle.

This keeps the package deterministic and easy to test.

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

Do not use snapshots as the only source of business-level delivery assurance. They are runtime process state, not end-to-end message processing state.

## Metrics and logs

Use `onEvent` to map runtime events to metrics.

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
- heartbeat successes and failures;
- late settlements;
- polling failures from logs.

Recommended alerting:

- sustained handler failures;
- sustained timeout count;
- heartbeat failures;
- late settlements after abandon timeout;
- rising in-flight count with low success count;
- queue age and dead-letter queue depth from AWS metrics.
- failed or stuck native DLQ redrive tasks.

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

## Testing without AWS

The runtime is designed around small client interfaces, so tests can use fake clients.

```ts
class FakeSqsRuntimeClient {
  async receiveMessage() {
    return { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: '{"ok":true}' }] };
  }

  async deleteMessage() {}

  async changeMessageVisibility() {}
}
```

Default repository verification must not require live AWS. Live AWS or emulator-backed tests should be optional lanes.

## Queue operations and DLQ recovery

Use the queue-ops helpers for operational inspection and native SQS redrive:

- `SqsQueueInspector.inspectQueue(...)`
- `SqsQueueInspector.listDeadLetterSourceQueues(...)`
- `SqsDlqRedriveManager.listRedriveTasks(...)`
- `SqsDlqRedriveManager.startRedrive(...)`
- `SqsDlqRedriveManager.cancelRedrive(...)`
- `SqsMessageBatchOperator.deleteMessages(...)`
- `SqsMessageBatchOperator.changeMessageVisibility(...)`

These helpers intentionally stop at the queue-operation boundary:
- queue inspection is package-owned;
- native SQS DLQ redrive is package-owned;
- transport-level SQS batch message operations are package-owned;
- manual message-level replay remains consumer-owned.

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
- queue depth, oldest message age, and DLQ depth are monitored;
- shutdown behavior is tested in the service runtime.
