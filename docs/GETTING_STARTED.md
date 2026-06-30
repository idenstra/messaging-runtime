# Getting started

This guide shows the smallest useful setup for a plain Node.js worker that consumes SQS messages, plus the common SNS-over-SQS and publish paths.

## Prerequisites

- Node.js `>=24`
- TypeScript
- `@aws-sdk/client-sqs`
- `@aws-sdk/client-sns` when publishing to SNS
- access to the package registry currently used by `@idenstra/messaging-runtime`

The package is not yet public-ready. Public installation guidance should be updated when `docs/PUBLIC_RELEASE.md` is complete.

## Install

Current internal installation expects the configured `@idenstra` registry.

```bash
npm install @idenstra/messaging-runtime @aws-sdk/client-sqs @aws-sdk/client-sns
```

## Create a worker

The worker runtime and transport helpers are intentionally separate:

- `AwsSqsRuntimeClient` owns worker-loop operations: receive, delete, and visibility changes.
- `AwsSqsTransportClient` owns queue URL resolution and SQS publishing.

Both wrappers can share the same AWS SDK `SQSClient` instance.

The runtime has a built-in JSON body decoder for SQS messages. The example below still provides an explicit `decodePayload` so the handler payload is strongly typed and the snippet is copy-pasteable as written.

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSqsRuntimeClient,
  AwsSqsTransportClient,
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

const runtimeClient = new AwsSqsRuntimeClient(awsSqs);
const transportClient = new AwsSqsTransportClient(awsSqs);

const queueResolver = new SqsQueueUrlResolver(transportClient, {
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
    heartbeatIntervalMs: 20_000,
  },
  routes: {
    jobs: { queue: 'jobs' },
  },
});

const host = new SqsWorkerServiceHost({
  client: runtimeClient,
  queueResolver,
  manifest,
  routes: [
    {
      name: 'jobs',
      decodePayload: ({ body }) => decodeSqsJsonBody<JobMessage>(body),
      handle: async ({ payload, heartbeat }) => {
        await processJob(payload.jobId);
        await heartbeat();
      },
    },
  ],
});

await runSqsWorkerServiceUntilSignal(host);

async function processJob(jobId: string): Promise<void> {
  console.log('processed job', jobId);
}
```

## Consume SNS notifications from SQS

Use `decodeSnsNotificationJson` when an SQS queue is subscribed to an SNS topic.

```ts
import { decodeSnsNotificationJson } from '@idenstra/messaging-runtime';

type UserCreated = {
  userId: string;
};

const userCreatedRoute = {
  name: 'user-created',
  decodePayload: ({ body }: { body?: string }) => decodeSnsNotificationJson<UserCreated>(body).payload,
  handle: async ({ payload }: { payload: UserCreated }) => {
    console.log('user created', payload.userId);
  },
};
```

The decoder returns both the SNS envelope and the parsed JSON payload when the envelope is needed.

```ts
const { envelope, payload } = decodeSnsNotificationJson<UserCreated>(messageBody);
console.log(envelope.TopicArn, payload.userId);
```

## Publish to SQS

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { AwsSqsTransportClient, SqsPublisher, SqsQueueUrlResolver } from '@idenstra/messaging-runtime';

const awsSqs = new SQSClient({ region: 'us-east-1' });
const transportClient = new AwsSqsTransportClient(awsSqs);
const queueResolver = new SqsQueueUrlResolver(transportClient, {
  preload: {
    jobs: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
  },
});

const publisher = new SqsPublisher(transportClient, queueResolver);

await publisher.sendJson({
  queue: 'jobs',
  payload: { jobId: 'job-1' },
});
```

## Publish a batch to SQS

`sendJsonBatch` chunks entries into SQS-compatible batches of ten.

```ts
await publisher.sendJsonBatch({
  queue: 'jobs',
  entries: Array.from({ length: 25 }, (_, index) => ({
    id: `job-${index}`,
    payload: { jobId: `job-${index}` },
  })),
});
```

The result reports successes and failures keyed by the caller-provided entry IDs.

## Publish to SNS

```ts
import { SNSClient } from '@aws-sdk/client-sns';
import { AwsSnsTransportClient, SnsPublisher, SnsTopicArnResolver } from '@idenstra/messaging-runtime';

const awsSns = new SNSClient({ region: 'us-east-1' });
const transportClient = new AwsSnsTransportClient(awsSns);
const topicResolver = new SnsTopicArnResolver(transportClient, {
  preload: {
    events: 'arn:aws:sns:us-east-1:123456789012:events',
  },
});

const publisher = new SnsPublisher(transportClient, topicResolver);

await publisher.publishJson({
  topic: 'events',
  payload: { eventType: 'USER_CREATED', userId: 'user-1' },
});
```

## Next steps

- Read [`FEATURES.md`](FEATURES.md) for the supported surface.
- Read [`RUNTIME_SEMANTICS.md`](RUNTIME_SEMANTICS.md) before setting ack, timeout, heartbeat, or concurrency policies.
- Read [`OPERATIONS.md`](OPERATIONS.md) before production adoption.
