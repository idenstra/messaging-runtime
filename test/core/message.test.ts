import { strict as assert } from 'node:assert';
import test from 'node:test';
import { SqsWorkerManager } from '../../src';
import { FakeSqsClient, waitFor } from './support';

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
