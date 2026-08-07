import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../../../dist/index.js';
import {
  assertLiveAwsSafeEnvironment,
  cleanupFixtures,
  createFixturePrefix,
  createQueue,
  createSdkClients,
  getCallerIdentity,
  waitForCondition,
} from './support.mjs';

const { AwsSqsAdapter, SqsQueueInspector } = runtime;

test('Live AWS queue-ops suite', async (t) => {
  assertLiveAwsSafeEnvironment();

  const { sqs, sns, sts } = createSdkClients();
  await getCallerIdentity(sts);
  const prefix = createFixturePrefix('queue-ops');
  const fixtures = { queues: [], topics: [] };

  const registerQueue = async (input) => {
    const queue = await createQueue(sqs, input);
    fixtures.queues.push(queue);
    return queue;
  };

  try {
    await t.test('queue inspection normalizes real AWS attributes and lists DLQ source queues', async () => {
      const deadLetterQueue = await registerQueue({
        name: `${prefix}-dlq`,
        visibilityTimeoutSeconds: 5,
        receiveMessageWaitTimeSeconds: 1,
        delaySeconds: 2,
        redriveAllowPolicy: { redrivePermission: 'allowAll' },
      });
      const sourceQueues = await Promise.all(
        ['a', 'b'].map((suffix) =>
          registerQueue({
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
      const sourceListing = await waitForCondition(
        async () => {
          const listing = await inspector.listDeadLetterSourceQueues(deadLetterQueue.name);
          return listing.sourceQueueUrls.length >= 2 ? listing : false;
        },
        { timeoutMs: 30_000, intervalMs: 1_000, description: 'real AWS dead-letter source listing' },
      );

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
    });
  } finally {
    await cleanupFixtures({ sqs, sns, ...fixtures });
    sts.destroy();
    sqs.destroy();
    sns.destroy();
  }
});
