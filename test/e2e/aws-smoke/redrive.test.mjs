import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../../../dist/index.js';
import {
  assertLiveAwsSafeEnvironment,
  cleanupFixtures,
  createFixturePrefix,
  createQueue,
  createSdkClients,
  createStandardRuntimeDefaults,
  getCallerIdentity,
  parseJsonMessageBody,
  sendQueueJsonMessage,
  waitForApproximateVisibleMessageCount,
  waitForCondition,
  waitForMessages,
} from './support.mjs';

const { AwsSqsAdapter, SqsDlqRedriveManager, SqsQueueInspector, SqsWorkerManager, sqsJsonRoute } = runtime;

test('Live AWS redrive suite', async (t) => {
  assertLiveAwsSafeEnvironment();

  const { sqs, sns, sts } = createSdkClients();
  await getCallerIdentity(sts);
  const prefix = createFixturePrefix('redrive');
  const fixtures = { queues: [], topics: [] };

  const registerQueue = async (input) => {
    const queue = await createQueue(sqs, input);
    fixtures.queues.push(queue);
    return queue;
  };

  try {
    await t.test('native DLQ redrive works against real AWS through a dedicated source/DLQ fixture', async () => {
      const deadLetterQueue = await registerQueue({
        name: `${prefix}-dlq`,
        visibilityTimeoutSeconds: 5,
        redriveAllowPolicy: { redrivePermission: 'allowAll' },
      });
      const sourceQueue = await registerQueue({
        name: `${prefix}-source`,
        visibilityTimeoutSeconds: 1,
        redrivePolicy: { deadLetterTargetArn: deadLetterQueue.arn, maxReceiveCount: 1 },
      });

      const messageCount = 8;
      for (let index = 0; index < messageCount; index += 1) {
        await sendQueueJsonMessage(sqs, sourceQueue.url, { jobId: `redrive-${index}` });
      }

      const adapter = new AwsSqsAdapter(sqs);
      const manager = new SqsWorkerManager(adapter, {
        defaults: createStandardRuntimeDefaults({ visibilityTimeoutSeconds: 1 }),
      });

      manager.register(
        sqsJsonRoute({
          name: 'redrive-source',
          queueUrl: sourceQueue.url,
          config: { failureAction: 'keep', visibilityTimeoutSeconds: 1, emptyReceiveDelayMs: 50, concurrency: 4 },
          handle: async () => {
            throw new Error('route keeps messages so SQS can move them to the DLQ');
          },
        }),
      );

      await manager.start();
      try {
        await waitForApproximateVisibleMessageCount(sqs, deadLetterQueue.url, {
          minCount: messageCount,
          timeoutMs: 60_000,
          intervalMs: 1_000,
        });
      } finally {
        await manager.stop();
      }

      const inspector = new SqsQueueInspector(adapter);
      const sourceDescription = await inspector.inspectQueue(sourceQueue.name);
      const deadLetterDescription = await inspector.inspectQueue(deadLetterQueue.name);
      const sourceListing = await waitForCondition(
        async () => {
          const listing = await inspector.listDeadLetterSourceQueues(deadLetterQueue.name);
          return listing.sourceQueueUrls.includes(sourceQueue.url) ? listing : false;
        },
        { timeoutMs: 30_000, intervalMs: 1_000, description: 'real AWS source queue listing for the DLQ' },
      );

      assert.equal(sourceDescription.redrivePolicy?.deadLetterTargetArn, deadLetterQueue.arn);
      assert.equal(deadLetterDescription.redriveAllowPolicy?.redrivePermission, 'allowAll');
      assert.deepEqual(sourceListing.sourceQueueUrls, [sourceQueue.url]);

      const redriveManager = new SqsDlqRedriveManager(adapter, { queueInspector: inspector });
      const startResult = await redriveManager.startRedrive({
        sourceQueue: deadLetterQueue.name,
        maxMessagesPerSecond: 1,
      });

      assert.equal(startResult.sourceQueueArn, deadLetterQueue.arn);
      assert.equal(startResult.destinationQueueArn, undefined);
      assert.equal(startResult.destinationQueueUrl, undefined);

      const listedTasks = await waitForCondition(
        async () => {
          const tasks = await redriveManager.listRedriveTasks({ sourceQueue: deadLetterQueue.name });
          return tasks.tasks.length > 0 ? tasks : false;
        },
        { timeoutMs: 20_000, intervalMs: 1_000, description: 'native redrive task listing in real AWS' },
      );

      assert.equal(listedTasks.sourceQueueArn, deadLetterQueue.arn);
      assert.equal(
        listedTasks.tasks.some((task) => task.taskHandle === startResult.taskHandle),
        true,
      );

      const startedTask = listedTasks.tasks.find((task) => task.taskHandle === startResult.taskHandle);
      assert.ok(startedTask, 'Real AWS redrive listing must include the started task.');

      await waitForRedriveTaskToMoveMessages(redriveManager, deadLetterQueue.name, startResult.taskHandle, {
        timeoutMs: 60_000,
        intervalMs: 1_000,
        description: 'real AWS redrive task to move at least one message',
      });
      const movedBackMessages = await waitForMessages(sqs, sourceQueue.url, {
        expectedCount: 1,
        deleteReceived: true,
        timeoutMs: 30_000,
      });
      assert.equal(parseJsonMessageBody(movedBackMessages[0]).jobId.startsWith('redrive-'), true);

      if (startedTask.status === 'COMPLETED') {
        assert.equal(startedTask.status, 'COMPLETED');
        return;
      }

      assert.equal(startedTask.status, 'RUNNING');

      const observedStatuses = new Set([startedTask.status]);

      try {
        const cancelResult = await redriveManager.cancelRedrive({ taskHandle: startResult.taskHandle });
        assert.equal(cancelResult.taskHandle, startResult.taskHandle);
      } catch (error) {
        const terminalAfterCancelFailure = await waitForTerminalRedriveTaskState(
          redriveManager,
          deadLetterQueue.name,
          startResult.taskHandle,
          observedStatuses,
          { timeoutMs: 30_000, intervalMs: 1_000, description: 'terminal real AWS redrive task after cancel race' },
        );

        t.diagnostic(
          `Real AWS redrive cancel raced with task completion: ${error instanceof Error ? error.message : String(error)}`,
        );
        assert.equal(
          ['CANCELLED', 'CANCELLING', 'COMPLETED', 'DISAPPEARED_AFTER_CANCEL'].includes(
            terminalAfterCancelFailure.status ?? '',
          ),
          true,
        );
        return;
      }

      const terminalTask = await waitForTerminalRedriveTaskState(
        redriveManager,
        deadLetterQueue.name,
        startResult.taskHandle,
        observedStatuses,
        { timeoutMs: 90_000, intervalMs: 2_000, description: 'terminal real AWS redrive task state after cancel' },
      );

      assert.equal(
        ['CANCELLED', 'CANCELLING', 'COMPLETED', 'DISAPPEARED_AFTER_CANCEL'].includes(terminalTask.status ?? ''),
        true,
      );
      assert.equal(observedStatuses.has('RUNNING'), true);
    });
  } finally {
    await cleanupFixtures({ sqs, sns, ...fixtures });
    sts.destroy();
    sqs.destroy();
    sns.destroy();
  }
});

async function waitForTerminalRedriveTaskState(redriveManager, sourceQueue, taskHandle, observedStatuses, waitOptions) {
  return waitForCondition(async () => {
    const tasks = await redriveManager.listRedriveTasks({ sourceQueue });
    const task = tasks.tasks.find((candidate) => candidate.taskHandle === taskHandle);

    if (!task) {
      return { status: 'DISAPPEARED_AFTER_CANCEL' };
    }

    if (task.status) {
      observedStatuses.add(task.status);
    }

    return ['CANCELLED', 'CANCELLING', 'COMPLETED'].includes(task.status ?? '') ? task : false;
  }, waitOptions);
}

async function waitForRedriveTaskToMoveMessages(redriveManager, sourceQueue, taskHandle, waitOptions) {
  return waitForCondition(async () => {
    const tasks = await redriveManager.listRedriveTasks({ sourceQueue });
    const task = tasks.tasks.find((candidate) => candidate.taskHandle === taskHandle);

    if (!task) {
      return false;
    }

    return (task.approximateNumberOfMessagesMoved ?? 0) > 0 || task.status === 'COMPLETED' ? task : false;
  }, waitOptions);
}
