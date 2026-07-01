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
- route-level decode, handler, timeout, and failure handling
- explicit ack policy: delete the message or keep it for SQS redelivery
- runtime events and snapshots for health and observability
- manifest-driven worker host bootstrap for app-owned worker processes
- SNS-over-SQS and plain SQS JSON decoding helpers
- cached SQS queue URL and SNS topic ARN resolvers
- JSON SQS/SNS publishers, including SQS batch publishing
- queue inspection helpers and native SQS DLQ redrive task management
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

## Documentation order

Read the docs in this order:

1. [`docs/README.md`](docs/README.md) - documentation map
2. [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) - first worker and publisher examples
3. [`docs/FEATURES.md`](docs/FEATURES.md) - supported feature set and non-goals
4. [`docs/RUNTIME_SEMANTICS.md`](docs/RUNTIME_SEMANTICS.md) - polling, ack, timeout, and shutdown behavior
5. [`docs/OPERATIONS.md`](docs/OPERATIONS.md) - configuration, observability, testing, and Nest usage
6. [`docs/QUEUE_OPERATIONS.md`](docs/QUEUE_OPERATIONS.md) - queue inspection, native DLQ redrive, and safe replay boundaries
7. [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) - performance posture and benchmark plan
8. [`docs/PUBLIC_RELEASE.md`](docs/PUBLIC_RELEASE.md) - work required before making the repo public

Contributor and governance docs remain available under [`AGENTS.md`](AGENTS.md), [`WORKFLOW.md`](WORKFLOW.md), and `docs/`.
For the repo harness and contribution workflow, start with [`docs/HARNESS.md`](docs/HARNESS.md) and [`WORKFLOW.md`](WORKFLOW.md).

## Quick start

A minimal framework-agnostic worker uses one AWS SDK `SQSClient` wrapped once by `AwsSqsAdapter`.

The runtime has a built-in JSON body decoder for SQS messages. This example still provides an explicit `decodePayload` so the handler is strongly typed and the snippet stays copy-pasteable.

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSqsAdapter,
  decodeSqsJsonBody,
  SqsQueueUrlResolver,
  SqsWorkerServiceHost,
  parseSqsWorkerServiceManifest,
  runSqsWorkerServiceUntilSignal,
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
    {
      name: 'jobs',
      decodePayload: ({ body }) => decodeSqsJsonBody<JobMessage>(body),
      handle: async ({ payload, message, heartbeat }) => {
        console.log('processing message', message.messageId, payload);
        await heartbeat();
      },
    },
  ],
});

await runSqsWorkerServiceUntilSignal(host);
```

For SNS notifications delivered through SQS, decode the SNS envelope in the route:

```ts
import { decodeSnsNotificationJson } from '@idenstra/messaging-runtime';

type UserCreated = { userId: string };

const route = {
  name: 'user-created',
  decodePayload: ({ body }) => decodeSnsNotificationJson<UserCreated>(body).payload,
  handle: async ({ payload }: { payload: UserCreated }) => {
    console.log(payload.userId);
  },
};
```

For operator queue work, use the queue-ops helpers rather than ad hoc AWS calls:

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { AwsSqsAdapter, SqsDlqRedriveManager, SqsQueueInspector } from '@idenstra/messaging-runtime';

const awsSqs = new SQSClient({ region: 'us-east-1' });
const sqsAdapter = new AwsSqsAdapter(awsSqs);
const inspector = new SqsQueueInspector(sqsAdapter);
const redriveManager = new SqsDlqRedriveManager(sqsAdapter, { queueInspector: inspector });

const queueSnapshot = await inspector.inspectQueue('jobs-dlq');
const redriveTasks = await redriveManager.listRedriveTasks({ sourceQueue: 'jobs-dlq' });
```

Manual message-level replay remains consumer-owned because idempotency and safety rules depend on the consuming system. See [`docs/QUEUE_OPERATIONS.md`](docs/QUEUE_OPERATIONS.md).

## Development

```bash
npm ci
npm test
npm run build
make audit
make verify-fast
make verify
```

The default verification path is deterministic and does not require live AWS.

## Release and compatibility

The package is pre-`1.0`. While it stays in the `0.x` range, consumers should pin exact versions and treat minor releases as the main upgrade boundary.

Before a public release, the package needs public license metadata, public registry posture, public-facing contribution/security docs, benchmark evidence, and a release checklist closeout. See [`docs/PUBLIC_RELEASE.md`](docs/PUBLIC_RELEASE.md).

Release policy and operator flow are documented in [`docs/RELEASES.md`](docs/RELEASES.md).
Consumer versioning and supported-surface expectations are documented in [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).
