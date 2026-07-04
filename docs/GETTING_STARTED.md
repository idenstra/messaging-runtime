# Getting started

This guide shows the smallest useful setup for a plain Node.js worker that consumes SQS messages, plus the common route-factory, SNS-over-SQS, publish, and transport-batch helper paths.

## Prerequisites

- Node.js `>=24`
- TypeScript
- `@aws-sdk/client-sqs`
- `@aws-sdk/client-sns` when publishing to SNS
- `@opentelemetry/api` when using `@idenstra/messaging-runtime/observability`
- access to the package registry currently used by `@idenstra/messaging-runtime`

The package is not yet public-ready. Public installation guidance should be updated when `docs/PUBLIC_RELEASE.md` is complete.

## Install

Current internal installation expects the configured `@idenstra` registry.

```bash
npm install @idenstra/messaging-runtime @aws-sdk/client-sqs @aws-sdk/client-sns
```

## Create a worker

Use one AWS SDK `SQSClient` wrapped by one `AwsSqsAdapter`.

The package still keeps runtime and transport interfaces separate internally, but normal consumer setup should not need two different SQS wrapper classes.

For the common worker shapes, prefer the explicit route factories. Manual route objects remain the escape hatch when you need a custom decoder or a different payload contract.

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
    heartbeatIntervalMs: 20_000,
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
      handle: async ({ payload, heartbeat }) => {
        await processJob(payload.jobId);
        await heartbeat();
      },
    }),
  ],
});

await runSqsWorkerServiceUntilSignal(host);

async function processJob(jobId: string): Promise<void> {
  console.log('processed job', jobId);
}
```

The factory keeps the common JSON route shape short while preserving the same host and manager contracts underneath.

## Use manual route objects when you need a custom decoder

If the payload contract is not one of the built-in common shapes, keep using a plain route object:

```ts
import { decodeSqsJsonBody } from '@idenstra/messaging-runtime';

const route = {
  name: 'jobs',
  decodePayload: ({ body }) => decodeSqsJsonBody<JobMessage>(body),
  handle: async ({ payload }: { payload: JobMessage }) => {
    await processJob(payload.jobId);
  },
};
```

## Add route-owned startup and cleanup hooks

Routes can capture local resources in closures and expose lifecycle hooks through `route.lifecycle`.

Use:
- `beforeStart` for startup work that must finish before the worker is considered started
- `afterStart` for readiness follow-up after route loops are active
- `beforeStop` for shutdown signaling while handlers may still drain
- `afterStop` for destructive cleanup after drain completes

```ts
class FakePool {
  async connect(): Promise<void> {}
  async close(): Promise<void> {}
}

const pool = new FakePool();

const host = new SqsWorkerServiceHost({
  client: sqsAdapter,
  queueResolver,
  manifest,
  routes: [
    {
      name: 'jobs',
      decodePayload: ({ body }) => decodeSqsJsonBody<JobMessage>(body),
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
        await processJob(payload.jobId);
      },
    },
  ],
});
```

The hooks are code-owned only. They do not exist in worker manifests.

If you use the core manager directly instead of the service host, the same lifecycle shape still applies:

```ts
const manager = new SqsWorkerManager(sqsAdapter);

manager.register<JobMessage>({
  name: 'jobs',
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
  decodePayload: ({ body }) => decodeSqsJsonBody<JobMessage>(body),
  lifecycle: {
    beforeStart: async () => {
      await pool.connect();
    },
    afterStop: async () => {
      await pool.close();
    },
  },
  handle: async ({ payload }) => {
    await processJob(payload.jobId);
  },
});
```

## Read typed SQS system attributes in handlers

Use `message.systemAttributes` when handler logic depends on receive count or receive timestamps. The raw AWS `message.attributes` string map still remains available for compatibility.

```ts
const route = {
  name: 'jobs',
  decodePayload: ({ body }) => decodeSqsJsonBody<JobMessage>(body),
  handle: async ({ payload, message }) => {
    const receiveCount = message.systemAttributes.ApproximateReceiveCount ?? 1;
    const firstReceiveAt = message.systemAttributes.ApproximateFirstReceiveTimestamp;

    if (receiveCount > 3) {
      throw new Error(`duplicate-risk threshold reached for ${payload.jobId}`);
    }

    console.log('first seen at', firstReceiveAt?.toISOString());
  },
};
```

Prefer the typed view for handler logic. Use raw `message.attributes` only when you need an unnormalized AWS field or exact raw compatibility.

## Opt into FIFO ReceiveRequestAttemptId support

`ReceiveRequestAttemptId` is an advanced FIFO-only receive feature. The package keeps the policy split explicit:

- manager defaults and worker-service manifests choose the serializable mode:
  - `off`
  - `runtime`
  - `custom`
- route code owns `createRequestAttemptId()` when `custom` mode is selected

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSqsAdapter,
  SqsQueueUrlResolver,
  SqsWorkerServiceHost,
  parseSqsWorkerServiceManifest,
  runSqsWorkerServiceUntilSignal,
} from '@idenstra/messaging-runtime';

const awsSqs = new SQSClient({ region: 'us-east-1' });
const sqsAdapter = new AwsSqsAdapter(awsSqs);
const queueResolver = new SqsQueueUrlResolver(sqsAdapter, {
  preload: {
    jobs: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs.fifo',
  },
  allowNetworkLookup: false,
});

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
      receive: {
        createRequestAttemptId: () => randomUUID(),
      },
      handle: async () => undefined,
    },
  ],
});

await runSqsWorkerServiceUntilSignal(host);
```

Key behavior:

- the feature is rejected locally on non-FIFO queues
- `runtime` mode generates the token inside the package
- `custom` mode calls the route callback only when a fresh token is needed
- successful receives clear the pending token, even when the receive is empty
- failed receive retries reuse the same token until the AWS five-minute window expires
- this improves transport-level retry continuity only; it does not change visibility timeout, redelivery, or duplicate-risk semantics

## Consume SNS notifications from SQS

Use `snsJsonQueueRoute(...)` when an SQS queue is subscribed to an SNS topic and the handler should consume the decoded SNS `Message` payload directly.

```ts
import { snsJsonQueueRoute } from '@idenstra/messaging-runtime';

type UserCreated = {
  userId: string;
};

const userCreatedRoute = snsJsonQueueRoute<UserCreated>({
  name: 'user-created',
  handle: async ({ payload }) => {
    console.log('user created', payload.userId);
  },
});
```

When the handler also needs parsed SNS envelope metadata, switch the helper into `envelope+payload` mode:

```ts
const userCreatedEnvelopeRoute = snsJsonQueueRoute<UserCreated>({
  name: 'user-created-envelope',
  messageShape: 'envelope+payload',
  handle: async ({ payload }) => {
    console.log(payload.envelope.TopicArn, payload.payload.userId);
  },
});
```

If you need a different SNS-over-SQS payload contract than those two modes, use a manual route object with `decodeSnsNotificationJson(...)` directly.

## Consume explicit string SQS bodies

Use `sqsStringRoute(...)` when the worker should receive the SQS body as a required string instead of JSON.

```ts
import { sqsStringRoute } from '@idenstra/messaging-runtime';

const rawRoute = sqsStringRoute({
  name: 'raw-jobs',
  handle: async ({ payload }) => {
    console.log('raw body', payload);
  },
});
```

## Publish to SQS

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { AwsSqsAdapter, SqsPublisher, SqsQueueUrlResolver } from '@idenstra/messaging-runtime';

const awsSqs = new SQSClient({ region: 'us-east-1' });
const sqsAdapter = new AwsSqsAdapter(awsSqs);
const queueResolver = new SqsQueueUrlResolver(sqsAdapter, {
  preload: {
    jobs: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
  },
});

const publisher = new SqsPublisher(sqsAdapter, queueResolver);

await publisher.sendJson({
  queue: 'jobs',
  payload: { jobId: 'job-1' },
});
```

## Publish explicit strings or custom-serialized payloads to SQS

Use `sendString(...)` when the body is already the exact string you want on the wire. Use `sendSerialized(...)` when the payload stays typed in your code but should serialize to something other than `JSON.stringify(...)`.

```ts
await publisher.sendString({
  queue: 'jobs',
  body: 'plain text body',
});

await publisher.sendSerialized({
  queue: 'jobs',
  payload: { jobId: 'job-1' },
  serialize: (payload) => `job:${payload.jobId}`,
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

The same chunking and result shape apply to `sendStringBatch(...)` and `sendSerializedBatch(...)`.

## Resolve a cross-account SQS queue by name

Use the typed resolver overload when the queue name lives in another AWS account but the current caller has permission to resolve it through `GetQueueUrl`.

```ts
const queueResolver = new SqsQueueUrlResolver(sqsAdapter, {
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

`ownerAccountId` is valid only for queue names. Queue URLs and ARNs already identify the account and should be passed without the extra field.

## Batch delete or extend visibility in SQS

Use `SqsMessageBatchOperator` when a consumer or operator flow needs transport-level batch delete or batch visibility updates outside the worker core.

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { AwsSqsAdapter, SqsMessageBatchOperator, SqsQueueUrlResolver } from '@idenstra/messaging-runtime';

const awsSqs = new SQSClient({ region: 'us-east-1' });
const sqsAdapter = new AwsSqsAdapter(awsSqs);
const queueResolver = new SqsQueueUrlResolver(sqsAdapter, {
  preload: {
    jobs: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
  },
});
const batchOperator = new SqsMessageBatchOperator(sqsAdapter, queueResolver);

await batchOperator.deleteMessages({
  queue: 'jobs',
  entries: [
    { id: 'message-1', receiptHandle: 'receipt-handle-1' },
    { id: 'message-2', receiptHandle: 'receipt-handle-2' },
  ],
});

await batchOperator.changeMessageVisibility({
  queue: 'jobs',
  entries: [
    { id: 'message-1', receiptHandle: 'receipt-handle-1', visibilityTimeoutSeconds: 60 },
    { id: 'message-2', receiptHandle: 'receipt-handle-2', visibilityTimeoutSeconds: 120 },
  ],
});
```

These helpers chunk automatically to the AWS 10-entry limit and normalize partial successes and failures by the caller-provided entry IDs.

## Build message attributes and enable optional size validation

Raw AWS `messageAttributes` maps are still accepted directly, but the package now exports service-native builders for the supported logical types.

```ts
import {
  snsStringArrayAttribute,
  snsStringAttribute,
  sqsNumberAttribute,
  sqsStringAttribute,
} from '@idenstra/messaging-runtime';

const sqsPublisher = new SqsPublisher(sqsAdapter, queueResolver, {
  sizeValidation: {
    maxBytes: 1_048_576,
  },
});

await sqsPublisher.sendJson({
  queue: 'jobs',
  payload: { jobId: 'job-1' },
  messageAttributes: {
    priority: sqsNumberAttribute(5),
    source: sqsStringAttribute('scheduler'),
  },
});

const snsPublisher = new SnsPublisher(snsAdapter, topicResolver, {
  sizeValidation: {
    maxBytes: 262_144,
  },
});

await snsPublisher.publishString({
  topic: 'events',
  message: 'user-created',
  messageAttributes: {
    channel: snsStringAttribute('email'),
    audiences: snsStringArrayAttribute(['ops', 'support']),
  },
});
```

`sizeValidation` is optional and off by default. When configured on the publisher, each send/publish call can still:

- inherit the publisher default
- override `maxBytes`
- disable the guard with `sizeValidation: false`

## Publish to SNS

```ts
import { SNSClient } from '@aws-sdk/client-sns';
import { AwsSnsAdapter, SnsPublisher, SnsTopicArnResolver } from '@idenstra/messaging-runtime';

const awsSns = new SNSClient({ region: 'us-east-1' });
const snsAdapter = new AwsSnsAdapter(awsSns);
const topicResolver = new SnsTopicArnResolver(snsAdapter, {
  preload: {
    events: 'arn:aws:sns:us-east-1:123456789012:events',
  },
});

const publisher = new SnsPublisher(snsAdapter, topicResolver);

await publisher.publishJson({
  topic: 'events',
  payload: { eventType: 'USER_CREATED', userId: 'user-1' },
});
```

## Publish explicit strings or custom-serialized payloads to SNS

The normal JSON helpers are convenience wrappers around SNS string-mode publishing. When you already have a final string body, use `publishString(...)`. When you need custom serialization, use `publishSerialized(...)`.

```ts
await publisher.publishString({
  topic: 'events',
  message: 'user-created',
});

await publisher.publishSerialized({
  topic: 'events',
  payload: { eventType: 'USER_CREATED', userId: 'user-1' },
  serialize: (payload) => `${payload.eventType}:${payload.userId}`,
});
```

## Publish a batch to SNS

`publishJsonBatch` keeps the same ergonomics as the SQS batch publisher: arbitrary caller entry counts in, 10-entry AWS chunking and normalized results out.

```ts
await publisher.publishJsonBatch({
  topic: 'events',
  entries: Array.from({ length: 25 }, (_, index) => ({
    id: `event-${index}`,
    payload: { eventId: `event-${index}`, eventType: 'USER_CREATED' },
    subject: `User created ${index}`,
  })),
});
```

SNS topic semantics are validated against the resolved topic type:
- standard topics may use `messageGroupId` as a fair-queue hint for SQS standard subscriptions
- standard topics must not use `messageDeduplicationId`
- FIFO topics require `messageGroupId`
- FIFO topics may omit `messageDeduplicationId` when topic-level content-based deduplication is intended

The same semantics apply to `publishString(...)`, `publishStringBatch(...)`, `publishSerialized(...)`, and `publishSerializedBatch(...)`.

## Publish a structured SNS topic message

Use the structured helpers only when you intentionally want SNS `MessageStructure: 'json'` protocol-specific publishing.

```ts
await publisher.publishStructuredJson({
  topic: 'events',
  payload: {
    default: 'User created',
    email: 'User created email body',
    sqs: '{"eventType":"USER_CREATED","userId":"user-1"}',
  },
});
```

`publishStructuredJson(...)` and `publishStructuredJsonBatch(...)` are intentionally separate from the normal JSON helpers:
- `publishJson(...)` and `publishJsonBatch(...)` send a normal SNS string body whose contents happen to come from `JSON.stringify(...)`
- `publishString(...)` / `publishStringBatch(...)` send your exact SNS string body as-is
- `publishSerialized(...)` / `publishSerializedBatch(...)` keep typed payloads in consumer code while letting you choose the string serializer
- the structured helpers set `MessageStructure: 'json'` and expect a protocol map with a required `default` string
- structured helpers reject `messageAttributes`; use the normal JSON, string, or serializer helpers when you need attribute-friendly SNS string-mode publishing

## Discover existing queues and topics

Use the read-only discovery helpers when a consumer or operator flow needs to enumerate already-existing resources without owning provisioning.

```ts
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSnsAdapter,
  AwsSqsAdapter,
  SnsTopicDiscovery,
  SqsQueueDiscovery,
} from '@idenstra/messaging-runtime';

const awsSqs = new SQSClient({ region: 'us-east-1' });
const awsSns = new SNSClient({ region: 'us-east-1' });
const sqsAdapter = new AwsSqsAdapter(awsSqs);
const snsAdapter = new AwsSnsAdapter(awsSns);
const queueDiscovery = new SqsQueueDiscovery(sqsAdapter);
const topicDiscovery = new SnsTopicDiscovery(snsAdapter);

const queuePage = await queueDiscovery.listQueues({
  namePrefix: 'jobs',
  pageSize: 25,
});

const topicPage = await topicDiscovery.listTopics({
  nextToken: undefined,
});
```

Both helpers are page-first:
- `SqsQueueDiscovery.listQueues(...)` always requests a bounded page and returns `nextToken` when AWS has more queues.
- `SnsTopicDiscovery.listTopics(...)` passes through the native `ListTopics` paging model.

## Add OTEL metrics and traces

The observability helpers live on a dedicated public subpath:

```ts
import {
  createOpenTelemetrySqsWorkerMetricsAdapter,
  withOpenTelemetrySqsWorkerTracing,
} from '@idenstra/messaging-runtime/observability';
```

Use an injected `Meter` to map runtime events into OTEL metrics:

```ts
const metrics = createOpenTelemetrySqsWorkerMetricsAdapter({
  meter,
  getSnapshot: () => host.getSnapshot(),
  staticAttributes: {
    service_name: 'worker-email',
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

Use an injected `Tracer` plus a W3C propagator to create consumer spans around route handlers:

```ts
const tracedRoute = withOpenTelemetrySqsWorkerTracing(route, {
  tracer,
  propagator,
});
```

For a full OTLP + SigNoz example, see [`../examples/observability/otel-signoz-worker.ts`](../examples/observability/otel-signoz-worker.ts) and [`OBSERVABILITY.md`](OBSERVABILITY.md).

## Inspect or redrive a DLQ

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { AwsSqsAdapter, SqsDlqRedriveManager, SqsQueueInspector } from '@idenstra/messaging-runtime';

const awsSqs = new SQSClient({ region: 'us-east-1' });
const sqsAdapter = new AwsSqsAdapter(awsSqs);
const inspector = new SqsQueueInspector(sqsAdapter);
const redriveManager = new SqsDlqRedriveManager(sqsAdapter, { queueInspector: inspector });

const queueSnapshot = await inspector.inspectQueue('jobs-dlq');
const sourceQueues = await inspector.listDeadLetterSourceQueues('jobs-dlq');
const redriveTasks = await redriveManager.listRedriveTasks({ sourceQueue: 'jobs-dlq' });
```

Use the example script in [`../examples/queue-ops/native-dlq-redrive.ts`](../examples/queue-ops/native-dlq-redrive.ts) as the starting point for a consumer-owned admin command.

Manual message-level replay remains outside this package. It must stay in the consuming system because idempotency, payload validation, and replay safety are domain-specific.

## Next steps

- Read [`FEATURES.md`](FEATURES.md) for the supported surface.
- Read [`RUNTIME_SEMANTICS.md`](RUNTIME_SEMANTICS.md) before setting ack, timeout, heartbeat, or concurrency policies.
- Read [`OPERATIONS.md`](OPERATIONS.md) before production adoption.
- Read [`OBSERVABILITY.md`](OBSERVABILITY.md) before wiring metrics, traces, or autoscaling.
- Read [`QUEUE_OPERATIONS.md`](QUEUE_OPERATIONS.md) before inspecting DLQs or starting a redrive task.
