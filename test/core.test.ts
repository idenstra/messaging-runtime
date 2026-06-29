import { strict as assert } from 'node:assert';
import test from 'node:test';
import type {
  ChangeMessageVisibilityCommandInput,
  DeleteMessageCommandInput,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import {
  SqsWorkerManager,
  type SqsRuntimeClient,
  type SqsRuntimeRequestOptions,
  type SqsWorkerRuntimeEvent,
} from '../src';

type ReceiveBatch =
  | ReceiveMessageCommandOutput
  | ((
      input: ReceiveMessageCommandInput,
      options?: SqsRuntimeRequestOptions,
    ) => Promise<ReceiveMessageCommandOutput>);

class FakeSqsClient implements SqsRuntimeClient {
  readonly receiveInputs: ReceiveMessageCommandInput[] = [];
  readonly deleteInputs: DeleteMessageCommandInput[] = [];
  readonly visibilityInputs: ChangeMessageVisibilityCommandInput[] = [];
  private readonly batches: ReceiveBatch[];

  constructor(batches: ReceiveBatch[]) {
    this.batches = [...batches];
  }

  async receiveMessage(
    input: ReceiveMessageCommandInput,
    options?: SqsRuntimeRequestOptions,
  ): Promise<ReceiveMessageCommandOutput> {
    this.receiveInputs.push(input);

    const next = this.batches.shift();
    if (!next) {
      return { Messages: [] };
    }

    if (typeof next === 'function') {
      return next(input, options);
    }

    const maxMessages = input.MaxNumberOfMessages ?? 1;
    const messages = next.Messages ?? [];
    if (messages.length <= maxMessages) {
      return next;
    }

    this.batches.unshift({
      ...next,
      Messages: messages.slice(maxMessages),
    });

    return {
      ...next,
      Messages: messages.slice(0, maxMessages),
    };
  }

  async deleteMessage(input: DeleteMessageCommandInput): Promise<void> {
    this.deleteInputs.push(input);
  }

  async changeMessageVisibility(input: ChangeMessageVisibilityCommandInput): Promise<void> {
    this.visibilityInputs.push(input);
  }
}

test('deletes messages after successful handler execution and updates snapshots', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }],
    },
  ]);
  const events: string[] = [];
  const manager = new SqsWorkerManager(client, {
    onEvent: (event) => {
      events.push(event.type);
    },
  });
  let abortSignalObserved: AbortSignal | undefined;

  manager.register<{ kind: string }>({
    name: 'dispatch-email',
    queueUrl: 'https://queue.test/email',
    handle: async ({ payload, abortSignal }) => {
      abortSignalObserved = abortSignal;
      assert.equal(payload.kind, 'alpha');
    },
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      heartbeatIntervalMs: 0,
    },
  });

  await manager.start();
  await waitFor(() => client.deleteInputs.length === 1);
  await manager.stop();

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.routeCount, 1);
  assert.equal(snapshot.totalInFlight, 0);
  assert.equal(snapshot.counters.messagesReceivedCount, 1);
  assert.equal(snapshot.counters.handlerStartedCount, 1);
  assert.equal(snapshot.counters.handlerSuccessCount, 1);
  assert.equal(snapshot.counters.messageDeleteCount, 1);
  assert.equal(snapshot.routes[0]?.counters.messageDeleteCount, 1);
  assert.equal(client.deleteInputs[0]?.ReceiptHandle, 'r1');
  assert.ok(abortSignalObserved);
  assert.equal(abortSignalObserved?.aborted, false);
  assert.deepEqual(events.slice(0, 2), ['messages-received', 'handler-start']);
  assert.equal(events.includes('handler-success'), true);
  assert.equal(events.includes('message-delete'), true);
});

test('decode failures use the route default failure action', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1' }],
    },
  ]);
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
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      heartbeatIntervalMs: 0,
      failureAction: 'delete',
    },
  });

  await manager.start();
  await waitFor(() => client.deleteInputs.length === 1);
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
    {
      Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }],
    },
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
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      heartbeatIntervalMs: 0,
      failureAction: 'keep',
    },
  });

  await manager.start();
  await waitFor(() => client.deleteInputs.length === 1);
  await manager.stop();

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.counters.handlerFailureCount, 1);
  assert.equal(snapshot.counters.messageDeleteCount, 1);
  assert.equal(snapshot.counters.messageKeepCount, 0);
});

test('cooperative timeout aborts, keeps the slot occupied, continues heartbeating, and may delete after settlement', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }],
    },
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

  await waitFor(() => client.deleteInputs.length === 1);
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
    {
      Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }],
    },
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
  assert.equal(events.some((event) => event.type === 'heartbeat-failure'), false);
  assert.equal(events.some((event) => event.type === 'late-settlement'), true);

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.counters.handlerTimeoutCount, 1);
  assert.equal(snapshot.counters.heartbeatFailureCount, 0);
  assert.equal(snapshot.counters.messageKeepCount, 1);
  assert.equal(snapshot.counters.lateSettlementCount, 1);
});

test('metrics hook exceptions do not break runtime processing', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }],
    },
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
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      heartbeatIntervalMs: 0,
    },
  });

  await manager.start();
  await waitFor(() => client.deleteInputs.length === 1);
  await manager.stop();

  assert.equal(client.deleteInputs.length, 1);
});

test('cooperative timeout still blocks stop until the timed-out handler settles', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }],
    },
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

  manager.register({
    name: 'dispatch-email',
    queueUrl: 'https://queue.test/email',
    handle: async () => undefined,
  });

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

async function onceAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

async function waitFor(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 1_000;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Condition not met within ${timeoutMs}ms.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
