# Queue operations

`messaging-runtime` provides a queue-operations layer for inspection and native Amazon SQS dead-letter recovery. It does not provide generic message-level replay.

## Owned by the package

The package owns:
- queue inspection through `SqsQueueInspector`
- DLQ source-queue discovery through `ListDeadLetterSourceQueues`
- native SQS redrive task management through:
  - `StartMessageMoveTask`
  - `ListMessageMoveTasks`
  - `CancelMessageMoveTask`

The package does not own:
- manual receive-send-delete replay loops
- consumer idempotency storage
- domain payload validation rules
- business-specific replay guardrails

## Queue inspection

Use `SqsQueueInspector` when operators need normalized queue state without hand-assembling AWS SDK calls.

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { AwsSqsAdapter, SqsQueueInspector } from '@idenstra/messaging-runtime';

const awsSqs = new SQSClient({ region: 'us-east-1' });
const sqsAdapter = new AwsSqsAdapter(awsSqs);
const inspector = new SqsQueueInspector(sqsAdapter);

const queueSnapshot = await inspector.inspectQueue('jobs-dlq');
const sourceQueues = await inspector.listDeadLetterSourceQueues('jobs-dlq');
```

Inspection accepts queue name, queue URL, or queue ARN. The normalized queue snapshot includes:
- queue URL and ARN
- FIFO flag
- approximate visible, delayed, and in-flight counts
- visibility timeout
- retention period
- receive wait time
- delay seconds
- parsed `RedrivePolicy`
- parsed `RedriveAllowPolicy`
- raw attributes

## Native DLQ redrive

Use `SqsDlqRedriveManager` for the SQS-native DLQ recovery path.

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { AwsSqsAdapter, SqsDlqRedriveManager } from '@idenstra/messaging-runtime';

const awsSqs = new SQSClient({ region: 'us-east-1' });
const sqsAdapter = new AwsSqsAdapter(awsSqs);
const redriveManager = new SqsDlqRedriveManager(sqsAdapter);

const tasks = await redriveManager.listRedriveTasks({ sourceQueue: 'jobs-dlq' });
const redrive = await redriveManager.startRedrive({
  sourceQueue: 'jobs-dlq',
  maxMessagesPerSecond: 50,
});
```

Guardrails owned by the package:
- queue identifiers may be name, URL, or ARN
- invalid `maxMessagesPerSecond` is rejected up front
- source and destination queues must not collide
- a second `RUNNING` move task is rejected
- destination-less redrive requires the DLQ to have at least one source queue

## Manual replay stays consumer-owned

Native redrive is the default recovery path because it keeps the shared package focused on queue mechanics.

Manual replay remains consumer-owned because safe replay depends on:
- domain idempotency rules
- payload schema and version handling
- partial-processing recovery rules
- destination selection policy
- audit and rollback requirements

If a consumer chooses to add manual replay, keep it outside the shared package and route it through a consumer-owned admin command or runbook.

## Example script

Use [`../examples/queue-ops/native-dlq-redrive.ts`](../examples/queue-ops/native-dlq-redrive.ts) as the baseline consumer-owned admin script pattern.

It demonstrates:
- queue inspection
- DLQ source discovery
- listing native redrive tasks
- starting native redrive
- canceling a running redrive task

The library still does not load env files or secrets for that script. The consuming system owns configuration and runtime wiring.
