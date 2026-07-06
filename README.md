# messaging-runtime

`messaging-runtime` is a TypeScript SNS/SQS worker runtime for Node.js services.

It stays deliberately narrow:

- SQS worker execution, shutdown, timeouts, heartbeats, and route lifecycle
- SNS/SQS publish, resolve, discovery, and queue-ops helpers
- native SQS DLQ redrive support
- OpenTelemetry-first metrics and tracing helpers

It does **not** try to flatten Kafka, RabbitMQ, Redis streams, or other transport families into one cross-transport abstraction. The point is to keep Amazon SNS/SQS behavior visible, testable, and cheap to operate.

## When to use it

Use this library when your service needs to:

- consume SQS queues with bounded concurrency and explicit ack behavior
- process SNS notifications delivered through SQS
- publish to SQS queues or SNS topics from shared application code
- inspect queues, list attached DLQ sources, and run native SQS redrive tasks
- expose runtime metrics and traces without baking an observability vendor into core code

## Start here

1. Read [`docs/QUICK_START.md`](docs/QUICK_START.md) for the shortest worker + publisher setup.
2. Use [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) as the cookbook for common worker, publisher, queue-ops, and observability recipes.
3. Follow [`docs/ADOPTION.md`](docs/ADOPTION.md) when embedding the library into a real service.

If you only want the docs map, go straight to [`docs/README.md`](docs/README.md).

## Quick start

The common setup is one AWS SDK `SQSClient`, wrapped once by `AwsSqsAdapter`, then used by a `SqsWorkerServiceHost`.

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSqsAdapter,
  SqsQueueUrlResolver,
  SqsWorkerServiceHost,
  parseSqsWorkerServiceManifest,
  runSqsWorkerServiceUntilSignal,
  sqsJsonRoute,
} from '@idenstra/messaging-runtime';

type JobMessage = { jobId: string };

const sqsAdapter = new AwsSqsAdapter(new SQSClient({ region: 'us-east-1' }));
const queueResolver = new SqsQueueUrlResolver(sqsAdapter, {
  preload: { jobs: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs' },
  allowNetworkLookup: false,
});

const host = new SqsWorkerServiceHost({
  client: sqsAdapter,
  queueResolver,
  manifest: parseSqsWorkerServiceManifest({
    routes: { jobs: { queue: 'jobs' } },
  }),
  routes: [
    sqsJsonRoute<JobMessage>({
      name: 'jobs',
      handle: async ({ payload }) => {
        console.log(payload.jobId);
      },
    }),
  ],
});

await runSqsWorkerServiceUntilSignal(host);
```

For the deeper first-run path, including a minimal publisher example, use [`docs/QUICK_START.md`](docs/QUICK_START.md).

## Supported imports

Supported imports are intentionally narrow:

- `@idenstra/messaging-runtime`
- `@idenstra/messaging-runtime/core`
- `@idenstra/messaging-runtime/nest`
- `@idenstra/messaging-runtime/observability`

Do not deep-import from `dist/` or internal source files.

## Documentation map

### Start

- [`docs/QUICK_START.md`](docs/QUICK_START.md) for the shortest first-run path
- [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) for recipes and common setups
- [`docs/USAGE.md`](docs/USAGE.md) for the conceptual mental model and terminology
- [`examples/`](examples) for compile-checked reference examples when you want fuller working shapes than the README snippets

### Build and operate

- [`docs/FEATURES.md`](docs/FEATURES.md) for supported capabilities and non-goals
- [`docs/RUNTIME_SEMANTICS.md`](docs/RUNTIME_SEMANTICS.md) for polling, ack, timeout, shutdown, and redelivery rules
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for configuration boundaries, readiness, scaling, and queue-ops ownership
- [`docs/QUEUE_OPERATIONS.md`](docs/QUEUE_OPERATIONS.md) for queue inspection and native DLQ redrive
- [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) for OTEL metrics, W3C trace propagation, and SigNoz wiring
- [`docs/ADOPTION.md`](docs/ADOPTION.md) for rolling the library into a real service safely
- [`docs/SECURITY.md`](docs/SECURITY.md) for package-facing security and safety boundaries

### Extend and verify

- [`docs/EXTENDING.md`](docs/EXTENDING.md) for supported extension seams
- [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) for pre-`1.0` consumer policy
- [`docs/TESTING.md`](docs/TESTING.md) for deterministic, LocalStack, observability-local, and live AWS proof lanes
- [`docs/AWS_SMOKE.md`](docs/AWS_SMOKE.md) for live AWS public self-test and maintainer workflow guidance
- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) for benchmark posture

### Release and reference

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for package boundaries and internal layout
- [`docs/RELIABILITY.md`](docs/RELIABILITY.md) for verification posture

## Proof lanes

The default repo gate stays deterministic:

```bash
make audit
HARNESS_STRICT=1 make verify-fast
```

Optional proof lanes stay separate:

- `make verify-localstack` for LocalStack-backed SNS/SQS end-to-end proof
- `make verify-observability` for repo-owned OTEL/SigNoz metrics and traces proof
- `make verify-aws-smoke` for real AWS feature-family smoke before publication or when emulator proof is not enough

See [`docs/TESTING.md`](docs/TESTING.md) for the suite boundaries and escalation rules.

## Current status

- package: `@idenstra/messaging-runtime`
- runtime baseline: Node.js `>=24`
- version posture: pre-`1.0`
- OSS posture work is summarized in [`docs/PUBLIC_RELEASE.md`](docs/PUBLIC_RELEASE.md)

## Deliberate non-goals

This package does not own:

- transport-neutral abstractions that hide SNS/SQS behavior
- business handlers or application payload contracts
- environment, secrets, or config-file loading
- queue/topic provisioning or IAM management APIs
- generic manual reprocessing tooling
- live AWS requirements in the default harness

Consumer applications still own configuration, dependency wiring, rollout, idempotency, and domain-safe recovery policy.

## Contributing

If you want to contribute to the repository, start with [`CONTRIBUTING.md`](CONTRIBUTING.md).

If you are using AI assistance or need the maintainer workflow rules directly, also read [`AGENTS.md`](AGENTS.md).

Maintainer workflow and release mechanics are documented in [`WORKFLOW.md`](WORKFLOW.md), [`docs/HARNESS.md`](docs/HARNESS.md), and [`docs/RELEASES.md`](docs/RELEASES.md).
