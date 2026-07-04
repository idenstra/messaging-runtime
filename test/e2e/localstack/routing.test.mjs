import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../../../dist/index.js';
import {
  createQueue,
  createSdkClients,
  createStandardRuntimeDefaults,
  createSuitePrefix,
  createTopic,
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

test('LocalStack routing suite', async (t) => {
  const prefix = createSuitePrefix('routing');
  const { sqs, sns } = createSdkClients();

  await t.test('sqsStringRoute processes a plain SQS body through the direct manager path', async () => {
    const queue = await createQueue(sqs, { name: `${prefix}-string-route`, visibilityTimeoutSeconds: 3 });
    await sendQueueStringMessage(sqs, queue.url, 'route-string-body');

    const manager = new SqsWorkerManager(new AwsSqsAdapter(sqs), { defaults: createStandardRuntimeDefaults() });
    const handledBodies = [];

    manager.register(
      sqsStringRoute({
        name: 'string-route',
        queueUrl: queue.url,
        handle: async ({ payload }) => {
          handledBodies.push(payload);
        },
      }),
    );

    await manager.runUntilIdle({ idleEmptyReceiveWaves: 1 });

    assert.deepEqual(handledBodies, ['route-string-body']);
  });

  await t.test('snsJsonQueueRoute handles real SNS-over-SQS envelopes with manifest-owned queue binding', async () => {
    const queue = await createQueue(sqs, { name: `${prefix}-sns-envelope`, visibilityTimeoutSeconds: 3 });
    const topic = await createTopic(sns, { name: `${prefix}-sns-envelope-topic` });

    await subscribeTopicToQueue(sns, sqs, {
      topicArn: topic.arn,
      queueArn: queue.arn,
      queueUrl: queue.url,
      rawMessageDelivery: false,
    });
    await publishTopicStringMessage(sns, topic.arn, JSON.stringify({ eventId: 'evt-1', eventType: 'created' }));

    const queueResolver = new SqsQueueUrlResolver(new AwsSqsAdapter(sqs), {
      preload: { [queue.name]: queue.url },
      allowNetworkLookup: false,
    });

    const handledPayloads = [];
    const host = new SqsWorkerServiceHost({
      client: new AwsSqsAdapter(sqs),
      queueResolver,
      manifest: parseSqsWorkerServiceManifest({ routes: { envelope: { queue: queue.name } } }),
      managerOptions: { defaults: createStandardRuntimeDefaults() },
      routes: [
        snsJsonQueueRoute({
          name: 'envelope',
          messageShape: 'envelope+payload',
          handle: async ({ payload }) => {
            handledPayloads.push(payload);
          },
        }),
      ],
    });

    await host.runUntilIdle({ idleEmptyReceiveWaves: 1 });

    assert.equal(handledPayloads.length, 1);
    assert.equal(handledPayloads[0].envelope.TopicArn, topic.arn);
    assert.deepEqual(handledPayloads[0].payload, { eventId: 'evt-1', eventType: 'created' });
  });

  await t.test('queue-to-queue forwarding helpers relay JSON payloads and compatible attributes', async () => {
    const sourceQueue = await createQueue(sqs, { name: `${prefix}-relay-source`, visibilityTimeoutSeconds: 3 });
    const targetQueue = await createQueue(sqs, { name: `${prefix}-relay-target`, visibilityTimeoutSeconds: 3 });

    await sendQueueJsonMessage(
      sqs,
      sourceQueue.url,
      { eventId: 'relay-1', eventType: 'dispatched' },
      { messageAttributes: { trace: { DataType: 'String', StringValue: 'relay-trace' } } },
    );

    const adapter = new AwsSqsAdapter(sqs);
    const resolver = new SqsQueueUrlResolver(adapter, {
      preload: { [targetQueue.name]: targetQueue.url },
      allowNetworkLookup: false,
    });
    const publisher = new SqsPublisher(adapter, resolver);
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
      timeoutMs: 10_000,
    });

    assert.deepEqual(parseJsonMessageBody(forwardedMessages[0]), { eventId: 'relay-1', eventType: 'dispatched' });
    assert.equal(forwardedMessages[0]?.MessageAttributes?.trace?.StringValue, 'relay-trace');
  });

  await t.test('queue-to-topic forwarding helpers relay string payloads to subscribed queues', async () => {
    const sourceQueue = await createQueue(sqs, { name: `${prefix}-topic-source`, visibilityTimeoutSeconds: 3 });
    const subscriberQueue = await createQueue(sqs, { name: `${prefix}-topic-subscriber`, visibilityTimeoutSeconds: 3 });
    const topic = await createTopic(sns, { name: `${prefix}-relay-topic` });

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
    const topicResolver = new SnsTopicArnResolver(topicAdapter, {
      preload: { [topic.name]: topic.arn },
      allowNetworkLookup: false,
    });
    const publisher = new SnsPublisher(topicAdapter, topicResolver);
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
      timeoutMs: 10_000,
    });

    assert.equal(parseMessageBody(forwardedMessages[0]), 'relay-topic-body');
    assert.equal(forwardedMessages[0]?.MessageAttributes?.origin?.StringValue, 'routing-suite');
  });
});
