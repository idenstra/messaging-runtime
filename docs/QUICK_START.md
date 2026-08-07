# Quick start

This guide is the shortest path to embedding `@idenstra/messaging-runtime` in a Node.js service that needs an AWS SQS worker, an SNS over SQS consumer, or an SNS/SQS publisher.

If you want deeper recipes after the first worker is running, continue with [`GETTING_STARTED.md`](GETTING_STARTED.md). If you are adopting the library in a real service, continue with [`ADOPTION.md`](ADOPTION.md).

## Prerequisites

- Node.js `>=24`
- TypeScript
- `@aws-sdk/client-sqs`
- `@aws-sdk/client-sns` when publishing to SNS

The supported imports below are the stable `1.x` package surface. See [`COMPATIBILITY.md`](COMPATIBILITY.md) for the complete contract.

## Install

```bash
npm install @idenstra/messaging-runtime @aws-sdk/client-sqs @aws-sdk/client-sns
```

## Run one SQS worker

The common setup is:

1. create an AWS SDK `SQSClient`
2. wrap it once with `AwsSqsAdapter`
3. resolve queues through `SqsQueueUrlResolver`
4. register one or more routes through `SqsWorkerServiceHost`
5. run the host until a stop signal

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

Why this shape:

- one adapter instance can satisfy SQS runtime, transport, and queue ops needs
- route factories keep common worker shapes short without hiding the underlying runtime model
- `allowNetworkLookup: false` keeps queue resolution explicit in production-like setups

## Publish one message to SQS

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSqsAdapter,
  SqsPublisher,
  SqsQueueUrlResolver,
} from '@idenstra/messaging-runtime';

const sqsAdapter = new AwsSqsAdapter(new SQSClient({ region: 'us-east-1' }));
const queueResolver = new SqsQueueUrlResolver(sqsAdapter, {
  preload: { jobs: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs' },
  allowNetworkLookup: false,
});
const publisher = new SqsPublisher(sqsAdapter, queueResolver);

await publisher.sendJson({
  queue: 'jobs',
  payload: { jobId: 'job-123' },
});
```

Use `sendString(...)` when you already have a string body and `sendSerialized(...)` when you want typed payloads plus your own serializer.

## Supported imports

Stay on the supported surface:

- `@idenstra/messaging-runtime`
- `@idenstra/messaging-runtime/core`
- `@idenstra/messaging-runtime/nest`
- `@idenstra/messaging-runtime/observability`

Do not deep-import from `dist/` or internal source files.

## What next

Use the next doc that matches your goal:

- [`GETTING_STARTED.md`](GETTING_STARTED.md) for cookbook recipes:
  - SNS-over-SQS
  - route lifecycle
  - finite-run execution
  - publishers
  - queue ops
  - observability
- [`USAGE.md`](USAGE.md) for the conceptual model
- [`OPERATIONS.md`](OPERATIONS.md) for readiness, scaling, and idempotency boundaries
- [`ADOPTION.md`](ADOPTION.md) for service rollout guidance
- [`TESTING.md`](TESTING.md) for deterministic, LocalStack, observability-local, and live AWS proof lanes
