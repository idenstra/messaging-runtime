import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../../../dist/index.js';
import {
  assertLiveAwsSafeEnvironment,
  assertQueueEmpty,
  cleanupFixtures,
  createFixturePrefix,
  createQueue,
  createRecordingSqsAdapter,
  createSdkClients,
  createStandardRuntimeDefaults,
  getCallerIdentity,
  sendQueueJsonMessage,
} from './support.mjs';

const {
  AwsSqsAdapter,
  SqsQueueUrlResolver,
  SqsWorkerManager,
  SqsWorkerServiceHost,
  parseSqsWorkerServiceManifest,
  sqsJsonRoute,
} = runtime;

test('Live AWS worker suite', async (t) => {
  assertLiveAwsSafeEnvironment();

  const { sqs, sns, sts } = createSdkClients();
  await getCallerIdentity(sts);
  const prefix = createFixturePrefix('worker');
  const fixtures = { queues: [], topics: [] };

  const registerQueue = async (input) => {
    const queue = await createQueue(sqs, input);
    fixtures.queues.push(queue);
    return queue;
  };

  try {
    await t.test(
      'service host handles receive-delete, lifecycle hooks, and bounded execution against live AWS',
      async () => {
        const queue = await registerQueue({ name: `${prefix}-host`, visibilityTimeoutSeconds: 5 });
        const adapter = new AwsSqsAdapter(sqs);
        const resolver = new SqsQueueUrlResolver(adapter);
        const lifecycleEvents = [];
        const handledPayloads = [];

        const host = new SqsWorkerServiceHost({
          client: adapter,
          queueResolver: resolver,
          manifest: parseSqsWorkerServiceManifest({ routes: { worker: { queue: queue.name } } }),
          managerOptions: { defaults: createStandardRuntimeDefaults({ visibilityTimeoutSeconds: 5 }) },
          routes: [
            sqsJsonRoute({
              name: 'worker',
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
              handle: async ({ payload }) => {
                handledPayloads.push(payload);
              },
            }),
          ],
        });

        await sendQueueJsonMessage(sqs, queue.url, { jobId: 'worker-1' });
        const result = await host.runBounded({ maxHandledMessagesPerRoute: 1, idleEmptyReceiveWaves: 1 });

        assert.deepEqual(handledPayloads, [{ jobId: 'worker-1' }]);
        assert.deepEqual(lifecycleEvents, ['beforeStart', 'afterStart', 'beforeStop', 'afterStop']);
        assert.deepEqual(result.routes, [{ routeName: 'worker', handledMessageCount: 1, completionReason: 'bounded' }]);
        await assertQueueEmpty(sqs, queue.url);
      },
    );

    await t.test('FIFO ReceiveRequestAttemptId support exercises real AWS request shapes', async () => {
      const queue = await registerQueue({ name: `${prefix}-receive-attempt`, fifo: true, visibilityTimeoutSeconds: 5 });

      await sendQueueJsonMessage(sqs, queue.url, { jobId: 'receive-attempt-1' }, { messageGroupId: 'attempt-group' });
      await sendQueueJsonMessage(sqs, queue.url, { jobId: 'receive-attempt-2' }, { messageGroupId: 'attempt-group' });

      const recording = createRecordingSqsAdapter(sqs);
      recording.failReceiveOnceForQueue(queue.url);
      const handledJobIds = [];
      let attemptSerial = 0;
      const manager = new SqsWorkerManager(recording.adapter, { defaults: createStandardRuntimeDefaults() });

      manager.register(
        sqsJsonRoute({
          name: 'receive-attempt',
          queueUrl: queue.url,
          config: { concurrency: 1, maxMessagesPerPoll: 1 },
          receive: {
            policy: { requestAttemptIdMode: 'custom' },
            createRequestAttemptId: () => `attempt-${++attemptSerial}`,
          },
          handle: async ({ payload }) => {
            handledJobIds.push(payload.jobId);
          },
        }),
      );

      const result = await manager.runBounded({ maxHandledMessagesPerRoute: 2, idleEmptyReceiveWaves: 1 });

      assert.deepEqual(handledJobIds, ['receive-attempt-1', 'receive-attempt-2']);
      assert.deepEqual(result.routes, [
        { routeName: 'receive-attempt', handledMessageCount: 2, completionReason: 'bounded' },
      ]);
      assert.equal(recording.records.receiveInputs[0]?.ReceiveRequestAttemptId, 'attempt-1');
      assert.equal(recording.records.receiveInputs[1]?.ReceiveRequestAttemptId, 'attempt-1');
      assert.equal(recording.records.receiveInputs[2]?.ReceiveRequestAttemptId, 'attempt-2');
      await assertQueueEmpty(sqs, queue.url);
    });
  } finally {
    await cleanupFixtures({ sqs, sns, ...fixtures });
    sts.destroy();
    sns.destroy();
    sqs.destroy();
  }
});
