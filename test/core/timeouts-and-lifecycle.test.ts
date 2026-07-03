import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { ReceiveMessageCommandOutput } from '@aws-sdk/client-sqs';
import { SqsWorkerManager, type SqsWorkerRuntimeEvent } from '../../src';
import { FakeSqsClient, onceAborted, sleep, waitFor } from './support';

test('cooperative timeout keeps buffered backlog waiting until settlement', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) },
        { MessageId: 'm2', ReceiptHandle: 'r2', Body: JSON.stringify({ jobId: 'job-2' }) },
      ],
    },
  ]);
  const startedMessageIds: string[] = [];
  const manager = new SqsWorkerManager(client);

  manager.register({
    name: 'cooperative-buffered-timeout',
    queueUrl: 'https://queue.test/cooperative-buffered-timeout',
    handle: async ({ abortSignal, message }) => {
      startedMessageIds.push(message.messageId);
      if (message.messageId === 'm1') {
        await onceAborted(abortSignal);
        await sleep(35);
      }
    },
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      visibilityTimeoutSeconds: 30,
      heartbeatIntervalMs: 10,
      handlerTimeoutMs: 15,
      timeoutStrategy: 'cooperative',
      failureAction: 'delete',
      concurrency: 1,
      maxMessagesPerPoll: 2,
    },
  });

  await manager.start();
  await waitFor(() => Boolean(manager.getStatus()[0]?.lastTimeoutAt));
  assert.deepEqual(startedMessageIds, ['m1']);

  await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 2);
  await manager.stop();

  assert.deepEqual(startedMessageIds, ['m1', 'm2']);
});

test('abandon timeout frees the slot so buffered backlog can dispatch before late settlement', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) },
        { MessageId: 'm2', ReceiptHandle: 'r2', Body: JSON.stringify({ jobId: 'job-2' }) },
      ],
    },
  ]);
  const startedMessageIds: string[] = [];
  const manager = new SqsWorkerManager(client);

  manager.register({
    name: 'abandon-buffered-timeout',
    queueUrl: 'https://queue.test/abandon-buffered-timeout',
    handle: async ({ abortSignal, message }) => {
      startedMessageIds.push(message.messageId);
      if (message.messageId === 'm1') {
        await onceAborted(abortSignal);
        await sleep(40);
      }
    },
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      visibilityTimeoutSeconds: 30,
      heartbeatIntervalMs: 10,
      handlerTimeoutMs: 15,
      timeoutStrategy: 'abandon',
      failureAction: 'delete',
      concurrency: 1,
      maxMessagesPerPoll: 2,
    },
  });

  await manager.start();
  await waitFor(() => manager.getSnapshot().counters.messageKeepCount === 1);
  await waitFor(() => startedMessageIds.includes('m2'));
  assert.equal(manager.getSnapshot().counters.lateSettlementCount, 0);

  await waitFor(() => manager.getSnapshot().counters.lateSettlementCount === 1);
  await manager.stop();

  assert.deepEqual(startedMessageIds, ['m1', 'm2']);
});

test('cooperative timeout aborts, keeps the slot occupied, continues heartbeating, and may delete after settlement', async () => {
  const client = new FakeSqsClient([
    { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }] },
  ]);
  const events: SqsWorkerRuntimeEvent[] = [];
  const manager = new SqsWorkerManager(client, {
    onEvent: (event) => {
      events.push(event);
    },
  });
  let abortObserved = false;

  manager.register({
    name: 'cooperative-timeout',
    queueUrl: 'https://queue.test/email',
    handle: async ({ abortSignal }) => {
      await onceAborted(abortSignal);
      abortObserved = abortSignal.aborted;
      await sleep(35);
    },
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      visibilityTimeoutSeconds: 30,
      heartbeatIntervalMs: 10,
      handlerTimeoutMs: 20,
      timeoutStrategy: 'cooperative',
      failureAction: 'delete',
    },
  });

  await manager.start();
  await waitFor(() => Boolean(manager.getStatus()[0]?.lastTimeoutAt));
  assert.equal(manager.getStatus()[0]?.inFlight, 1);

  await waitFor(() => client.deleteBatchInputs.length === 1);
  await manager.stop();

  const timeoutEvents = events.filter((event) => event.type === 'handler-timeout');
  assert.equal(timeoutEvents.length, 1);
  assert.equal(timeoutEvents[0]?.type, 'handler-timeout');
  assert.equal(timeoutEvents[0]?.timeoutStrategy, 'cooperative');
  assert.ok(abortObserved);
  assert.ok(client.visibilityInputs.length >= 2);

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.counters.handlerTimeoutCount, 1);
  assert.equal(snapshot.counters.messageDeleteCount, 1);
});

test('abandon timeout stops heartbeats, keeps the message, and records late settlement', async () => {
  const client = new FakeSqsClient([
    { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }] },
  ]);
  const events: SqsWorkerRuntimeEvent[] = [];
  const manager = new SqsWorkerManager(client, {
    onEvent: (event) => {
      events.push(event);
    },
  });

  manager.register({
    name: 'abandon-timeout',
    queueUrl: 'https://queue.test/email',
    handle: async ({ abortSignal }) => {
      await onceAborted(abortSignal);
      await sleep(40);
    },
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      visibilityTimeoutSeconds: 30,
      heartbeatIntervalMs: 10,
      handlerTimeoutMs: 15,
      timeoutStrategy: 'abandon',
      failureAction: 'delete',
    },
  });

  await manager.start();
  await waitFor(() => manager.getSnapshot().counters.messageKeepCount === 1);
  assert.equal(manager.getStatus()[0]?.inFlight, 0);
  const heartbeatCountAfterTimeout = client.visibilityInputs.length;

  await waitFor(() => manager.getSnapshot().counters.lateSettlementCount === 1);
  await sleep(30);
  await manager.stop();

  assert.equal(client.deleteInputs.length, 0);
  assert.equal(client.visibilityInputs.length, heartbeatCountAfterTimeout);
  assert.equal(
    events.some((event) => event.type === 'heartbeat-failure'),
    false,
  );
  assert.equal(
    events.some((event) => event.type === 'late-settlement'),
    true,
  );

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.counters.handlerTimeoutCount, 1);
  assert.equal(snapshot.counters.heartbeatFailureCount, 0);
  assert.equal(snapshot.counters.messageKeepCount, 1);
  assert.equal(snapshot.counters.lateSettlementCount, 1);
});

test('cooperative timeout still blocks stop until the timed-out handler settles', async () => {
  const client = new FakeSqsClient([
    { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }] },
  ]);
  const manager = new SqsWorkerManager(client);

  manager.register({
    name: 'cooperative-stop',
    queueUrl: 'https://queue.test/email',
    handle: async ({ abortSignal }) => {
      await onceAborted(abortSignal);
      await sleep(45);
    },
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      heartbeatIntervalMs: 10,
      handlerTimeoutMs: 15,
      timeoutStrategy: 'cooperative',
      failureAction: 'keep',
    },
  });

  await manager.start();
  await waitFor(() => Boolean(manager.getStatus()[0]?.lastTimeoutAt));

  const startedAt = Date.now();
  await manager.stop();
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs >= 30);
});

test('stop aborts an in-flight long poll instead of waiting for the full receive timeout', async () => {
  const client = new FakeSqsClient([
    async (_input, options) =>
      new Promise<ReceiveMessageCommandOutput>((_resolve, reject) => {
        const abort = () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          reject(error);
        };

        if (options?.abortSignal?.aborted) {
          abort();
          return;
        }

        options?.abortSignal?.addEventListener('abort', abort, { once: true });
      }),
  ]);
  const manager = new SqsWorkerManager(client);

  manager.register({ name: 'dispatch-email', queueUrl: 'https://queue.test/email', handle: async () => undefined });

  await manager.start();
  const stopStartedAt = Date.now();
  await manager.stop();

  assert.ok(Date.now() - stopStartedAt < 250);
});

test('rejects invalid timeout and failure configuration during registration', () => {
  const manager = new SqsWorkerManager(new FakeSqsClient([]));

  assert.throws(
    () =>
      manager.register({
        name: 'invalid-timeout',
        queueUrl: 'https://queue.test/email',
        handle: async () => undefined,
        config: { handlerTimeoutMs: 0 },
      }),
    /invalid handlerTimeoutMs/i,
  );

  assert.throws(
    () =>
      manager.register({
        name: 'invalid-strategy',
        queueUrl: 'https://queue.test/email',
        handle: async () => undefined,
        config: { timeoutStrategy: 'bogus' as never },
      }),
    /invalid timeoutStrategy/i,
  );

  assert.throws(
    () =>
      manager.register({
        name: 'invalid-failure-action',
        queueUrl: 'https://queue.test/email',
        handle: async () => undefined,
        config: { failureAction: 'bogus' as never },
      }),
    /invalid failureAction/i,
  );
});
