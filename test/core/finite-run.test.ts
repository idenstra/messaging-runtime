import { strict as assert } from 'node:assert';
import test from 'node:test';
import type {
  ChangeMessageVisibilityCommandInput,
  DeleteMessageBatchCommandInput,
  DeleteMessageBatchCommandOutput,
  DeleteMessageCommandInput,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import type { SqsRuntimeClient } from '../../src';
import { runSqsWorkerManagerBounded, runSqsWorkerManagerUntilIdle, SqsWorkerManager } from '../../src';
import { createDeferred, FakeSqsClient, sleep, waitFor } from './support';

class QueueAwareSqsClient implements SqsRuntimeClient {
  readonly receiveInputs: ReceiveMessageCommandInput[] = [];
  readonly deleteInputs: DeleteMessageCommandInput[] = [];
  readonly deleteBatchInputs: DeleteMessageBatchCommandInput[] = [];
  readonly visibilityInputs: ChangeMessageVisibilityCommandInput[] = [];
  private readonly messagesByQueue = new Map<
    string,
    Array<{ MessageId: string; ReceiptHandle: string; Body?: string }>
  >();

  withMessages(queueUrl: string, messages: Array<{ MessageId: string; ReceiptHandle: string; Body?: string }>): this {
    this.messagesByQueue.set(queueUrl, [...messages]);
    return this;
  }

  async receiveMessage(input: ReceiveMessageCommandInput): Promise<ReceiveMessageCommandOutput> {
    this.receiveInputs.push(input);
    const queueUrl = input.QueueUrl ?? '';
    const queueMessages = this.messagesByQueue.get(queueUrl) ?? [];
    const maxMessages = input.MaxNumberOfMessages ?? 1;

    if (queueMessages.length === 0) {
      return { Messages: [] };
    }

    const messages = queueMessages.splice(0, maxMessages);
    return { Messages: messages };
  }

  async deleteMessage(input: DeleteMessageCommandInput): Promise<void> {
    this.deleteInputs.push(input);
  }

  async deleteMessageBatch(input: DeleteMessageBatchCommandInput): Promise<DeleteMessageBatchCommandOutput> {
    this.deleteBatchInputs.push(input);
    return { Successful: (input.Entries ?? []).flatMap((entry) => (entry.Id ? [{ Id: entry.Id }] : [])), Failed: [] };
  }

  async changeMessageVisibility(input: ChangeMessageVisibilityCommandInput): Promise<void> {
    this.visibilityInputs.push(input);
  }
}

test('runUntilIdle completes after the default empty-wave threshold and returns route results', async () => {
  const client = new FakeSqsClient([
    { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) }] },
  ]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
  });

  manager.register({
    name: 'idle-defaults',
    queueUrl: 'https://queue.test/idle-defaults',
    handle: async () => undefined,
  });

  const result = await manager.runUntilIdle();

  assert.equal(client.receiveInputs.length, 3);
  assert.equal(client.deleteBatchInputs.length, 1);
  assert.deepEqual(result.routes, [{ routeName: 'idle-defaults', handledMessageCount: 1, completionReason: 'idle' }]);
  assert.equal(manager.getSnapshot().started, false);
});

test('runUntilIdle respects finite-run defaults and per-run overrides', async () => {
  const defaultClient = new FakeSqsClient([]);
  const defaultManager = new SqsWorkerManager(defaultClient, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
    finiteRunDefaults: { idleEmptyReceiveWaves: 3 },
  });
  defaultManager.register({
    name: 'idle-default-override',
    queueUrl: 'https://queue.test/idle-default-override',
    handle: async () => undefined,
  });

  await defaultManager.runUntilIdle();
  assert.equal(defaultClient.receiveInputs.length, 3);

  const overrideClient = new FakeSqsClient([]);
  const overrideManager = new SqsWorkerManager(overrideClient, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
    finiteRunDefaults: { idleEmptyReceiveWaves: 3 },
  });
  overrideManager.register({
    name: 'idle-per-run-override',
    queueUrl: 'https://queue.test/idle-per-run-override',
    handle: async () => undefined,
  });

  await overrideManager.runUntilIdle({ idleEmptyReceiveWaves: 1 });
  assert.equal(overrideClient.receiveInputs.length, 1);
});

test('runUntilIdle resets empty receives after non-empty work is admitted', async () => {
  const client = new FakeSqsClient([
    { Messages: [] },
    { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) }] },
  ]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
  });

  manager.register({ name: 'idle-reset', queueUrl: 'https://queue.test/idle-reset', handle: async () => undefined });

  const result = await manager.runUntilIdle();

  assert.equal(client.receiveInputs.length, 4);
  assert.equal(result.routes[0]?.completionReason, 'idle');
  assert.equal(result.routes[0]?.handledMessageCount, 1);
});

test('runUntilIdle drains buffered and in-flight work before stopping', async () => {
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
    name: 'idle-drain',
    queueUrl: 'https://queue.test/idle-drain',
    handle: async ({ message }) => {
      handledMessageIds.push(message.messageId);
      if (message.messageId === 'm1') {
        await releaseFirst.promise;
      }
    },
    config: { concurrency: 1, maxMessagesPerPoll: 2 },
  });

  let resolved = false;
  const runPromise = manager.runUntilIdle().then((result) => {
    resolved = true;
    return result;
  });

  await waitFor(() => manager.getStatus()[0]?.inFlight === 1 && manager.getStatus()[0]?.buffered === 1);
  await sleep(25);
  assert.equal(resolved, false);

  releaseFirst.resolve();
  const result = await runPromise;

  assert.deepEqual(handledMessageIds, ['m1', 'm2']);
  assert.equal(manager.getSnapshot().counters.messageDeleteCount, 2);
  assert.equal(client.deleteBatchInputs.length >= 1, true);
  assert.equal(result.routes[0]?.handledMessageCount, 2);
  assert.equal(result.routes[0]?.completionReason, 'idle');
});

test('runBounded validates maxHandledMessagesPerRoute before startup', async () => {
  const manager = new SqsWorkerManager(new FakeSqsClient([]));
  manager.register({
    name: 'bounded-validation',
    queueUrl: 'https://queue.test/bounded-validation',
    handle: async () => undefined,
  });

  await assert.rejects(() => manager.runBounded({ maxHandledMessagesPerRoute: 0 }), /maxHandledMessagesPerRoute/i);
});

test('runBounded enforces an exact handled-message cap and stops polling after the route is exhausted', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) },
        { MessageId: 'm2', ReceiptHandle: 'r2', Body: JSON.stringify({ jobId: 'job-2' }) },
        { MessageId: 'm3', ReceiptHandle: 'r3', Body: JSON.stringify({ jobId: 'job-3' }) },
      ],
    },
  ]);
  const handledMessageIds: string[] = [];
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
  });

  manager.register({
    name: 'bounded-exact',
    queueUrl: 'https://queue.test/bounded-exact',
    handle: async ({ message }) => {
      handledMessageIds.push(message.messageId);
    },
    config: { concurrency: 1, maxMessagesPerPoll: 2 },
  });

  const result = await manager.runBounded({ maxHandledMessagesPerRoute: 2 });

  assert.deepEqual(handledMessageIds, ['m1', 'm2']);
  assert.equal(client.receiveInputs.length, 1);
  assert.equal(client.receiveInputs[0]?.MaxNumberOfMessages, 2);
  assert.equal(result.routes[0]?.handledMessageCount, 2);
  assert.equal(result.routes[0]?.completionReason, 'bounded');
});

test('runBounded can return bounded for one route and idle for another', async () => {
  const queueA = 'https://queue.test/bounded.fifo';
  const queueB = 'https://queue.test/idle';
  const client = new QueueAwareSqsClient().withMessages(queueA, [
    { MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) },
    { MessageId: 'm2', ReceiptHandle: 'r2', Body: JSON.stringify({ jobId: 'job-2' }) },
  ]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
  });

  manager.register({ name: 'bounded-route', queueUrl: queueA, handle: async () => undefined });
  manager.register({ name: 'idle-route', queueUrl: queueB, handle: async () => undefined });

  const result = await manager.runBounded({ maxHandledMessagesPerRoute: 2 });

  assert.deepEqual(result.routes, [
    { routeName: 'bounded-route', handledMessageCount: 2, completionReason: 'bounded' },
    { routeName: 'idle-route', handledMessageCount: 0, completionReason: 'idle' },
  ]);
});

test('finite-run methods reject when the manager is already running or stopping', async () => {
  const release = createDeferred<void>();
  const client = new FakeSqsClient([
    { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) }] },
  ]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
  });

  manager.register({
    name: 'finite-run-rejects',
    queueUrl: 'https://queue.test/finite-run-rejects',
    handle: async () => {
      await release.promise;
    },
  });

  await manager.start();
  await waitFor(() => manager.getStatus()[0]?.inFlight === 1);
  await assert.rejects(() => manager.runUntilIdle(), /already running or stopping/i);

  const stopPromise = manager.stop();
  await assert.rejects(() => manager.runBounded({ maxHandledMessagesPerRoute: 1 }), /already running or stopping/i);

  release.resolve();
  await stopPromise;
});

test('finite-run preserves route lifecycle hooks', async () => {
  const events: string[] = [];
  const manager = new SqsWorkerManager(new FakeSqsClient([]), {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
  });

  manager.register({
    name: 'finite-run-lifecycle',
    queueUrl: 'https://queue.test/finite-run-lifecycle',
    lifecycle: {
      beforeStart: () => {
        events.push('beforeStart');
      },
      afterStart: () => {
        events.push('afterStart');
      },
      beforeStop: () => {
        events.push('beforeStop');
      },
      afterStop: () => {
        events.push('afterStop');
      },
    },
    handle: async () => undefined,
  });

  await manager.runUntilIdle({ idleEmptyReceiveWaves: 1 });
  assert.deepEqual(events, ['beforeStart', 'afterStart', 'beforeStop', 'afterStop']);
});

test('finite-run helper functions delegate to the manager method surface', async () => {
  const idleManager = new SqsWorkerManager(new FakeSqsClient([]), {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
  });
  idleManager.register({
    name: 'idle-helper',
    queueUrl: 'https://queue.test/idle-helper',
    handle: async () => undefined,
  });

  const idleResult = await runSqsWorkerManagerUntilIdle(idleManager, { idleEmptyReceiveWaves: 1 });
  assert.equal(idleResult.routes[0]?.completionReason, 'idle');

  const boundedManager = new SqsWorkerManager(
    new FakeSqsClient([
      { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) }] },
    ]),
    { defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 } },
  );
  boundedManager.register({
    name: 'bounded-helper',
    queueUrl: 'https://queue.test/bounded-helper',
    handle: async () => undefined,
  });

  const boundedResult = await runSqsWorkerManagerBounded(boundedManager, { maxHandledMessagesPerRoute: 1 });
  assert.equal(boundedResult.routes[0]?.completionReason, 'bounded');
});
