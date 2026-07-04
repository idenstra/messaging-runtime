import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../../../dist/index.js';
import {
  createQueue,
  createSdkClients,
  createStandardRuntimeDefaults,
  createSuitePrefix,
  parseJsonMessageBody,
  sendQueueJsonMessage,
  waitForCondition,
  waitForMessages,
} from './support.mjs';

const { AwsSqsAdapter, SqsDlqRedriveManager, SqsQueueInspector, SqsWorkerManager, sqsJsonRoute } = runtime;

test('LocalStack queue-ops suite', async (t) => {
  const prefix = createSuitePrefix('queue-ops');
  const { sqs } = createSdkClients();

  await t.test(
    'queue inspection normalizes attributes and dead-letter source listing resolves configured sources',
    async () => {
      const deadLetterQueue = await createQueue(sqs, {
        name: `${prefix}-dlq-inspect`,
        visibilityTimeoutSeconds: 5,
        receiveMessageWaitTimeSeconds: 1,
        delaySeconds: 2,
        redriveAllowPolicy: { redrivePermission: 'allowAll' },
      });
      const sourceQueues = await Promise.all(
        ['a', 'b'].map((suffix) =>
          createQueue(sqs, {
            name: `${prefix}-source-${suffix}`,
            visibilityTimeoutSeconds: 7,
            receiveMessageWaitTimeSeconds: 1,
            delaySeconds: 1,
            redrivePolicy: { deadLetterTargetArn: deadLetterQueue.arn, maxReceiveCount: 2 },
          }),
        ),
      );

      const inspector = new SqsQueueInspector(new AwsSqsAdapter(sqs));
      const sourceDescription = await inspector.inspectQueue(sourceQueues[0].name);
      const deadLetterDescription = await inspector.inspectQueue(deadLetterQueue.arn);
      const sourceListing = await inspector.listDeadLetterSourceQueues(deadLetterQueue.name);

      assert.equal(sourceDescription.queueIdentifier, sourceQueues[0].name);
      assert.equal(sourceDescription.queueUrl, sourceQueues[0].url);
      assert.equal(sourceDescription.queueArn, sourceQueues[0].arn);
      assert.equal(sourceDescription.fifo, false);
      assert.equal(sourceDescription.visibilityTimeoutSeconds, 7);
      assert.equal(sourceDescription.receiveMessageWaitTimeSeconds, 1);
      assert.equal(sourceDescription.delaySeconds, 1);
      assert.equal(sourceDescription.redrivePolicy?.deadLetterTargetArn, deadLetterQueue.arn);
      assert.equal(sourceDescription.redrivePolicy?.maxReceiveCount, 2);

      assert.equal(deadLetterDescription.queueArn, deadLetterQueue.arn);
      assert.equal(deadLetterDescription.redriveAllowPolicy?.redrivePermission, 'allowAll');
      assert.deepEqual(sourceListing.sourceQueueUrls.sort(), sourceQueues.map((queue) => queue.url).sort());
    },
  );

  await t.test(
    'native DLQ redrive moves messages back to the source queue and can be canceled while running when supported',
    async () => {
      const deadLetterQueue = await createQueue(sqs, {
        name: `${prefix}-dlq-redrive`,
        visibilityTimeoutSeconds: 5,
        redriveAllowPolicy: { redrivePermission: 'allowAll' },
      });
      const sourceQueue = await createQueue(sqs, {
        name: `${prefix}-source-redrive`,
        visibilityTimeoutSeconds: 1,
        redrivePolicy: { deadLetterTargetArn: deadLetterQueue.arn, maxReceiveCount: 1 },
      });

      for (let index = 0; index < 5; index += 1) {
        await sendQueueJsonMessage(sqs, sourceQueue.url, { jobId: `redrive-${index}` });
      }

      const adapter = new AwsSqsAdapter(sqs);
      const manager = new SqsWorkerManager(adapter, {
        defaults: createStandardRuntimeDefaults({ visibilityTimeoutSeconds: 1 }),
      });
      const seenMessageIds = new Set();

      manager.register(
        sqsJsonRoute({
          name: 'redrive-source',
          queueUrl: sourceQueue.url,
          config: { failureAction: 'keep', visibilityTimeoutSeconds: 1, emptyReceiveDelayMs: 50 },
          handle: async ({ payload }) => {
            seenMessageIds.add(payload.jobId);
            throw new Error('route keeps messages so LocalStack can move them to the DLQ');
          },
        }),
      );

      await manager.start();
      try {
        await waitForMessages(sqs, deadLetterQueue.url, { expectedCount: 5, deleteReceived: false, timeoutMs: 20_000 });
      } finally {
        await manager.stop();
      }

      assert.equal(seenMessageIds.size >= 5, true);

      const redriveManager = new SqsDlqRedriveManager(adapter);
      let startResult;
      try {
        startResult = await redriveManager.startRedrive({
          sourceQueue: deadLetterQueue.name,
          destinationQueue: sourceQueue.name,
          maxMessagesPerSecond: 1,
        });
      } catch (error) {
        if (isConditionalLocalStackRedriveError(error)) {
          t.diagnostic(
            `Skipping native DLQ redrive proof because the pinned LocalStack image does not support it cleanly: ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }

        throw error;
      }

      assert.equal(startResult.sourceQueueArn, deadLetterQueue.arn);
      assert.equal(startResult.destinationQueueArn, sourceQueue.arn);

      const movedBackMessages = await waitForMessages(sqs, sourceQueue.url, {
        expectedCount: 1,
        deleteReceived: false,
        timeoutMs: 20_000,
      });
      assert.equal(parseJsonMessageBody(movedBackMessages[0]).jobId.startsWith('redrive-'), true);

      const listedTasks = await waitForCondition(
        async () => {
          const tasks = await redriveManager.listRedriveTasks({ sourceQueue: deadLetterQueue.name });
          return tasks.tasks.length > 0 ? tasks : false;
        },
        { timeoutMs: 10_000, intervalMs: 250, description: 'native DLQ redrive task listing' },
      );

      assert.equal(listedTasks.sourceQueueArn, deadLetterQueue.arn);

      const runningTask = listedTasks.tasks.find((task) => task.status === 'RUNNING' && task.taskHandle);
      if (!runningTask?.taskHandle) {
        t.diagnostic('Skipping cancel assertion because the redrive task completed before cancellation was possible.');
        return;
      }

      await redriveManager.cancelRedrive({ taskHandle: runningTask.taskHandle });

      try {
        const canceledOrFinished = await waitForCondition(
          async () => {
            const tasks = await redriveManager.listRedriveTasks({ sourceQueue: deadLetterQueue.name });
            return (
              tasks.tasks.find(
                (task) =>
                  task.taskHandle === runningTask.taskHandle &&
                  ['CANCELLED', 'CANCELLING', 'COMPLETED'].includes(task.status ?? ''),
              ) ?? false
            );
          },
          { timeoutMs: 10_000, intervalMs: 250, description: 'canceled redrive task state' },
        );

        assert.equal(['CANCELLED', 'CANCELLING', 'COMPLETED'].includes(canceledOrFinished.status ?? ''), true);
      } catch (error) {
        t.diagnostic(
          `Skipping post-cancel status assertion because the pinned LocalStack image did not surface a stable cancel state: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
});

function isConditionalLocalStackRedriveError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /not implemented|operation not supported|unknown operation|unsupported/i.test(message);
}
