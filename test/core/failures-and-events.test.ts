import { strict as assert } from 'node:assert';
import test from 'node:test';
import { SqsWorkerManager, type SqsWorkerRuntimeEvent } from '../../src';
import { FakeSqsClient, waitFor } from './support';

test('polling failures emit infrastructure events, preserve backoff, and update rich snapshot fields', async () => {
  const errorBackoffMs = 25;
  let pollFailedAt = 0;
  let secondReceiveAt = 0;
  const client = new FakeSqsClient([
    async () => {
      pollFailedAt = Date.now();
      throw new Error('poll down');
    },
    async () => {
      secondReceiveAt = Date.now();
      return { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }] };
    },
  ]);
  const events: SqsWorkerRuntimeEvent[] = [];
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, errorBackoffMs },
    onEvent: (event) => {
      events.push(event);
    },
  });

  manager.register({ name: 'poll-error', queueUrl: 'https://queue.test/poll-error', handle: async () => undefined });

  await manager.start();
  await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 1);
  await manager.stop();

  const pollEvents = events.filter((event) => event.type === 'poll-error');
  assert.equal(pollEvents.length, 1);
  assert.equal(pollEvents[0]?.type, 'poll-error');
  assert.equal(pollEvents[0]?.backoffMs, errorBackoffMs);
  assert.match(pollEvents[0]?.errorDetail ?? '', /poll down/);
  assert.ok(secondReceiveAt - pollFailedAt >= errorBackoffMs);

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.counters.pollErrorCount, 1);
  assert.equal(snapshot.routes[0]?.counters.pollErrorCount, 1);
  assert.match(snapshot.routes[0]?.lastPollErrorMessage ?? '', /poll down/);
  assert.match(snapshot.routes[0]?.lastErrorMessage ?? '', /poll down/);
});

test('delete batch request failures emit infrastructure events and still retry messages individually once', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) },
        { MessageId: 'm2', ReceiptHandle: 'r2', Body: JSON.stringify({ jobId: 'job-2' }) },
      ],
    },
  ]);
  client.deleteBatchImpl = async () => {
    throw new Error('batch down');
  };
  const events: SqsWorkerRuntimeEvent[] = [];
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 2 },
    onEvent: (event) => {
      events.push(event);
    },
  });

  manager.register({
    name: 'delete-batch-request-failure',
    queueUrl: 'https://queue.test/delete-batch-request-failure',
    handle: async () => undefined,
    config: { concurrency: 2 },
  });

  await manager.start();
  await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 2);
  await manager.stop();

  const batchEvents = events.filter((event) => event.type === 'delete-batch-failure');
  assert.equal(batchEvents.length, 1);
  assert.equal(batchEvents[0]?.type, 'delete-batch-failure');
  assert.equal(batchEvents[0]?.failureMode, 'request-error');
  assert.equal(batchEvents[0]?.batchSize, 2);
  assert.equal(batchEvents[0]?.failedCount, 2);
  assert.deepEqual(batchEvents[0]?.messageIds, ['m1', 'm2']);
  assert.equal(client.deleteInputs.length, 2);

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.counters.deleteBatchFailureCount, 1);
  assert.equal(snapshot.routes[0]?.counters.deleteBatchFailureCount, 1);
  assert.match(snapshot.routes[0]?.lastDeleteBatchFailureMessage ?? '', /batch down/);
  assert.match(snapshot.routes[0]?.lastErrorMessage ?? '', /batch down/);
});

test('delete batch response failures emit infrastructure events and retry only failed entries individually once', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) },
        { MessageId: 'm2', ReceiptHandle: 'r2', Body: JSON.stringify({ jobId: 'job-2' }) },
      ],
    },
  ]);
  client.deleteBatchImpl = async () => ({
    Successful: [{ Id: 'delete-0' }],
    Failed: [{ Id: 'delete-1', Code: 'InternalError', Message: 'boom', SenderFault: false }],
  });
  const events: SqsWorkerRuntimeEvent[] = [];
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 2 },
    onEvent: (event) => {
      events.push(event);
    },
  });

  manager.register({
    name: 'delete-batch-response-failure',
    queueUrl: 'https://queue.test/delete-batch-response-failure',
    handle: async () => undefined,
    config: { concurrency: 2 },
  });

  await manager.start();
  await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 2);
  await manager.stop();

  const batchEvents = events.filter((event) => event.type === 'delete-batch-failure');
  assert.equal(batchEvents.length, 1);
  assert.equal(batchEvents[0]?.type, 'delete-batch-failure');
  assert.equal(batchEvents[0]?.failureMode, 'response-failure');
  assert.equal(batchEvents[0]?.batchSize, 2);
  assert.equal(batchEvents[0]?.failedCount, 1);
  assert.deepEqual(batchEvents[0]?.messageIds, ['m2']);
  assert.equal(client.deleteBatchInputs.length, 1);
  assert.equal(client.deleteInputs.length, 1);
  assert.equal(client.deleteInputs[0]?.ReceiptHandle, 'r2');

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.counters.deleteBatchFailureCount, 1);
  assert.equal(snapshot.routes[0]?.counters.deleteBatchFailureCount, 1);
  assert.match(snapshot.routes[0]?.lastDeleteBatchFailureMessage ?? '', /delete-1/);
});

test('individual delete retry failures emit infrastructure events without changing duplicate-risk semantics', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) },
        { MessageId: 'm2', ReceiptHandle: 'r2', Body: JSON.stringify({ jobId: 'job-2' }) },
      ],
    },
  ]);
  client.deleteBatchImpl = async () => ({
    Successful: [{ Id: 'delete-0' }],
    Failed: [{ Id: 'delete-1', Code: 'InternalError', Message: 'boom', SenderFault: false }],
  });
  client.deleteImpl = async (input) => {
    if (input.ReceiptHandle === 'r2') {
      throw new Error('still broken');
    }
  };
  const events: SqsWorkerRuntimeEvent[] = [];
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 2 },
    onEvent: (event) => {
      events.push(event);
    },
  });

  manager.register({
    name: 'delete-retry-failure',
    queueUrl: 'https://queue.test/delete-retry-failure',
    handle: async () => undefined,
    config: { concurrency: 2 },
  });

  await manager.start();
  await waitFor(() => manager.getSnapshot().counters.messageDeleteFailureCount === 1);
  await manager.stop();

  const deleteFailureEvents = events.filter((event) => event.type === 'message-delete-failure');
  assert.equal(deleteFailureEvents.length, 1);
  assert.equal(deleteFailureEvents[0]?.type, 'message-delete-failure');
  assert.equal(deleteFailureEvents[0]?.messageId, 'm2');
  assert.equal(deleteFailureEvents[0]?.reason, 'success');
  assert.match(deleteFailureEvents[0]?.errorDetail ?? '', /still broken/);
  assert.equal(
    events.some((event) => event.type === 'message-delete' && event.messageId === 'm2'),
    false,
  );

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.counters.messageDeleteCount, 1);
  assert.equal(snapshot.counters.messageDeleteFailureCount, 1);
  assert.equal(snapshot.routes[0]?.counters.messageDeleteFailureCount, 1);
  assert.match(snapshot.routes[0]?.lastMessageDeleteFailureMessage ?? '', /still broken/);
  assert.match(snapshot.routes[0]?.lastErrorMessage ?? '', /still broken/);
});

test('decode failures use the route default failure action', async () => {
  const client = new FakeSqsClient([{ Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1' }] }]);
  const events: string[] = [];
  const manager = new SqsWorkerManager(client, {
    onEvent: (event) => {
      events.push(event.type);
    },
  });

  manager.register({
    name: 'decode-failure',
    queueUrl: 'https://queue.test/email',
    handle: async () => undefined,
    config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0, failureAction: 'delete' },
  });

  await manager.start();
  await waitFor(() => client.deleteBatchInputs.length === 1);
  await manager.stop();

  const status = manager.getStatus()[0];
  assert.equal(status?.lastFailureKind, 'decode');
  assert.equal(status?.counters.handlerFailureCount, 1);
  assert.equal(status?.counters.handlerStartedCount, 0);
  assert.equal(status?.counters.messageDeleteCount, 1);
  assert.equal(events.includes('handler-start'), false);
});

test('error hooks can override handler failure action', async () => {
  const client = new FakeSqsClient([
    { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }] },
  ]);
  const manager = new SqsWorkerManager(client);

  manager.register({
    name: 'handler-failure',
    queueUrl: 'https://queue.test/email',
    handle: async () => {
      throw new Error('boom');
    },
    onError: async (context) => {
      assert.equal(context.failureKind, 'handler');
      return 'delete';
    },
    config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0, failureAction: 'keep' },
  });

  await manager.start();
  await waitFor(() => client.deleteBatchInputs.length === 1);
  await manager.stop();

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.counters.handlerFailureCount, 1);
  assert.equal(snapshot.counters.messageDeleteCount, 1);
  assert.equal(snapshot.counters.messageKeepCount, 0);
});

test('metrics hook exceptions do not break runtime processing', async () => {
  const client = new FakeSqsClient([
    { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }] },
  ]);
  const manager = new SqsWorkerManager(client, {
    onEvent: () => {
      throw new Error('metrics down');
    },
  });

  manager.register({
    name: 'metrics-errors',
    queueUrl: 'https://queue.test/email',
    handle: async () => undefined,
    config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
  });

  await manager.start();
  await waitFor(() => client.deleteBatchInputs.length === 1);
  await manager.stop();

  assert.equal(client.deleteBatchInputs.length, 1);
});
