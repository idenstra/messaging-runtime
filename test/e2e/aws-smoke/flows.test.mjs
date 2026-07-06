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
  parseMessageBody,
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
  snsStringArrayAttribute,
  snsStringAttribute,
  sqsNumberAttribute,
  sqsStringAttribute,
} = runtime;

test('Live AWS transport suite', async (t) => {
  assertLiveAwsSafeEnvironment();

  const { sqs, sns, sts } = createSdkClients();
  await getCallerIdentity(sts);
  const prefix = createFixturePrefix('transport');
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
    const resolutionQueue = await registerQueue({ name: `${prefix}-resolve` });
    const sqsPublishQueue = await registerQueue({ name: `${prefix}-sqs-publish` });
    const fifoQueue = await registerQueue({ name: `${prefix}-fifo`, fifo: true });
    const rawTopicQueue = await registerQueue({ name: `${prefix}-sns-raw` });
    const fifoTopicQueue = await registerQueue({ name: `${prefix}-sns-fifo-queue`, fifo: true });
    const standardTopic = await registerTopic({ name: `${prefix}-topic-standard` });
    const fifoTopic = await registerTopic({ name: `${prefix}-topic-fifo`, fifo: true });

    await subscribeTopicToQueue(sns, sqs, {
      topicArn: standardTopic.arn,
      queueArn: rawTopicQueue.arn,
      queueUrl: rawTopicQueue.url,
      rawMessageDelivery: true,
    });
    await subscribeTopicToQueue(sns, sqs, {
      topicArn: fifoTopic.arn,
      queueArn: fifoTopicQueue.arn,
      queueUrl: fifoTopicQueue.url,
      rawMessageDelivery: true,
    });

    const sqsAdapter = new AwsSqsAdapter(sqs);
    const snsAdapter = new AwsSnsAdapter(sns);
    const queueResolver = new SqsQueueUrlResolver(sqsAdapter);
    const topicResolver = new SnsTopicArnResolver(snsAdapter);
    const sqsPublisher = new SqsPublisher(sqsAdapter, queueResolver);
    const snsPublisher = new SnsPublisher(snsAdapter, topicResolver);

    await t.test('queue and topic resolution work against live AWS', async () => {
      const resolvedByName = await queueResolver.resolve(resolutionQueue.name);
      const resolvedByUrl = await queueResolver.resolve(resolutionQueue.url);
      const resolvedByArn = await queueResolver.resolve(resolutionQueue.arn);
      const topicArnByName = await topicResolver.resolve(standardTopic.name);
      const topicArnByArn = await topicResolver.resolve(standardTopic.arn);

      assert.equal(resolvedByName, resolutionQueue.url);
      assert.equal(resolvedByUrl, resolutionQueue.url);
      assert.equal(resolvedByArn, resolutionQueue.url);
      assert.equal(topicArnByName, standardTopic.arn);
      assert.equal(topicArnByArn, standardTopic.arn);
    });

    await t.test('SQS publishers work against live AWS', async () => {
      await sqsPublisher.sendJson({
        queue: sqsPublishQueue.name,
        payload: { mode: 'json', index: 1 },
        messageAttributes: { mode: sqsStringAttribute('json'), attempts: sqsNumberAttribute(1) },
      });
      await sqsPublisher.sendString({
        queue: sqsPublishQueue.url,
        body: 'plain-text-1',
        messageAttributes: { source: { DataType: 'String', StringValue: 'raw-map' } },
      });
      await sqsPublisher.sendSerialized({
        queue: sqsPublishQueue.arn,
        payload: { mode: 'serialized', index: 3 },
        serialize: JSON.stringify,
      });
      await sqsPublisher.sendJsonBatch({
        queue: sqsPublishQueue.name,
        entries: [
          { id: 'json-batch-1', payload: { mode: 'json-batch', index: 4 } },
          { id: 'json-batch-2', payload: { mode: 'json-batch', index: 5 } },
        ],
      });
      await sqsPublisher.sendStringBatch({
        queue: sqsPublishQueue.url,
        entries: [
          { id: 'string-batch-1', body: 'plain-text-batch-1' },
          { id: 'string-batch-2', body: 'plain-text-batch-2' },
        ],
      });
      await sqsPublisher.sendSerializedBatch({
        queue: sqsPublishQueue.arn,
        serialize: JSON.stringify,
        entries: [
          { id: 'serialized-batch-1', payload: { mode: 'serialized-batch', index: 8 } },
          { id: 'serialized-batch-2', payload: { mode: 'serialized-batch', index: 9 } },
        ],
      });
      await sqsPublisher.sendString({ queue: fifoQueue.name, body: 'fifo-body-1', messageGroupId: 'fifo-group' });

      const standardMessages = await waitForMessages(sqs, sqsPublishQueue.url, {
        expectedCount: 9,
        deleteReceived: true,
        timeoutMs: 30_000,
      });
      const fifoMessages = await waitForMessages(sqs, fifoQueue.url, {
        expectedCount: 1,
        deleteReceived: true,
        timeoutMs: 30_000,
      });

      const standardBodies = standardMessages.map((message) => parseMessageBody(message)).sort();
      assert.deepEqual(standardBodies, [
        'plain-text-1',
        'plain-text-batch-1',
        'plain-text-batch-2',
        '{"mode":"json","index":1}',
        '{"mode":"json-batch","index":4}',
        '{"mode":"json-batch","index":5}',
        '{"mode":"serialized","index":3}',
        '{"mode":"serialized-batch","index":8}',
        '{"mode":"serialized-batch","index":9}',
      ]);

      const jsonMessage = standardMessages.find((message) => parseMessageBody(message) === '{"mode":"json","index":1}');
      assert.equal(jsonMessage?.MessageAttributes?.mode?.StringValue, 'json');
      assert.equal(jsonMessage?.MessageAttributes?.attempts?.StringValue, '1');

      const stringMessage = standardMessages.find((message) => parseMessageBody(message) === 'plain-text-1');
      assert.equal(stringMessage?.MessageAttributes?.source?.StringValue, 'raw-map');

      assert.equal(parseMessageBody(fifoMessages[0]), 'fifo-body-1');
      assert.equal(fifoMessages[0]?.Attributes?.MessageGroupId, 'fifo-group');
    });

    await t.test(
      'SNS publishers, raw delivery, attributes, and FIFO topic semantics work against live AWS',
      async () => {
        await snsPublisher.publishJson({
          topic: standardTopic.name,
          payload: { mode: 'json', index: 1 },
          subject: 'json-event',
          messageAttributes: {
            mode: snsStringAttribute('json'),
            audiences: snsStringArrayAttribute(['ops', 'billing']),
          },
        });
        await snsPublisher.publishString({
          topic: standardTopic.arn,
          message: 'sns-plain-1',
          messageAttributes: { source: { DataType: 'String', StringValue: 'raw-map' } },
        });
        await snsPublisher.publishSerialized({
          topic: standardTopic.name,
          payload: { mode: 'serialized', index: 3 },
          serialize: JSON.stringify,
        });
        await snsPublisher.publishJsonBatch({
          topic: standardTopic.arn,
          entries: [
            { id: 'json-batch-1', payload: { mode: 'json-batch', index: 4 } },
            { id: 'json-batch-2', payload: { mode: 'json-batch', index: 5 } },
          ],
        });
        await snsPublisher.publishStringBatch({
          topic: standardTopic.name,
          entries: [
            { id: 'string-batch-1', message: 'sns-string-batch-1' },
            { id: 'string-batch-2', message: 'sns-string-batch-2' },
          ],
        });
        await snsPublisher.publishSerializedBatch({
          topic: standardTopic.arn,
          serialize: JSON.stringify,
          entries: [
            { id: 'serialized-batch-1', payload: { mode: 'serialized-batch', index: 8 } },
            { id: 'serialized-batch-2', payload: { mode: 'serialized-batch', index: 9 } },
          ],
        });
        await snsPublisher.publishStructuredJson({
          topic: standardTopic.name,
          payload: { default: 'structured-default-1', sqs: 'structured-sqs-1' },
          subject: 'structured-one',
        });
        await snsPublisher.publishStructuredJsonBatch({
          topic: standardTopic.arn,
          entries: [
            { id: 'structured-batch-1', payload: { default: 'structured-default-2', sqs: 'structured-sqs-2' } },
            { id: 'structured-batch-2', payload: { default: 'structured-default-3', sqs: 'structured-sqs-3' } },
          ],
        });
        await snsPublisher.publishString({
          topic: fifoTopic.name,
          message: 'fifo-sns-1',
          messageGroupId: 'fifo-group',
        });

        const standardMessages = await waitForMessages(sqs, rawTopicQueue.url, {
          expectedCount: 12,
          deleteReceived: true,
          timeoutMs: 45_000,
        });
        const fifoMessages = await waitForMessages(sqs, fifoTopicQueue.url, {
          expectedCount: 1,
          deleteReceived: true,
          timeoutMs: 30_000,
        });

        const standardBodies = standardMessages.map((message) => parseMessageBody(message)).sort();
        assert.deepEqual(standardBodies, [
          'sns-plain-1',
          'sns-string-batch-1',
          'sns-string-batch-2',
          'structured-sqs-1',
          'structured-sqs-2',
          'structured-sqs-3',
          '{"mode":"json","index":1}',
          '{"mode":"json-batch","index":4}',
          '{"mode":"json-batch","index":5}',
          '{"mode":"serialized","index":3}',
          '{"mode":"serialized-batch","index":8}',
          '{"mode":"serialized-batch","index":9}',
        ]);

        const jsonMessage = standardMessages.find(
          (message) => parseMessageBody(message) === '{"mode":"json","index":1}',
        );
        assert.equal(jsonMessage?.MessageAttributes?.mode?.StringValue, 'json');
        assert.equal(jsonMessage?.MessageAttributes?.audiences?.DataType, 'String.Array');
        assert.equal(jsonMessage?.MessageAttributes?.audiences?.StringValue, '["ops","billing"]');

        const stringMessage = standardMessages.find((message) => parseMessageBody(message) === 'sns-plain-1');
        assert.equal(stringMessage?.MessageAttributes?.source?.StringValue, 'raw-map');

        assert.equal(parseMessageBody(fifoMessages[0]), 'fifo-sns-1');
        assert.equal(fifoMessages[0]?.Attributes?.MessageGroupId, 'fifo-group');
      },
    );
  } finally {
    await cleanupFixtures({ sqs, sns, ...fixtures });
    sts.destroy();
    sqs.destroy();
    sns.destroy();
  }
});
