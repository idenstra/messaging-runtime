import { strict as assert } from 'node:assert';
import test from 'node:test';
import { SqsWorkerManager, type SqsWorkerRuntimeEvent } from '../../src';
import { createDeferred, FakeSqsClient, sleep, waitFor } from './support';

test('prefetch buffer never exceeds min(concurrency, maxMessagesPerPoll)', async () => {
  const hold = createDeferred<void>();
  const client = new FakeSqsClient([
    {
      Messages: Array.from({ length: 4 }, (_, index) => ({
        MessageId: `m${index + 1}`,
        ReceiptHandle: `r${index + 1}`,
        Body: JSON.stringify({ kind: `job-${index + 1}` }),
      })),
    },
  ]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
  });

  manager.register({
    name: 'bounded-buffer',
    queueUrl: 'https://queue.test/bounded-buffer',
    handle: async () => {
      await hold.promise;
    },
    config: { concurrency: 2, maxMessagesPerPoll: 5 },
  });

  await manager.start();
  await waitFor(() => manager.getStatus()[0]?.inFlight === 2 && manager.getStatus()[0]?.buffered === 2);

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.totalBuffered, 2);
  assert.equal(client.receiveInputs[0]?.MaxNumberOfMessages, 4);

  hold.resolve();
  await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 4);
  await manager.stop();
});

test('buffered status only counts prefetched backlog, not newly received work dispatched into free slots', async () => {
  const hold = createDeferred<void>();
  const bufferedObservations: number[] = [];
  let manager!: SqsWorkerManager;
  const client = new FakeSqsClient([
    {
      Messages: Array.from({ length: 4 }, (_, index) => ({
        MessageId: `m${index + 1}`,
        ReceiptHandle: `r${index + 1}`,
        Body: JSON.stringify({ kind: `job-${index + 1}` }),
      })),
    },
  ]);

  manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
    onEvent: (event) => {
      if (event.type !== 'messages-received') {
        return;
      }

      queueMicrotask(() => {
        bufferedObservations.push(manager.getStatus()[0]?.buffered ?? -1);
      });
    },
  });

  manager.register({
    name: 'buffered-backlog-only',
    queueUrl: 'https://queue.test/buffered-backlog-only',
    handle: async () => {
      await hold.promise;
    },
    config: { concurrency: 2, maxMessagesPerPoll: 5 },
  });

  await manager.start();
  await waitFor(() => manager.getStatus()[0]?.inFlight === 2 && manager.getStatus()[0]?.buffered === 2);
  await waitFor(() => bufferedObservations.length > 0);

  assert.deepEqual(bufferedObservations, [2]);

  hold.resolve();
  await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 4);
  await manager.stop();
});

test('prefetched messages extend visibility once before dispatch after crossing the age guard', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) },
        { MessageId: 'm2', ReceiptHandle: 'r2', Body: JSON.stringify({ jobId: 'job-2' }) },
      ],
    },
  ]);
  const handledMessageIds: string[] = [];
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
  });

  manager.register({
    name: 'buffer-visibility-guard',
    queueUrl: 'https://queue.test/buffer-visibility-guard',
    handle: async ({ message }) => {
      handledMessageIds.push(message.messageId);
      if (message.messageId === 'm1') {
        await sleep(650);
      }
    },
    config: { concurrency: 1, maxMessagesPerPoll: 2, visibilityTimeoutSeconds: 1 },
  });

  await manager.start();
  await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 2, { timeoutMs: 3_000 });
  await manager.stop();

  assert.deepEqual(handledMessageIds, ['m1', 'm2']);
  assert.equal(
    client.visibilityInputs.some((input) => input.ReceiptHandle === 'r2'),
    true,
  );
});

test('pre-dispatch visibility extension failures emit infrastructure events and drop the buffered message locally', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) },
        { MessageId: 'm2', ReceiptHandle: 'r2', Body: JSON.stringify({ jobId: 'job-2' }) },
      ],
    },
  ]);
  client.visibilityImpl = async (input) => {
    if (input.ReceiptHandle === 'r2') {
      throw new Error('visibility down');
    }
  };
  const handledMessageIds: string[] = [];
  const events: SqsWorkerRuntimeEvent[] = [];
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
    onEvent: (event) => {
      events.push(event);
    },
  });

  manager.register({
    name: 'buffer-visibility-failure',
    queueUrl: 'https://queue.test/buffer-visibility-failure',
    handle: async ({ message }) => {
      handledMessageIds.push(message.messageId);
      if (message.messageId === 'm1') {
        await sleep(650);
      }
    },
    config: { concurrency: 1, maxMessagesPerPoll: 2, visibilityTimeoutSeconds: 1 },
  });

  await manager.start();
  await waitFor(() => manager.getSnapshot().counters.bufferedMessageDropCount === 1, { timeoutMs: 3_000 });
  await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 1);
  await manager.stop();

  assert.deepEqual(handledMessageIds, ['m1']);
  const visibilityEvents = events.filter((event) => event.type === 'pre-dispatch-visibility-failure');
  const dropEvents = events.filter((event) => event.type === 'buffered-message-drop');
  assert.equal(visibilityEvents.length, 1);
  assert.equal(dropEvents.length, 1);
  assert.equal(dropEvents[0]?.type, 'buffered-message-drop');
  assert.equal(dropEvents[0]?.dropReason, 'pre-dispatch-visibility-failure');

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.counters.preDispatchVisibilityFailureCount, 1);
  assert.equal(snapshot.counters.bufferedMessageDropCount, 1);
  assert.equal(snapshot.routes[0]?.counters.preDispatchVisibilityFailureCount, 1);
  assert.equal(snapshot.routes[0]?.lastBufferedMessageDropReason, 'pre-dispatch-visibility-failure');
  assert.match(snapshot.routes[0]?.lastPreDispatchVisibilityFailureMessage ?? '', /visibility down/);
});

test('buffered messages missing a receipt handle emit only the buffered-drop event and are not dispatched locally', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) },
        { MessageId: 'm2', Body: JSON.stringify({ jobId: 'job-2' }) },
      ],
    },
  ]);
  const handledMessageIds: string[] = [];
  const events: SqsWorkerRuntimeEvent[] = [];
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
    onEvent: (event) => {
      events.push(event);
    },
  });

  manager.register({
    name: 'buffer-missing-receipt-handle',
    queueUrl: 'https://queue.test/buffer-missing-receipt-handle',
    handle: async ({ message }) => {
      handledMessageIds.push(message.messageId);
      if (message.messageId === 'm1') {
        await sleep(650);
      }
    },
    config: { concurrency: 1, maxMessagesPerPoll: 2, visibilityTimeoutSeconds: 1 },
  });

  await manager.start();
  await waitFor(() => manager.getSnapshot().counters.bufferedMessageDropCount === 1, { timeoutMs: 3_000 });
  await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 1);
  await manager.stop();

  assert.deepEqual(handledMessageIds, ['m1']);
  assert.equal(
    events.some((event) => event.type === 'pre-dispatch-visibility-failure'),
    false,
  );
  const dropEvents = events.filter((event) => event.type === 'buffered-message-drop');
  assert.equal(dropEvents.length, 1);
  assert.equal(dropEvents[0]?.type, 'buffered-message-drop');
  assert.equal(dropEvents[0]?.dropReason, 'missing-receipt-handle');

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.counters.bufferedMessageDropCount, 1);
  assert.equal(snapshot.routes[0]?.counters.bufferedMessageDropCount, 1);
  assert.equal(snapshot.routes[0]?.lastBufferedMessageDropReason, 'missing-receipt-handle');
  assert.match(snapshot.routes[0]?.lastErrorMessage ?? '', /ReceiptHandle/);
});

test('buffered messages drain on stop instead of being abandoned locally', async () => {
  const releaseFirst = createDeferred<void>();
  const client = new FakeSqsClient([
    {
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) },
        { MessageId: 'm2', ReceiptHandle: 'r2', Body: JSON.stringify({ jobId: 'job-2' }) },
      ],
    },
  ]);
  const handledMessageIds: string[] = [];
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
  });

  manager.register({
    name: 'stop-drain-buffer',
    queueUrl: 'https://queue.test/stop-drain-buffer',
    handle: async ({ message }) => {
      handledMessageIds.push(message.messageId);
      if (message.messageId === 'm1') {
        await releaseFirst.promise;
      }
    },
    config: { concurrency: 1, maxMessagesPerPoll: 2 },
  });

  await manager.start();
  await waitFor(() => manager.getStatus()[0]?.inFlight === 1 && manager.getStatus()[0]?.buffered === 1);

  const stopPromise = manager.stop();
  releaseFirst.resolve();
  await stopPromise;

  assert.deepEqual(handledMessageIds, ['m1', 'm2']);
  assert.equal(manager.getSnapshot().counters.messageDeleteCount, 2);
  assert.equal(manager.getSnapshot().totalBuffered, 0);
});
