import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../../../dist/index.js';
import {
  createQueue,
  createRecordingSqsAdapter,
  createSdkClients,
  createStandardRuntimeDefaults,
  createSuitePrefix,
  parseJsonMessageBody,
  sendQueueJsonMessage,
  sleep,
  waitForCondition,
  waitForMessages,
} from './support.mjs';

const { SqsQueueUrlResolver, SqsWorkerManager, SqsWorkerServiceHost, parseSqsWorkerServiceManifest, sqsJsonRoute } =
  runtime;

test('LocalStack runtime suite', async (t) => {
  const prefix = createSuitePrefix('runtime');
  const { sqs } = createSdkClients();

  await t.test(
    'service host activation, lifecycle hooks, idle execution, and typed system attributes work end-to-end',
    async () => {
      const queue = await createQueue(sqs, { name: `${prefix}-host-jobs`, visibilityTimeoutSeconds: 3 });
      await sendQueueJsonMessage(sqs, queue.url, { jobId: 'job-1' });

      const recording = createRecordingSqsAdapter(sqs);
      const resolver = new SqsQueueUrlResolver(recording.adapter);
      const lifecycleEvents = [];
      const handledPayloads = [];
      const seenSystemAttributes = [];

      const host = new SqsWorkerServiceHost({
        client: recording.adapter,
        queueResolver: resolver,
        manifest: parseSqsWorkerServiceManifest({ routes: { dispatch: { queue: queue.name } } }),
        managerOptions: { defaults: createStandardRuntimeDefaults() },
        routes: [
          sqsJsonRoute({
            name: 'dispatch',
            lifecycle: {
              beforeStart: () => {
                lifecycleEvents.push('beforeStart');
              },
              afterStart: () => {
                lifecycleEvents.push('afterStart');
              },
              beforeStop: () => {
                lifecycleEvents.push('beforeStop');
              },
              afterStop: () => {
                lifecycleEvents.push('afterStop');
              },
            },
            handle: async ({ payload, message }) => {
              handledPayloads.push(payload);
              seenSystemAttributes.push({
                receiveCount: message.systemAttributes.ApproximateReceiveCount,
                sentTimestampIsDate: message.systemAttributes.SentTimestamp instanceof Date,
                firstReceiveTimestampIsDate: message.systemAttributes.ApproximateFirstReceiveTimestamp instanceof Date,
              });
            },
          }),
        ],
      });

      const result = await host.runUntilIdle({ idleEmptyReceiveWaves: 1 });

      assert.deepEqual(handledPayloads, [{ jobId: 'job-1' }]);
      assert.deepEqual(seenSystemAttributes, [
        { receiveCount: 1, sentTimestampIsDate: true, firstReceiveTimestampIsDate: true },
      ]);
      assert.deepEqual(lifecycleEvents, ['beforeStart', 'afterStart', 'beforeStop', 'afterStop']);
      assert.deepEqual(result.routes, [{ routeName: 'dispatch', handledMessageCount: 1, completionReason: 'idle' }]);
      assert.equal(
        recording.records.receiveInputs.some(
          (input) =>
            Array.isArray(input.MessageSystemAttributeNames) &&
            input.MessageSystemAttributeNames.includes('All') &&
            Array.isArray(input.MessageAttributeNames) &&
            input.MessageAttributeNames.includes('All'),
        ),
        true,
      );
    },
  );

  await t.test('keep semantics allow LocalStack redelivery back to the same worker route', async () => {
    const queue = await createQueue(sqs, { name: `${prefix}-keep-redelivery`, visibilityTimeoutSeconds: 1 });
    await sendQueueJsonMessage(sqs, queue.url, { jobId: 'keep-1' });

    const recording = createRecordingSqsAdapter(sqs);
    const approximateReceiveCounts = [];
    const manager = new SqsWorkerManager(recording.adapter, {
      defaults: createStandardRuntimeDefaults({ visibilityTimeoutSeconds: 1 }),
    });

    manager.register(
      sqsJsonRoute({
        name: 'keep-redelivery',
        queueUrl: queue.url,
        config: { failureAction: 'keep', visibilityTimeoutSeconds: 1, emptyReceiveDelayMs: 50 },
        handle: async ({ message }) => {
          approximateReceiveCounts.push(message.systemAttributes.ApproximateReceiveCount);
          throw new Error('expected LocalStack keep failure');
        },
      }),
    );

    await manager.start();
    try {
      await waitForCondition(() => approximateReceiveCounts.length >= 2, {
        timeoutMs: 12_000,
        intervalMs: 250,
        description: 'LocalStack keep/redelivery cycle',
      });
    } finally {
      await manager.stop();
    }

    assert.deepEqual(approximateReceiveCounts.slice(0, 2), [1, 2]);
    assert.equal(manager.getSnapshot().counters.messageDeleteCount, 0);
  });

  await t.test(
    'automatic visibility heartbeats call changeMessageVisibility while the handler is still running',
    async () => {
      const queue = await createQueue(sqs, { name: `${prefix}-heartbeat`, visibilityTimeoutSeconds: 1 });
      await sendQueueJsonMessage(sqs, queue.url, { jobId: 'heartbeat-1' });

      const recording = createRecordingSqsAdapter(sqs);
      const manager = new SqsWorkerManager(recording.adapter, {
        defaults: createStandardRuntimeDefaults({ visibilityTimeoutSeconds: 1, heartbeatIntervalMs: 200 }),
      });

      manager.register(
        sqsJsonRoute({
          name: 'heartbeat',
          queueUrl: queue.url,
          config: { visibilityTimeoutSeconds: 1, heartbeatIntervalMs: 200 },
          handle: async () => {
            await sleep(700);
          },
        }),
      );

      await manager.runUntilIdle({ idleEmptyReceiveWaves: 1 });

      assert.equal(recording.records.visibilityInputs.length >= 1, true);
    },
  );

  await t.test('stop aborts an in-flight long poll instead of waiting for the full receive timeout', async () => {
    const queue = await createQueue(sqs, { name: `${prefix}-long-poll-stop`, visibilityTimeoutSeconds: 3 });

    const manager = new SqsWorkerManager(new runtime.AwsSqsAdapter(sqs), {
      defaults: createStandardRuntimeDefaults({ waitTimeSeconds: 10 }),
    });

    manager.register(
      sqsJsonRoute({
        name: 'long-poll-stop',
        queueUrl: queue.url,
        config: { waitTimeSeconds: 10 },
        handle: async () => undefined,
      }),
    );

    await manager.start();
    await sleep(250);

    const stopStartedAt = Date.now();
    await manager.stop();
    const stopElapsedMs = Date.now() - stopStartedAt;

    assert.equal(stopElapsedMs < 3_000, true);
  });

  await t.test('route-local delete batching flushes real LocalStack messages through DeleteMessageBatch', async () => {
    const queue = await createQueue(sqs, { name: `${prefix}-delete-batch`, visibilityTimeoutSeconds: 3 });
    await sendQueueJsonMessage(sqs, queue.url, { jobId: 'delete-1' });
    await sendQueueJsonMessage(sqs, queue.url, { jobId: 'delete-2' });

    const recording = createRecordingSqsAdapter(sqs);
    const handledJobIds = [];
    const manager = new SqsWorkerManager(recording.adapter, { defaults: createStandardRuntimeDefaults() });

    manager.register(
      sqsJsonRoute({
        name: 'delete-batch',
        queueUrl: queue.url,
        config: { concurrency: 2, maxMessagesPerPoll: 2 },
        handle: async ({ payload }) => {
          handledJobIds.push(payload.jobId);
        },
      }),
    );

    await manager.runUntilIdle({ idleEmptyReceiveWaves: 1 });

    assert.deepEqual(handledJobIds.sort(), ['delete-1', 'delete-2']);
    assert.equal(
      recording.records.deleteBatchInputs.some((input) => Array.isArray(input.Entries) && input.Entries.length === 2),
      true,
    );
  });

  await t.test('bounded finite-run leaves excess messages on the queue after draining admitted work', async () => {
    const queue = await createQueue(sqs, { name: `${prefix}-bounded`, visibilityTimeoutSeconds: 3 });
    await sendQueueJsonMessage(sqs, queue.url, { jobId: 'bounded-1' });
    await sendQueueJsonMessage(sqs, queue.url, { jobId: 'bounded-2' });
    await sendQueueJsonMessage(sqs, queue.url, { jobId: 'bounded-3' });

    const recording = createRecordingSqsAdapter(sqs);
    const handledJobIds = [];
    const manager = new SqsWorkerManager(recording.adapter, { defaults: createStandardRuntimeDefaults() });

    manager.register(
      sqsJsonRoute({
        name: 'bounded',
        queueUrl: queue.url,
        config: { concurrency: 1, maxMessagesPerPoll: 2 },
        handle: async ({ payload }) => {
          handledJobIds.push(payload.jobId);
        },
      }),
    );

    const result = await manager.runBounded({ maxHandledMessagesPerRoute: 2, idleEmptyReceiveWaves: 1 });
    const leftoverMessages = await waitForMessages(sqs, queue.url, {
      expectedCount: 1,
      timeoutMs: 5_000,
      deleteReceived: false,
    });

    assert.deepEqual(handledJobIds, ['bounded-1', 'bounded-2']);
    assert.deepEqual(result.routes, [{ routeName: 'bounded', handledMessageCount: 2, completionReason: 'bounded' }]);
    assert.deepEqual(parseJsonMessageBody(leftoverMessages[0]), { jobId: 'bounded-3' });
  });

  await t.test(
    'FIFO receive-attempt support reuses runtime tokens after a failed receive and accepts custom tokens',
    async () => {
      const runtimeQueue = await createQueue(sqs, {
        name: `${prefix}-fifo-runtime`,
        fifo: true,
        visibilityTimeoutSeconds: 3,
      });
      const customQueue = await createQueue(sqs, {
        name: `${prefix}-fifo-custom`,
        fifo: true,
        visibilityTimeoutSeconds: 3,
      });

      await sendQueueJsonMessage(
        sqs,
        runtimeQueue.url,
        { jobId: 'runtime-token' },
        { messageGroupId: 'runtime-group', messageDeduplicationId: 'runtime-token' },
      );
      await sendQueueJsonMessage(
        sqs,
        customQueue.url,
        { jobId: 'custom-token' },
        { messageGroupId: 'custom-group', messageDeduplicationId: 'custom-token' },
      );

      const runtimeRecording = createRecordingSqsAdapter(sqs);
      runtimeRecording.failReceiveOnceForQueue(runtimeQueue.url);
      const runtimeManager = new SqsWorkerManager(runtimeRecording.adapter, {
        defaults: createStandardRuntimeDefaults(),
      });

      runtimeManager.register(
        sqsJsonRoute({
          name: 'fifo-runtime',
          queueUrl: runtimeQueue.url,
          receive: { policy: { requestAttemptIdMode: 'runtime' } },
          handle: async () => undefined,
        }),
      );

      await runtimeManager.runUntilIdle({ idleEmptyReceiveWaves: 1 });

      assert.equal(typeof runtimeRecording.records.receiveInputs[0]?.ReceiveRequestAttemptId, 'string');
      assert.equal(
        runtimeRecording.records.receiveInputs[0]?.ReceiveRequestAttemptId,
        runtimeRecording.records.receiveInputs[1]?.ReceiveRequestAttemptId,
      );
      assert.notEqual(
        runtimeRecording.records.receiveInputs[1]?.ReceiveRequestAttemptId,
        runtimeRecording.records.receiveInputs.at(-1)?.ReceiveRequestAttemptId,
      );

      const customRecording = createRecordingSqsAdapter(sqs);
      const customManager = new SqsWorkerManager(customRecording.adapter, {
        defaults: createStandardRuntimeDefaults(),
      });

      customManager.register(
        sqsJsonRoute({
          name: 'fifo-custom',
          queueUrl: customQueue.url,
          receive: {
            policy: { requestAttemptIdMode: 'custom' },
            createRequestAttemptId: () => 'custom-request-attempt-token',
          },
          handle: async () => undefined,
        }),
      );

      await customManager.runUntilIdle({ idleEmptyReceiveWaves: 1 });

      assert.equal(
        customRecording.records.receiveInputs.some(
          (input) => input.ReceiveRequestAttemptId === 'custom-request-attempt-token',
        ),
        true,
      );
    },
  );
});
