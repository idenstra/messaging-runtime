import { strict as assert } from 'node:assert';
import test from 'node:test';
import { parseSqsWorkerServiceManifest, SqsWorkerServiceHost } from '../../src';
import { FakeQueueResolver, FakeSqsClient, sleep, waitFor } from './support';

test('parses a JSON manifest and preserves the serializable route shape', () => {
  const manifest = parseSqsWorkerServiceManifest(
    JSON.stringify({
      defaults: { concurrency: 2, waitTimeSeconds: 1 },
      receiveDefaults: { requestAttemptIdMode: 'runtime' },
      routes: {
        dispatch: {
          queue: 'dispatch-queue',
          config: { maxMessagesPerPoll: 1 },
          receive: { requestAttemptIdMode: 'custom' },
        },
        feedback: { enabled: false },
      },
    }),
  );

  assert.deepEqual(manifest, {
    defaults: { concurrency: 2, waitTimeSeconds: 1 },
    receiveDefaults: { requestAttemptIdMode: 'runtime' },
    routes: {
      dispatch: {
        enabled: undefined,
        queue: 'dispatch-queue',
        config: { maxMessagesPerPoll: 1 },
        receive: { requestAttemptIdMode: 'custom' },
      },
      feedback: { enabled: false, queue: undefined, config: undefined, receive: undefined },
    },
  });
});

test('rejects manifest routes that do not match a registered route', () => {
  const client = new FakeSqsClient();
  const resolver = new FakeQueueResolver({ 'dispatch-queue': 'https://queue.test/dispatch' });

  assert.throws(
    () =>
      new SqsWorkerServiceHost({
        client,
        queueResolver: resolver,
        routes: [{ name: 'dispatch', queue: 'dispatch-queue', handle: async () => undefined }],
        manifest: parseSqsWorkerServiceManifest({ routes: { feedback: { queue: 'dispatch-queue' } } }),
      }),
    /does not match any registered route/i,
  );
});

test('rejects duplicate manifest route names after normalization', () => {
  assert.throws(
    () => parseSqsWorkerServiceManifest({ routes: { dispatch: {}, ' dispatch ': {} } }),
    /duplicate route entries/i,
  );
});

test('rejects enabled routes without a queue binding in the manifest or route definition', () => {
  const client = new FakeSqsClient();
  const resolver = new FakeQueueResolver({});

  assert.throws(
    () =>
      new SqsWorkerServiceHost({
        client,
        queueResolver: resolver,
        routes: [{ name: 'dispatch', handle: async () => undefined }],
        manifest: parseSqsWorkerServiceManifest({ routes: { dispatch: {} } }),
      }),
    /has no queue binding/i,
  );
});

test('activates only manifest-enabled routes and merges config with the documented precedence', async () => {
  const dispatchQueueUrl = 'https://queue.test/dispatch';
  const feedbackQueueUrl = 'https://queue.test/feedback';
  const client = new FakeSqsClient().withMessage(dispatchQueueUrl, {
    MessageId: 'm1',
    ReceiptHandle: 'r1',
    Body: JSON.stringify({ type: 'dispatch' }),
  });
  const resolver = new FakeQueueResolver({ 'dispatch-queue': dispatchQueueUrl, 'feedback-queue': feedbackQueueUrl });
  const handledPayloads: string[] = [];
  const host = new SqsWorkerServiceHost({
    client,
    queueResolver: resolver,
    routes: [
      {
        name: 'dispatch',
        queue: 'dispatch-queue',
        handle: async ({ payload }) => {
          handledPayloads.push((payload as { type: string }).type);
        },
        config: { maxMessagesPerPoll: 2, waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
      },
      {
        name: 'feedback',
        queue: 'feedback-queue',
        handle: async () => undefined,
        config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
      },
    ],
    manifest: parseSqsWorkerServiceManifest({
      defaults: { concurrency: 5, maxMessagesPerPoll: 9, waitTimeSeconds: 1 },
      routes: { dispatch: { config: { concurrency: 3, waitTimeSeconds: 4 } }, feedback: { enabled: false } },
    }),
  });

  await host.start();
  await waitFor(() => client.deleteBatchInputs.length === 1);
  await host.stop();

  assert.deepEqual(handledPayloads, ['dispatch']);
  assert.deepEqual(resolver.identifiers, ['dispatch-queue']);
  assert.equal(
    client.receiveInputs.every((input) => input.QueueUrl === dispatchQueueUrl),
    true,
  );
  assert.equal(
    client.receiveInputs.some((input) => input.QueueUrl === feedbackQueueUrl),
    false,
  );
  assert.equal(client.receiveInputs[0]?.MaxNumberOfMessages, 2);
  assert.equal(client.receiveInputs[0]?.WaitTimeSeconds, 4);
  assert.equal(host.getStatus().length, 1);
  assert.equal(host.getSnapshot().routeCount, 1);
  assert.equal(host.getSnapshot().routes[0]?.name, 'dispatch');
});

test('manifest receive defaults can enable runtime-generated ReceiveRequestAttemptId for FIFO routes', async () => {
  const dispatchQueueUrl = 'https://queue.test/dispatch.fifo';
  const client = new FakeSqsClient().withMessage(dispatchQueueUrl, {
    MessageId: 'm1',
    ReceiptHandle: 'r1',
    Body: JSON.stringify({ type: 'dispatch' }),
  });
  const resolver = new FakeQueueResolver({ 'dispatch-queue': dispatchQueueUrl });
  const host = new SqsWorkerServiceHost({
    client,
    queueResolver: resolver,
    routes: [
      {
        name: 'dispatch',
        queue: 'dispatch-queue',
        handle: async () => undefined,
        config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
      },
    ],
    manifest: parseSqsWorkerServiceManifest({
      receiveDefaults: { requestAttemptIdMode: 'runtime' },
      routes: { dispatch: {} },
    }),
  });

  await host.start();
  await waitFor(() => client.deleteBatchInputs.length === 1);
  await host.stop();

  assert.match(client.receiveInputs[0]?.ReceiveRequestAttemptId ?? '', /^[0-9a-f-]{36}$/i);
});

test('manifest route receive policy can select custom mode while route code owns the callback', async () => {
  const dispatchQueueUrl = 'https://queue.test/dispatch.fifo';
  const client = new FakeSqsClient().withMessage(dispatchQueueUrl, {
    MessageId: 'm1',
    ReceiptHandle: 'r1',
    Body: JSON.stringify({ type: 'dispatch' }),
  });
  const resolver = new FakeQueueResolver({ 'dispatch-queue': dispatchQueueUrl });
  const createdAttemptIds: string[] = [];
  const host = new SqsWorkerServiceHost({
    client,
    queueResolver: resolver,
    routes: [
      {
        name: 'dispatch',
        queue: 'dispatch-queue',
        handle: async () => undefined,
        receive: {
          createRequestAttemptId: () => {
            const attemptId = `dispatch-attempt-${createdAttemptIds.length + 1}`;
            createdAttemptIds.push(attemptId);
            return attemptId;
          },
        },
        config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
      },
    ],
    manifest: parseSqsWorkerServiceManifest({ routes: { dispatch: { receive: { requestAttemptIdMode: 'custom' } } } }),
  });

  await host.start();
  await waitFor(() => client.deleteBatchInputs.length === 1);
  await host.stop();

  assert.equal(createdAttemptIds[0], 'dispatch-attempt-1');
  assert.equal(createdAttemptIds.length >= 1, true);
  assert.equal(client.receiveInputs[0]?.ReceiveRequestAttemptId, 'dispatch-attempt-1');
});

test('manifest route receive policy overrides route receive policy with the documented precedence', async () => {
  const dispatchQueueUrl = 'https://queue.test/dispatch.fifo';
  const client = new FakeSqsClient().withMessage(dispatchQueueUrl, {
    MessageId: 'm1',
    ReceiptHandle: 'r1',
    Body: JSON.stringify({ type: 'dispatch' }),
  });
  const resolver = new FakeQueueResolver({ 'dispatch-queue': dispatchQueueUrl });
  const host = new SqsWorkerServiceHost({
    client,
    queueResolver: resolver,
    routes: [
      {
        name: 'dispatch',
        queue: 'dispatch-queue',
        handle: async () => undefined,
        receive: { policy: { requestAttemptIdMode: 'runtime' } },
        config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
      },
    ],
    manifest: parseSqsWorkerServiceManifest({ routes: { dispatch: { receive: { requestAttemptIdMode: 'off' } } } }),
  });

  await host.start();
  await waitFor(() => client.deleteBatchInputs.length === 1);
  await host.stop();

  assert.equal(client.receiveInputs[0]?.ReceiveRequestAttemptId, undefined);
});

test('empty manifest receive patches do not override route or manager receive defaults', async () => {
  const dispatchQueueUrl = 'https://queue.test/dispatch.fifo';
  const client = new FakeSqsClient().withMessage(dispatchQueueUrl, {
    MessageId: 'm1',
    ReceiptHandle: 'r1',
    Body: JSON.stringify({ type: 'dispatch' }),
  });
  const resolver = new FakeQueueResolver({ 'dispatch-queue': dispatchQueueUrl });
  const host = new SqsWorkerServiceHost({
    client,
    queueResolver: resolver,
    managerOptions: { receiveDefaults: { requestAttemptIdMode: 'runtime' } },
    routes: [
      {
        name: 'dispatch',
        queue: 'dispatch-queue',
        handle: async () => undefined,
        receive: { policy: { requestAttemptIdMode: 'runtime' } },
        config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
      },
    ],
    manifest: parseSqsWorkerServiceManifest({ receiveDefaults: {}, routes: { dispatch: { receive: {} } } }),
  });

  await host.start();
  await waitFor(() => client.deleteBatchInputs.length === 1);
  await host.stop();

  assert.match(client.receiveInputs[0]?.ReceiveRequestAttemptId ?? '', /^[0-9a-f-]{36}$/i);
});

test('accepts queue identifiers as name, URL, or ARN and resolves them through the injected resolver', async () => {
  const client = new FakeSqsClient();
  const resolver = new FakeQueueResolver({
    'dispatch-name': 'https://queue.test/dispatch',
    'https://queue.test/feedback': 'https://queue.test/feedback',
    'arn:aws:sqs:us-east-1:123456789012:events-queue': 'https://queue.test/events',
  });
  const host = new SqsWorkerServiceHost({
    client,
    queueResolver: resolver,
    routes: [
      {
        name: 'dispatch',
        queue: 'dispatch-name',
        handle: async () => undefined,
        config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
      },
      {
        name: 'feedback',
        queue: 'https://queue.test/feedback',
        handle: async () => undefined,
        config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
      },
      {
        name: 'events',
        handle: async () => undefined,
        config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
      },
    ],
    manifest: parseSqsWorkerServiceManifest({
      routes: { dispatch: {}, feedback: {}, events: { queue: 'arn:aws:sqs:us-east-1:123456789012:events-queue' } },
    }),
  });

  await host.start();
  await sleep(20);
  await host.stop();

  assert.deepEqual(resolver.identifiers, [
    'dispatch-name',
    'https://queue.test/feedback',
    'arn:aws:sqs:us-east-1:123456789012:events-queue',
  ]);
});
