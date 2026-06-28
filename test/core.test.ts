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

test('deletes messages after successful handler execution', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }],
    },
  ]);
  const manager = new SqsWorkerManager(client);
  const seen: string[] = [];

  manager.register<{ kind: string }>({
    name: 'dispatch-email',
    queueUrl: 'https://queue.test/email',
    handle: async ({ payload }) => {
      seen.push(payload.kind);
    },
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      heartbeatIntervalMs: 0,
    },
  });

  await manager.start();
  await waitFor(() => seen.length === 1 && client.deleteInputs.length === 1);
  await manager.stop();

  assert.deepEqual(seen, ['alpha']);
  assert.equal(client.deleteInputs.length, 1);
  assert.equal(client.deleteInputs[0]?.ReceiptHandle, 'r1');
});

test('preserves failed messages for retry by not deleting them', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }],
    },
  ]);
  const manager = new SqsWorkerManager(client);

  manager.register({
    name: 'dispatch-email',
    queueUrl: 'https://queue.test/email',
    handle: async () => {
      throw new Error('boom');
    },
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      heartbeatIntervalMs: 0,
    },
  });

  await manager.start();
  await waitFor(() => Boolean(manager.getStatus()[0]?.lastErrorMessage?.includes('boom')));
  await manager.stop();

  assert.equal(client.deleteInputs.length, 0);
  assert.equal(manager.getStatus()[0]?.lastErrorMessage?.includes('boom'), true);
});

test('enforces the configured concurrency ceiling', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ idx: 1 }) },
        { MessageId: 'm2', ReceiptHandle: 'r2', Body: JSON.stringify({ idx: 2 }) },
      ],
    },
    {
      Messages: [{ MessageId: 'm3', ReceiptHandle: 'r3', Body: JSON.stringify({ idx: 3 }) }],
    },
  ]);
  const manager = new SqsWorkerManager(client);
  let inFlight = 0;
  let maxInFlight = 0;

  manager.register<{ idx: number }>({
    name: 'dispatch-email',
    queueUrl: 'https://queue.test/email',
    handle: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(25);
      inFlight -= 1;
    },
    config: {
      concurrency: 2,
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      heartbeatIntervalMs: 0,
    },
  });

  await manager.start();
  await waitFor(() => client.deleteInputs.length === 3);
  await manager.stop();

  assert.equal(maxInFlight, 2);
});

test('extends visibility for long-running handlers', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }],
    },
  ]);
  const manager = new SqsWorkerManager(client);

  manager.register({
    name: 'dispatch-email',
    queueUrl: 'https://queue.test/email',
    handle: async () => {
      await sleep(75);
    },
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      visibilityTimeoutSeconds: 30,
      heartbeatIntervalMs: 20,
    },
  });

  await manager.start();
  await waitFor(() => client.visibilityInputs.length >= 2);
  await manager.stop();

  assert.ok(client.visibilityInputs.length >= 2);
});

test('graceful stop drains in-flight handlers before returning', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }],
    },
  ]);
  const manager = new SqsWorkerManager(client);
  let finished = false;

  manager.register({
    name: 'dispatch-email',
    queueUrl: 'https://queue.test/email',
    handle: async () => {
      await sleep(50);
      finished = true;
    },
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      heartbeatIntervalMs: 0,
    },
  });

  await manager.start();
  await waitFor(() => manager.getStatus()[0]?.inFlight === 1);
  await manager.stop();

  assert.equal(finished, true);
  assert.equal(client.deleteInputs.length, 1);
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

test('rejects invalid route configuration during registration', () => {
  const manager = new SqsWorkerManager(new FakeSqsClient([]));

  assert.throws(
    () =>
      manager.register({
        name: 'dispatch-email',
        queueUrl: 'https://queue.test/email',
        handle: async () => undefined,
        config: { concurrency: 0 },
      }),
    /invalid concurrency/i,
  );
});

test('preserves bodyless messages by failing decode before delete', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1' }],
    },
  ]);
  const manager = new SqsWorkerManager(client);

  manager.register({
    name: 'dispatch-email',
    queueUrl: 'https://queue.test/email',
    handle: async () => undefined,
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      heartbeatIntervalMs: 0,
    },
  });

  await manager.start();
  await waitFor(() =>
    Boolean(manager.getStatus()[0]?.lastErrorMessage?.includes('missing a body')),
  );
  await manager.stop();

  assert.equal(client.deleteInputs.length, 0);
});

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
