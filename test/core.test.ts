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
import {
  type SqsRuntimeClient,
  type SqsRuntimeRequestOptions,
  SqsWorkerManager,
  type SqsWorkerRuntimeEvent,
} from '../src';

type ReceiveBatch =
  | ReceiveMessageCommandOutput
  | ((input: ReceiveMessageCommandInput, options?: SqsRuntimeRequestOptions) => Promise<ReceiveMessageCommandOutput>);

class FakeSqsClient implements SqsRuntimeClient {
  readonly receiveInputs: ReceiveMessageCommandInput[] = [];
  readonly deleteInputs: DeleteMessageCommandInput[] = [];
  readonly deleteBatchInputs: DeleteMessageBatchCommandInput[] = [];
  readonly visibilityInputs: ChangeMessageVisibilityCommandInput[] = [];
  private readonly batches: ReceiveBatch[];
  deleteImpl?: (input: DeleteMessageCommandInput) => Promise<void>;
  deleteBatchImpl?: (input: DeleteMessageBatchCommandInput) => Promise<DeleteMessageBatchCommandOutput>;
  visibilityImpl?: (input: ChangeMessageVisibilityCommandInput) => Promise<void>;

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

    this.batches.unshift({ ...next, Messages: messages.slice(maxMessages) });

    return { ...next, Messages: messages.slice(0, maxMessages) };
  }

  async deleteMessage(input: DeleteMessageCommandInput): Promise<void> {
    this.deleteInputs.push(input);
    await this.deleteImpl?.(input);
  }

  async deleteMessageBatch(input: DeleteMessageBatchCommandInput): Promise<DeleteMessageBatchCommandOutput> {
    this.deleteBatchInputs.push(input);
    if (this.deleteBatchImpl) {
      return this.deleteBatchImpl(input);
    }

    return { Successful: (input.Entries ?? []).flatMap((entry) => (entry.Id ? [{ Id: entry.Id }] : [])), Failed: [] };
  }

  async changeMessageVisibility(input: ChangeMessageVisibilityCommandInput): Promise<void> {
    this.visibilityInputs.push(input);
    await this.visibilityImpl?.(input);
  }
}

test('deletes messages after successful handler execution and updates snapshots', async () => {
  const client = new FakeSqsClient([
    { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ kind: 'alpha' }) }] },
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
    config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
  });

  await manager.start();
  await waitFor(() => client.deleteBatchInputs.length === 1);
  await manager.stop();

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.routeCount, 1);
  assert.equal(snapshot.totalInFlight, 0);
  assert.equal(snapshot.totalBuffered, 0);
  assert.equal(snapshot.counters.messagesReceivedCount, 1);
  assert.equal(snapshot.counters.handlerStartedCount, 1);
  assert.equal(snapshot.counters.handlerSuccessCount, 1);
  assert.equal(snapshot.counters.messageDeleteCount, 1);
  assert.equal(snapshot.routes[0]?.buffered, 0);
  assert.equal(snapshot.routes[0]?.counters.messageDeleteCount, 1);
  assert.equal(client.deleteBatchInputs[0]?.Entries?.[0]?.ReceiptHandle, 'r1');
  assert.equal(client.deleteInputs.length, 0);
  assert.deepEqual(client.receiveInputs[0]?.MessageSystemAttributeNames, ['All']);
  assert.deepEqual(client.receiveInputs[0]?.MessageAttributeNames, ['All']);
  assert.equal(client.receiveInputs[0]?.AttributeNames, undefined);
  assert.ok(abortSignalObserved);
  assert.equal(abortSignalObserved?.aborted, false);
  assert.deepEqual(events.slice(0, 2), ['messages-received', 'handler-start']);
  assert.equal(events.includes('handler-success'), true);
  assert.equal(events.includes('message-delete'), true);
});

test('normalizes typed system attributes while preserving raw worker message attributes', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        {
          MessageId: 'm1',
          ReceiptHandle: 'r1',
          Body: JSON.stringify({ kind: 'alpha' }),
          Attributes: {
            ApproximateReceiveCount: '3',
            ApproximateFirstReceiveTimestamp: '1717171717000',
            SentTimestamp: '1717171718000',
            SenderId: 'sender-1',
            MessageGroupId: 'group-1',
            MessageDeduplicationId: 'dedupe-1',
            SequenceNumber: '42',
            AWSTraceHeader: 'Root=1-abc',
            DeadLetterQueueSourceArn: 'arn:aws:sqs:us-east-1:123456789012:jobs-dlq',
          },
        },
      ],
    },
  ]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
  });
  let observedReceiveCount = 0;
  let observedFirstReceiveAt: Date | undefined;
  let observedSentAt: Date | undefined;
  let observedRawAttributes: Record<string, string> | undefined;

  manager.register<{ kind: string }>({
    name: 'typed-system-attributes',
    queueUrl: 'https://queue.test/email',
    handle: async ({ message, payload }) => {
      assert.equal(payload.kind, 'alpha');
      observedReceiveCount = message.systemAttributes.ApproximateReceiveCount ?? 0;
      observedFirstReceiveAt = message.systemAttributes.ApproximateFirstReceiveTimestamp;
      observedSentAt = message.systemAttributes.SentTimestamp;
      observedRawAttributes = message.attributes;
      assert.equal(message.systemAttributes.SenderId, 'sender-1');
      assert.equal(message.systemAttributes.MessageGroupId, 'group-1');
      assert.equal(message.systemAttributes.MessageDeduplicationId, 'dedupe-1');
      assert.equal(message.systemAttributes.SequenceNumber, '42');
      assert.equal(message.systemAttributes.AWSTraceHeader, 'Root=1-abc');
      assert.equal(message.systemAttributes.DeadLetterQueueSourceArn, 'arn:aws:sqs:us-east-1:123456789012:jobs-dlq');
      assert.equal(message.attributes.ApproximateReceiveCount, '3');
    },
  });

  await manager.start();
  await waitFor(() => client.deleteBatchInputs.length === 1);
  await manager.stop();

  assert.equal(observedReceiveCount, 3);
  assert.equal(observedFirstReceiveAt?.toISOString(), new Date(1717171717000).toISOString());
  assert.equal(observedSentAt?.toISOString(), new Date(1717171718000).toISOString());
  assert.equal(observedRawAttributes?.ApproximateReceiveCount, '3');
  assert.equal(observedRawAttributes?.ApproximateFirstReceiveTimestamp, '1717171717000');
  assert.equal(observedRawAttributes?.SentTimestamp, '1717171718000');
});

test('fails clearly when worker message system attributes cannot be normalized', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        {
          MessageId: 'm1',
          ReceiptHandle: 'r1',
          Body: JSON.stringify({ kind: 'alpha' }),
          Attributes: { ApproximateReceiveCount: '3oops' },
        },
      ],
    },
  ]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
  });
  let handlerCalled = false;

  manager.register({
    name: 'invalid-system-attributes',
    queueUrl: 'https://queue.test/email',
    handle: async () => {
      handlerCalled = true;
    },
  });

  await manager.start();
  await waitFor(
    () =>
      manager.getStatus()[0]?.lastErrorMessage?.includes('ApproximateReceiveCount must be a valid integer') === true,
  );
  await manager.stop();

  assert.equal(handlerCalled, false);
  assert.equal(client.deleteBatchInputs.length, 0);
  assert.equal(client.deleteInputs.length, 0);
});

test('fails clearly when worker message timestamp system attributes are only partially numeric', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        {
          MessageId: 'm1',
          ReceiptHandle: 'r1',
          Body: JSON.stringify({ kind: 'alpha' }),
          Attributes: { SentTimestamp: '1717ms' },
        },
      ],
    },
  ]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
  });
  let handlerCalled = false;

  manager.register({
    name: 'invalid-timestamp-system-attributes',
    queueUrl: 'https://queue.test/email',
    handle: async () => {
      handlerCalled = true;
    },
  });

  await manager.start();
  await waitFor(
    () =>
      manager.getStatus()[0]?.lastErrorMessage?.includes('SentTimestamp must be a valid epoch-millisecond integer') ===
      true,
  );
  await manager.stop();

  assert.equal(handlerCalled, false);
  assert.equal(client.deleteBatchInputs.length, 0);
  assert.equal(client.deleteInputs.length, 0);
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

test('delete batching flushes immediately at the AWS batch size limit', async () => {
  const client = new FakeSqsClient([
    {
      Messages: Array.from({ length: 10 }, (_, index) => ({
        MessageId: `m${index + 1}`,
        ReceiptHandle: `r${index + 1}`,
        Body: JSON.stringify({ jobId: `job-${index + 1}` }),
      })),
    },
  ]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 10 },
  });

  manager.register({
    name: 'delete-batch-size',
    queueUrl: 'https://queue.test/delete-batch-size',
    handle: async () => undefined,
    config: { concurrency: 10 },
  });

  await manager.start();
  await waitFor(() => client.deleteBatchInputs.some((input) => input.Entries?.length === 10));
  await manager.stop();

  assert.equal(client.deleteBatchInputs[0]?.Entries?.length, 10);
  assert.equal(client.deleteInputs.length, 0);
});

test('partial batch delete failures retry only the failed receipt handles individually', async () => {
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
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 2 },
  });

  manager.register({
    name: 'delete-batch-retry',
    queueUrl: 'https://queue.test/delete-batch-retry',
    handle: async () => undefined,
    config: { concurrency: 2 },
  });

  await manager.start();
  await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 2);
  await manager.stop();

  assert.equal(client.deleteBatchInputs.length, 1);
  assert.equal(client.deleteInputs.length, 1);
  assert.equal(client.deleteInputs[0]?.ReceiptHandle, 'r2');
});

test('keep and keep-on-failure paths do not enqueue batched deletes', async () => {
  const client = new FakeSqsClient([
    {
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) },
        { MessageId: 'm2', ReceiptHandle: 'r2', Body: JSON.stringify({ jobId: 'job-2' }) },
      ],
    },
  ]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 2 },
  });

  manager.register({
    name: 'keep-paths',
    queueUrl: 'https://queue.test/keep-paths',
    handle: async ({ message }) => {
      if (message.messageId === 'm2') {
        throw new Error('boom');
      }
      return { action: 'keep' };
    },
    config: { concurrency: 2, failureAction: 'keep' },
  });

  await manager.start();
  await waitFor(() => manager.getSnapshot().counters.messageKeepCount === 2);
  await manager.stop();

  assert.equal(client.deleteBatchInputs.length, 0);
  assert.equal(client.deleteInputs.length, 0);
});

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

function createDeferred<T>(): { promise: Promise<T>; resolve: (value?: T | PromiseLike<T>) => void } {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}
