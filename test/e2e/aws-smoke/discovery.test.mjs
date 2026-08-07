import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../../../dist/index.js';
import {
  assertLiveAwsSafeEnvironment,
  cleanupFixtures,
  createFixturePrefix,
  createQueue,
  createSdkClients,
  createTopic,
  getCallerIdentity,
} from './support.mjs';

const { AwsSnsAdapter, AwsSqsAdapter, SnsTopicDiscovery, SqsQueueDiscovery } = runtime;

test('Live AWS discovery suite', async (t) => {
  assertLiveAwsSafeEnvironment();

  const { sqs, sns, sts } = createSdkClients();
  await getCallerIdentity(sts);
  const prefix = createFixturePrefix('discovery');
  const fixtures = { queues: [], topics: [] };

  const registerQueue = async (input) => {
    const queue = await createQueue(sqs, input);
    fixtures.queues.push(queue);
    return queue;
  };

  const registerTopic = async (input) => {
    const topic = await createTopic(sns, input);
    fixtures.topics.push(topic);
    return topic;
  };

  try {
    await t.test('queue discovery pages by prefix and preserves FIFO summary state', async () => {
      const queues = await Promise.all([
        registerQueue({ name: `${prefix}-queue-alpha` }),
        registerQueue({ name: `${prefix}-queue-beta` }),
        registerQueue({ name: `${prefix}-queue-gamma`, fifo: true }),
      ]);

      const discovery = new SqsQueueDiscovery(new AwsSqsAdapter(sqs));
      const discovered = [];
      let nextToken;

      do {
        const page = await discovery.listQueues({ namePrefix: `${prefix}-queue-`, pageSize: 1, nextToken });
        discovered.push(...page.queues);
        nextToken = page.nextToken;
      } while (nextToken);

      assert.deepEqual(discovered.map((queue) => queue.queueName).sort(), queues.map((queue) => queue.name).sort());
      assert.equal(discovered.find((queue) => queue.queueName === queues[2].name)?.fifo, true);
    });

    await t.test('topic discovery surfaces the created real-AWS topics', async () => {
      const topics = await Promise.all([
        registerTopic({ name: `${prefix}-topic-alpha` }),
        registerTopic({ name: `${prefix}-topic-beta` }),
        registerTopic({ name: `${prefix}-topic-gamma`, fifo: true }),
      ]);

      const discovery = new SnsTopicDiscovery(new AwsSnsAdapter(sns));
      const remainingTopicNames = new Set(topics.map((topic) => topic.name));
      const discoveredTopics = [];
      let nextToken;
      let pageCount = 0;

      do {
        const page = await discovery.listTopics(nextToken ? { nextToken } : {});
        pageCount += 1;

        for (const topic of page.topics) {
          if (!remainingTopicNames.has(topic.topicName)) {
            continue;
          }

          remainingTopicNames.delete(topic.topicName);
          discoveredTopics.push(topic);
        }

        nextToken = page.nextToken;
      } while (nextToken && remainingTopicNames.size > 0 && pageCount < 100);

      assert.equal(remainingTopicNames.size, 0, `Missing discovered topics: ${[...remainingTopicNames].join(', ')}`);
      assert.equal(discoveredTopics.find((topic) => topic.topicName === topics[2].name)?.fifo, true);
    });
  } finally {
    await cleanupFixtures({ sqs, sns, ...fixtures });
    sts.destroy();
    sqs.destroy();
    sns.destroy();
  }
});
