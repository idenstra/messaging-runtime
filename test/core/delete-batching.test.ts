import { strict as assert } from 'node:assert';
import test from 'node:test';
import { SqsWorkerManager } from '../../src';
import { FakeSqsClient, waitFor } from './support';

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
