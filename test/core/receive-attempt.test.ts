import { strict as assert } from 'node:assert';
import test from 'node:test';
import { SqsWorkerManager } from '../../src';
import { FakeSqsClient, onceAborted, waitFor } from './support';

test('does not send ReceiveRequestAttemptId when no receive mode is configured', async () => {
  const client = new FakeSqsClient([
    { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) }] },
  ]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
  });

  manager.register({ name: 'jobs', queueUrl: 'https://queue.test/jobs', handle: async () => undefined });

  await manager.start();
  await waitFor(() => client.deleteBatchInputs.length === 1);
  await manager.stop();

  assert.equal(client.receiveInputs[0]?.ReceiveRequestAttemptId, undefined);
});

test('runtime mode sends a generated ReceiveRequestAttemptId for FIFO routes', async () => {
  const client = new FakeSqsClient([
    { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) }] },
  ]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
  });

  manager.register({
    name: 'jobs',
    queueUrl: 'https://queue.test/jobs.fifo',
    handle: async () => undefined,
    receive: { policy: { requestAttemptIdMode: 'runtime' } },
  });

  await manager.start();
  await waitFor(() => client.deleteBatchInputs.length === 1);
  await manager.stop();

  assert.match(client.receiveInputs[0]?.ReceiveRequestAttemptId ?? '', /^[0-9a-f-]{36}$/i);
});

test('custom mode reuses the same ReceiveRequestAttemptId across failed receive retries and clears it after success', async () => {
  const createdAttemptIds: string[] = [];
  const client = new FakeSqsClient([
    async () => {
      throw new Error('receive failed');
    },
    { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) }] },
    async (_input, options) => {
      await onceAborted(options?.abortSignal ?? new AbortController().signal);
      const abortError = new Error('receive aborted');
      abortError.name = 'AbortError';
      throw abortError;
    },
  ]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, errorBackoffMs: 0 },
  });

  manager.register({
    name: 'jobs',
    queueUrl: 'https://queue.test/jobs.fifo',
    handle: async () => undefined,
    receive: {
      policy: { requestAttemptIdMode: 'custom' },
      createRequestAttemptId: () => {
        const attemptId = `attempt-${createdAttemptIds.length + 1}`;
        createdAttemptIds.push(attemptId);
        return attemptId;
      },
    },
  });

  await manager.start();
  await waitFor(() => client.receiveInputs.length >= 3);
  await waitFor(() => client.deleteBatchInputs.length === 1);
  await manager.stop();

  assert.deepEqual(createdAttemptIds, ['attempt-1', 'attempt-2']);
  assert.equal(client.receiveInputs[0]?.ReceiveRequestAttemptId, 'attempt-1');
  assert.equal(client.receiveInputs[1]?.ReceiveRequestAttemptId, 'attempt-1');
  assert.equal(client.receiveInputs[2]?.ReceiveRequestAttemptId, 'attempt-2');
});

test('expired ReceiveRequestAttemptId values are replaced instead of being reused', async () => {
  const createdAttemptIds: string[] = [];
  let nowMs = 0;
  const originalDateNow = Date.now;
  Date.now = () => nowMs;

  try {
    const client = new FakeSqsClient([
      async () => {
        nowMs = 300_001;
        throw new Error('receive failed');
      },
      { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) }] },
    ]);
    const manager = new SqsWorkerManager(client, {
      defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0, errorBackoffMs: 0 },
    });

    manager.register({
      name: 'jobs',
      queueUrl: 'https://queue.test/jobs.fifo',
      handle: async () => undefined,
      receive: {
        policy: { requestAttemptIdMode: 'custom' },
        createRequestAttemptId: () => {
          const attemptId = `attempt-${createdAttemptIds.length + 1}`;
          createdAttemptIds.push(attemptId);
          return attemptId;
        },
      },
    });

    await manager.start();
    await waitFor(() => client.receiveInputs.length >= 2);
    await waitFor(() => client.deleteBatchInputs.length === 1);
    await manager.stop();

    assert.equal(client.receiveInputs[0]?.ReceiveRequestAttemptId, 'attempt-1');
    assert.equal(client.receiveInputs[1]?.ReceiveRequestAttemptId, 'attempt-2');
    assert.deepEqual(createdAttemptIds.slice(0, 2), ['attempt-1', 'attempt-2']);
  } finally {
    Date.now = originalDateNow;
  }
});

test('rejects ReceiveRequestAttemptId mode on non-FIFO queues', () => {
  const manager = new SqsWorkerManager(new FakeSqsClient([]));

  assert.throws(
    () =>
      manager.register({
        name: 'jobs',
        queueUrl: 'https://queue.test/jobs',
        handle: async () => undefined,
        receive: { policy: { requestAttemptIdMode: 'runtime' } },
      }),
    /is not a FIFO queue/i,
  );
});

test('rejects custom ReceiveRequestAttemptId mode without a route callback', () => {
  const manager = new SqsWorkerManager(new FakeSqsClient([]));

  assert.throws(
    () =>
      manager.register({
        name: 'jobs',
        queueUrl: 'https://queue.test/jobs.fifo',
        handle: async () => undefined,
        receive: { policy: { requestAttemptIdMode: 'custom' } },
      }),
    /does not declare createRequestAttemptId/i,
  );
});

test('fails clearly before the AWS call when a custom ReceiveRequestAttemptId is invalid', async () => {
  const client = new FakeSqsClient([]);
  const manager = new SqsWorkerManager(client, {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, errorBackoffMs: 0 },
  });

  manager.register({
    name: 'jobs',
    queueUrl: 'https://queue.test/jobs.fifo',
    handle: async () => undefined,
    receive: { policy: { requestAttemptIdMode: 'custom' }, createRequestAttemptId: () => 'invalid token' },
  });

  await manager.start();
  await waitFor(
    () => manager.getStatus()[0]?.lastPollErrorMessage?.includes('expected AWS-supported characters only') === true,
  );
  await manager.stop();

  assert.equal(client.receiveInputs.length, 0);
});
