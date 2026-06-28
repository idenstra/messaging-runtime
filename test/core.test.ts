import { strict as assert } from 'node:assert';
import test from 'node:test';
import type {
  ChangeMessageVisibilityCommandInput,
  DeleteMessageCommandInput,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import { SqsWorkerManager, type SqsRuntimeClient } from '../src';

class FakeSqsClient implements SqsRuntimeClient {
  readonly receiveInputs: ReceiveMessageCommandInput[] = [];
  readonly deleteInputs: DeleteMessageCommandInput[] = [];
  readonly visibilityInputs: ChangeMessageVisibilityCommandInput[] = [];
  private readonly batches: ReceiveMessageCommandOutput[];

  constructor(batches: ReceiveMessageCommandOutput[]) {
    this.batches = [...batches];
  }

  async receiveMessage(input: ReceiveMessageCommandInput): Promise<ReceiveMessageCommandOutput> {
    this.receiveInputs.push(input);
    return this.batches.shift() ?? { Messages: [] };
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
  await sleep(50);
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
  await sleep(50);
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
        { MessageId: 'm3', ReceiptHandle: 'r3', Body: JSON.stringify({ idx: 3 }) },
      ],
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
  await sleep(120);
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
  await sleep(120);
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
  await sleep(10);
  await manager.stop();

  assert.equal(finished, true);
  assert.equal(client.deleteInputs.length, 1);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
