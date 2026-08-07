import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../../../dist/index.js';
import { createQueue, createSdkClients, createSuitePrefix, createTopic } from './support.mjs';

const { AwsSnsAdapter, AwsSqsAdapter, SnsTopicArnResolver, SnsTopicDiscovery, SqsQueueDiscovery, SqsQueueUrlResolver } =
  runtime;

test('LocalStack discovery suite', async (t) => {
  const prefix = createSuitePrefix('discovery');
  const { sqs, sns } = createSdkClients();

  await t.test('queue and topic resolvers handle names, URLs, and ARNs against live LocalStack fixtures', async () => {
    const queue = await createQueue(sqs, { name: `${prefix}-resolver-queue`, visibilityTimeoutSeconds: 3 });
    const topic = await createTopic(sns, { name: `${prefix}-resolver-topic` });

    const queueResolver = new SqsQueueUrlResolver(new AwsSqsAdapter(sqs));
    const topicResolver = new SnsTopicArnResolver(new AwsSnsAdapter(sns));

    assert.equal(await queueResolver.resolve(queue.name), queue.url);
    assert.equal(await queueResolver.resolve(queue.url), queue.url);
    assert.equal(await queueResolver.resolve(queue.arn), queue.url);

    assert.equal(await topicResolver.resolve(topic.name), topic.arn);
    assert.equal(await topicResolver.resolve(topic.arn), topic.arn);
  });

  await t.test(
    'queue discovery pages by prefix and topic discovery paginates across a large LocalStack topic set',
    async () => {
      const discoveryQueues = await Promise.all(
        ['alpha', 'beta', 'gamma'].map((suffix) =>
          createQueue(sqs, { name: `${prefix}-queue-${suffix}`, visibilityTimeoutSeconds: 3 }),
        ),
      );

      const discoveryTopicNames = [];
      for (let index = 0; index < 105; index += 1) {
        const topic = await createTopic(sns, { name: `${prefix}-topic-${index.toString().padStart(3, '0')}` });
        discoveryTopicNames.push(topic.name);
      }

      const queueDiscovery = new SqsQueueDiscovery(new AwsSqsAdapter(sqs));
      const firstQueuePage = await queueDiscovery.listQueues({ namePrefix: `${prefix}-queue-`, pageSize: 1 });
      assert.equal(firstQueuePage.queues.length, 1);
      assert.equal(typeof firstQueuePage.nextToken, 'string');

      const discoveredQueueNames = firstQueuePage.queues.map((queue) => queue.queueName);
      let queueNextToken = firstQueuePage.nextToken;
      while (queueNextToken) {
        const page = await queueDiscovery.listQueues({
          namePrefix: `${prefix}-queue-`,
          pageSize: 1,
          nextToken: queueNextToken,
        });
        discoveredQueueNames.push(...page.queues.map((queue) => queue.queueName));
        queueNextToken = page.nextToken;
      }

      assert.deepEqual(discoveredQueueNames.sort(), discoveryQueues.map((queue) => queue.name).sort());

      const topicDiscovery = new SnsTopicDiscovery(new AwsSnsAdapter(sns));
      const discoveredTopicNames = [];
      let topicNextToken;
      let firstTopicPageToken;

      do {
        const page = await topicDiscovery.listTopics(topicNextToken ? { nextToken: topicNextToken } : {});
        if (topicNextToken === undefined) {
          firstTopicPageToken = page.nextToken;
        }

        discoveredTopicNames.push(
          ...page.topics
            .filter((topic) => topic.topicName.startsWith(`${prefix}-topic-`))
            .map((topic) => topic.topicName),
        );
        topicNextToken = page.nextToken;
      } while (topicNextToken);

      assert.equal(typeof firstTopicPageToken, 'string');
      assert.deepEqual(discoveredTopicNames.sort(), discoveryTopicNames.sort());
    },
  );
});
