# messaging-runtime

`messaging-runtime` is a small TypeScript runtime for building Amazon SNS/SQS worker services in Node.js.

It is intentionally **SNS/SQS-only**. It does not try to abstract Kafka, RabbitMQ, Redis streams, or any other broker. The package should stay narrow enough to be easy to reason about, easy to test, and cheap to run.

## Status

- Package: `@idenstra/messaging-runtime`
- Runtime: Node.js `>=24`
- Language: TypeScript
- Current version: pre-`1.0`
- Current registry posture: internal GitHub Packages release flow
- Public-release posture: not complete until the checklist in [`docs/PUBLIC_RELEASE.md`](docs/PUBLIC_RELEASE.md) is closed

## What it provides

- SQS worker runtime with long polling, bounded concurrency, graceful shutdown, and visibility heartbeats
- explicit finite-run execution for idle drain and bounded maintenance passes
- optional FIFO `ReceiveRequestAttemptId` support with manifest-safe mode selection and route-owned custom token generation
- explicit `sqsJsonRoute(...)`, `snsJsonQueueRoute(...)`, and `sqsStringRoute(...)` factories for the most common worker shapes
- route-level decode, handler, timeout, and failure handling
- shared route lifecycle hooks for startup, stop-signal, and cleanup
- explicit ack policy: delete the message or keep it for SQS redelivery
- runtime events and snapshots for health and observability
- manifest-driven worker host bootstrap for app-owned worker processes
- OpenTelemetry metrics and tracing helpers through `@idenstra/messaging-runtime/observability`
- SNS-over-SQS and plain SQS JSON decoding helpers
- cached SQS queue URL and SNS topic ARN resolvers, including typed cross-account SQS name resolution
- JSON, explicit string, and serializer-based SQS/SNS publishers, plus explicit SNS structured topic publishing
- thin forwarding handlers for fixed queue-to-queue and queue-to-topic relay flows
- service-native SNS/SQS message-attribute builders plus optional local publish size validation
- SQS batch message operations for delete and visibility changes
- read-only queue/topic discovery, queue inspection helpers, and native SQS DLQ redrive task management
- optional Nest lifecycle and logger adapter through `@idenstra/messaging-runtime/nest`

## What it deliberately does not provide

- generic broker/provider abstractions
- business handlers or application message contracts
- environment, secrets, or config-file loading
- dynamic handler discovery
- generic manual message replay helpers
- live AWS requirements for the default test harness

Consumer applications own configuration, dependency wiring, process entrypoints, and domain behavior. This package owns reusable SNS/SQS mechanics.

Supported imports are intentionally narrow:

- `@idenstra/messaging-runtime`
- `@idenstra/messaging-runtime/core`
- `@idenstra/messaging-runtime/nest`
- `@idenstra/messaging-runtime/observability`

## Documentation order

Read the docs in this order:

1. [`docs/README.md`](docs/README.md) - documentation map
2. [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) - first worker and publisher examples
3. [`docs/FEATURES.md`](docs/FEATURES.md) - supported feature set and non-goals
4. [`docs/RUNTIME_SEMANTICS.md`](docs/RUNTIME_SEMANTICS.md) - polling, ack, timeout, and shutdown behavior
5. [`docs/OPERATIONS.md`](docs/OPERATIONS.md) - configuration, observability, testing, and Nest usage
6. [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) - OTEL metrics, W3C tracing, SigNoz wiring, and autoscaling guidance
7. [`docs/QUEUE_OPERATIONS.md`](docs/QUEUE_OPERATIONS.md) - queue inspection, native DLQ redrive, and safe replay boundaries
8. [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) - performance posture and benchmark plan
9. [`docs/PUBLIC_RELEASE.md`](docs/PUBLIC_RELEASE.md) - work required before making the repo public

Contributor and governance docs remain available under [`AGENTS.md`](AGENTS.md), [`WORKFLOW.md`](WORKFLOW.md), and `docs/`.
For the repo harness and contribution workflow, start with [`docs/HARNESS.md`](docs/HARNESS.md) and [`WORKFLOW.md`](WORKFLOW.md).

## Quick start

A minimal framework-agnostic worker uses one AWS SDK `SQSClient` wrapped once by `AwsSqsAdapter`.

For the common worker shapes, prefer the explicit route factories. Manual route objects remain available when you need a custom decoder or a different payload contract.

```ts
import { randomUUID } from 'node:crypto';

import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSqsAdapter,
  SqsQueueUrlResolver,
  SqsWorkerServiceHost,
  parseSqsWorkerServiceManifest,
  runSqsWorkerServiceUntilSignal,
  sqsJsonRoute,
} from '@idenstra/messaging-runtime';

type JobMessage = {
  jobId: string;
};

const awsSqs = new SQSClient({ region: 'us-east-1' });
const sqsAdapter = new AwsSqsAdapter(awsSqs);

const queueResolver = new SqsQueueUrlResolver(sqsAdapter, {
  preload: {
    jobs: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
  },
  allowNetworkLookup: false,
});

const manifest = parseSqsWorkerServiceManifest({
  defaults: {
    concurrency: 8,
    waitTimeSeconds: 20,
    visibilityTimeoutSeconds: 60,
  },
  routes: {
    jobs: { queue: 'jobs' },
  },
});

const host = new SqsWorkerServiceHost({
  client: sqsAdapter,
  queueResolver,
  manifest,
  routes: [
    sqsJsonRoute<JobMessage>({
      name: 'jobs',
      handle: async ({ payload, message, heartbeat }) => {
        console.log('processing message', message.messageId, payload);
        await heartbeat();
      },
    }),
  ],
});

await runSqsWorkerServiceUntilSignal(host);
```

FIFO consumers can opt into `ReceiveRequestAttemptId` without pushing callback logic into manifests. Policy stays serializable; custom token generation stays in route code:

```ts
const manifest = parseSqsWorkerServiceManifest({
  receiveDefaults: {
    requestAttemptIdMode: 'runtime',
  },
  routes: {
    jobs: {
      queue: 'jobs',
      receive: {
        requestAttemptIdMode: 'custom',
      },
    },
  },
});

const host = new SqsWorkerServiceHost({
  client: sqsAdapter,
  queueResolver,
  manifest,
  routes: [
    {
      name: 'jobs',
      decodePayload: ({ body }) => decodeSqsJsonBody<JobMessage>(body),
      receive: {
        createRequestAttemptId: () => randomUUID(),
      },
      handle: async ({ payload }) => {
        console.log('processing FIFO job', payload.jobId);
      },
    },
  ],
});
```

Use this only on FIFO queues. The runtime reuses a pending token only across failed `receiveMessage` retries, clears it after any successful receive (including empty receives), and replaces it after the AWS five-minute window expires.

For SNS notifications delivered through SQS, decode the SNS envelope in the route:

```ts
import { snsJsonQueueRoute } from '@idenstra/messaging-runtime';

type UserCreated = { userId: string };

const route = snsJsonQueueRoute<UserCreated>({
  name: 'user-created',
  handle: async ({ payload }) => {
    console.log(payload.userId);
  },
});
```

When the handler also needs parsed SNS envelope metadata, switch the helper into `envelope+payload` mode:

```ts
const envelopeRoute = snsJsonQueueRoute<UserCreated>({
  name: 'user-created-envelope',
  messageShape: 'envelope+payload',
  handle: async ({ payload }) => {
    console.log(payload.envelope.TopicArn, payload.payload.userId);
  },
});
```

For simple relay workers, compose a route factory with one of the forwarding helpers instead of writing custom publish glue:

```ts
import {
  AwsSnsAdapter,
  SnsPublisher,
  sqsJsonRoute,
  sqsJsonToTopicForwardHandler,
} from '@idenstra/messaging-runtime';
import { SNSClient } from '@aws-sdk/client-sns';

type EventPayload = {
  eventId: string;
  eventType: string;
};

const topicPublisher = new SnsPublisher(new AwsSnsAdapter(new SNSClient({ region: 'us-east-1' })));

const relayRoute = sqsJsonRoute<EventPayload>({
  name: 'event-relay',
  queue: 'event-relay',
  handle: sqsJsonToTopicForwardHandler({
    publisher: topicPublisher,
    topic: 'event-stream',
    copyMessageAttributes: true,
    subject: ({ payload }) => payload.eventType,
  }),
});
```

The forwarding helpers keep destinations fixed per helper instance. Use a normal custom handler when the flow needs dynamic routing, workflow behavior, or domain-level orchestration.

Route-owned resources can use the shared lifecycle surface without adding manifest-only hooks or framework coupling:

```ts
const route = {
  name: 'jobs',
  lifecycle: {
    beforeStart: async () => {
      await pool.connect();
    },
    beforeStop: () => {
      console.log('shutdown requested; handlers may still drain');
    },
    afterStop: async () => {
      await pool.close();
    },
  },
  handle: async ({ payload }) => {
    console.log(payload.jobId);
  },
};
```

`beforeStop` is the stop-signal hook. Use `afterStop` for destructive cleanup after the route has drained.

Finite-run execution is available when the worker should stop on its own instead of waiting for a process signal:

```ts
const manager = new SqsWorkerManager(sqsAdapter, {
  finiteRunDefaults: { idleEmptyReceiveWaves: 2 },
});

manager.register(
  sqsJsonRoute<JobMessage>({
    name: 'jobs',
    queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
    handle: async ({ payload }) => {
      console.log(payload.jobId);
    },
  }),
);

await manager.runUntilIdle();
await manager.runBounded({ maxHandledMessagesPerRoute: 100 });
```

Use `runUntilIdle(...)` for drain-until-quiet maintenance runs and `runBounded(...)` for a capped per-route maintenance pass. Neither mode guarantees global queue emptiness when other producers may still publish concurrently.

For operator queue work, use the queue-ops helpers rather than ad hoc AWS calls:

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSqsAdapter,
  SqsDlqRedriveManager,
  SqsQueueDiscovery,
  SqsQueueInspector,
} from '@idenstra/messaging-runtime';

const awsSqs = new SQSClient({ region: 'us-east-1' });
const sqsAdapter = new AwsSqsAdapter(awsSqs);
const discovery = new SqsQueueDiscovery(sqsAdapter);
const inspector = new SqsQueueInspector(sqsAdapter);
const redriveManager = new SqsDlqRedriveManager(sqsAdapter, { queueInspector: inspector });

const queuePage = await discovery.listQueues({ namePrefix: 'jobs', pageSize: 25 });
const queueSnapshot = await inspector.inspectQueue('jobs-dlq');
const redriveTasks = await redriveManager.listRedriveTasks({ sourceQueue: 'jobs-dlq' });
```

When a consumer needs an existing queue name from another AWS account, resolve it with the typed overload instead of inventing a second resolver API:

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { AwsSqsAdapter, SqsQueueUrlResolver } from '@idenstra/messaging-runtime';

const awsSqs = new SQSClient({ region: 'us-east-1' });
const sqsAdapter = new AwsSqsAdapter(awsSqs);
const queueResolver = new SqsQueueUrlResolver(sqsAdapter);

const auditQueueUrl = await queueResolver.resolve({
  queue: 'audit-queue',
  ownerAccountId: '210987654321',
});
```

Manual message-level replay remains consumer-owned because idempotency and safety rules depend on the consuming system. See [`docs/QUEUE_OPERATIONS.md`](docs/QUEUE_OPERATIONS.md).

For OTEL metrics, W3C trace propagation, and a SigNoz-backed worker example, use the dedicated observability subpath and start with [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) plus [`examples/observability/otel-signoz-worker.ts`](examples/observability/otel-signoz-worker.ts).

For route lifecycle examples, see:

- [`examples/worker-lifecycle/direct-manager-lifecycle.ts`](examples/worker-lifecycle/direct-manager-lifecycle.ts)
- [`examples/worker-lifecycle/service-host-lifecycle.ts`](examples/worker-lifecycle/service-host-lifecycle.ts)

For transport-level publisher work outside the worker core, use:

- `SqsPublisher.sendJson(...)`, `sendString(...)`, `sendSerialized(...)`, and their batch variants
- `SnsPublisher.publishJson(...)`, `publishString(...)`, `publishSerialized(...)`, and their batch variants
- `SnsPublisher.publishStructuredJson(...)` when you intentionally need SNS `MessageStructure: 'json'`
- `sqsStringAttribute(...)`, `snsStringArrayAttribute(...)`, and the other service-native attribute builders when you want typed message-attribute maps

These helpers keep queue/topic resolution, AWS 10-entry chunking, and keyed aggregate success/failure results inside the package instead of duplicating them in each consumer.

## Development

```bash
npm ci
npm test
npm run build
npm run benchmark
npm run benchmark:compare -- --base /tmp/benchmark-main.json --candidate /tmp/benchmark-branch.json
make audit
make verify-fast
make verify
```

The default verification path is deterministic and does not require live AWS.
For throughput-sensitive changes, prefer same-machine `benchmark:ci` plus `benchmark:compare` proof over comparing against a checked-in baseline from another host.

## Release and compatibility

The package is pre-`1.0`. While it stays in the `0.x` range, consumers should pin exact versions and treat minor releases as the main upgrade boundary.

Before a public release, the package needs public license metadata, public registry posture, public-facing contribution/security docs, benchmark evidence, and a release checklist closeout. See [`docs/PUBLIC_RELEASE.md`](docs/PUBLIC_RELEASE.md).

Release policy and operator flow are documented in [`docs/RELEASES.md`](docs/RELEASES.md).
Consumer versioning and supported-surface expectations are documented in [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).
