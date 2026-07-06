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
  createTopic,
  getCallerIdentity,
  parseJsonMessageBody,
  parseMessageBody,
  publishTopicStringMessage,
  sendQueueJsonMessage,
  sendQueueStringMessage,
  subscribeTopicToQueue,
  waitForMessages,
} from './support.mjs';

const {
  AwsSnsAdapter,
  AwsSqsAdapter,
  SnsPublisher,
  SnsTopicArnResolver,
  SqsPublisher,
  SqsQueueUrlResolver,
  SqsWorkerManager,
  SqsWorkerServiceHost,
  parseSqsWorkerServiceManifest,
  snsJsonQueueRoute,
  sqsJsonRoute,
  sqsJsonToQueueForwardHandler,
  sqsStringRoute,
  sqsStringToTopicForwardHandler,
} = runtime;

test('Live AWS routing suite', async (t) => {
  assertLiveAwsSafeEnvironment();

  const { sqs, sns, sts } = createSdkClients();
  await getCallerIdentity(sts);
  const prefix = createFixturePrefix('routing');
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
    await t.test('snsJsonQueueRoute handles real SNS-over-SQS envelopes through the hosted worker shape', async () => {
      const queue = await registerQueue({ name: `${prefix}-envelope`, visibilityTimeoutSeconds: 5 });
      const topic = await registerTopic({ name: `${prefix}-envelope-topic` });

      await subscribeTopicToQueue(sns, sqs, {
        topicArn: topic.arn,
        queueArn: queue.arn,
        queueUrl: queue.url,
        rawMessageDelivery: false,
      });
      await publishTopicStringMessage(sns, topic.arn, JSON.stringify({ eventId: 'evt-1', eventType: 'created' }));

      const seenPayloads = [];
      const host = new SqsWorkerServiceHost({
        client: new AwsSqsAdapter(sqs),
        queueResolver: new SqsQueueUrlResolver(new AwsSqsAdapter(sqs)),
        manifest: parseSqsWorkerServiceManifest({ routes: { envelope: { queue: queue.name } } }),
        managerOptions: { defaults: createStandardRuntimeDefaults() },
        routes: [
          snsJsonQueueRoute({
            name: 'envelope',
            messageShape: 'envelope+payload',
            handle: async ({ payload }) => {
              seenPayloads.push(payload);
            },
          }),
        ],
      });

      await host.runUntilIdle({ idleEmptyReceiveWaves: 1 });

      assert.equal(seenPayloads.length, 1);
      assert.equal(seenPayloads[0].envelope.TopicArn, topic.arn);
      assert.deepEqual(seenPayloads[0].payload, { eventId: 'evt-1', eventType: 'created' });
    });

    await t.test('queue-to-queue forwarding relays JSON payloads and copied attributes', async () => {
      const sourceQueue = await registerQueue({ name: `${prefix}-relay-source`, visibilityTimeoutSeconds: 5 });
      const targetQueue = await registerQueue({ name: `${prefix}-relay-target`, visibilityTimeoutSeconds: 5 });

      await sendQueueJsonMessage(
        sqs,
        sourceQueue.url,
        { eventId: 'relay-1', eventType: 'dispatched' },
        { messageAttributes: { trace: { DataType: 'String', StringValue: 'relay-trace' } } },
      );

      const adapter = new AwsSqsAdapter(sqs);
      const publisher = new SqsPublisher(adapter, new SqsQueueUrlResolver(adapter));
      const manager = new SqsWorkerManager(adapter, { defaults: createStandardRuntimeDefaults() });

      manager.register(
        sqsJsonRoute({
          name: 'relay-source',
          queueUrl: sourceQueue.url,
          handle: sqsJsonToQueueForwardHandler({ publisher, queue: targetQueue.name, copyMessageAttributes: true }),
        }),
      );

      await manager.runUntilIdle({ idleEmptyReceiveWaves: 1 });

      const forwardedMessages = await waitForMessages(sqs, targetQueue.url, {
        expectedCount: 1,
        deleteReceived: true,
        timeoutMs: 20_000,
      });

      assert.deepEqual(parseJsonMessageBody(forwardedMessages[0]), { eventId: 'relay-1', eventType: 'dispatched' });
      assert.equal(forwardedMessages[0]?.MessageAttributes?.trace?.StringValue, 'relay-trace');
    });

    await t.test('queue-to-topic forwarding relays string payloads to a subscribed queue', async () => {
      const sourceQueue = await registerQueue({ name: `${prefix}-topic-source`, visibilityTimeoutSeconds: 5 });
      const subscriberQueue = await registerQueue({ name: `${prefix}-topic-subscriber`, visibilityTimeoutSeconds: 5 });
      const topic = await registerTopic({ name: `${prefix}-relay-topic` });

      await subscribeTopicToQueue(sns, sqs, {
        topicArn: topic.arn,
        queueArn: subscriberQueue.arn,
        queueUrl: subscriberQueue.url,
        rawMessageDelivery: true,
      });
      await sendQueueStringMessage(sqs, sourceQueue.url, 'relay-topic-body', {
        messageAttributes: { origin: { DataType: 'String', StringValue: 'routing-suite' } },
      });

      const topicAdapter = new AwsSnsAdapter(sns);
      const publisher = new SnsPublisher(topicAdapter, new SnsTopicArnResolver(topicAdapter));
      const manager = new SqsWorkerManager(new AwsSqsAdapter(sqs), { defaults: createStandardRuntimeDefaults() });

      manager.register(
        sqsStringRoute({
          name: 'topic-source',
          queueUrl: sourceQueue.url,
          handle: sqsStringToTopicForwardHandler({
            publisher,
            topic: topic.name,
            copyMessageAttributes: true,
            subject: ({ payload }) => `forwarded:${payload}`,
          }),
        }),
      );

      await manager.runUntilIdle({ idleEmptyReceiveWaves: 1 });

      const forwardedMessages = await waitForMessages(sqs, subscriberQueue.url, {
        expectedCount: 1,
        deleteReceived: true,
        timeoutMs: 20_000,
      });

      assert.equal(parseMessageBody(forwardedMessages[0]), 'relay-topic-body');
      assert.equal(forwardedMessages[0]?.MessageAttributes?.origin?.StringValue, 'routing-suite');
    });
  } finally {
    await cleanupFixtures({ sqs, sns, ...fixtures });
    sts.destroy();
    sqs.destroy();
    sns.destroy();
  }
});
