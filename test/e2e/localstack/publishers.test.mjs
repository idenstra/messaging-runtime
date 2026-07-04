import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../../../dist/index.js';
import {
  createQueue,
  createRecordingSnsAdapter,
  createSdkClients,
  createSuitePrefix,
  createTopic,
  parseMessageBody,
  subscribeTopicToQueue,
  waitForMessages,
} from './support.mjs';

const { AwsSqsAdapter, SnsPublisher, SnsTopicArnResolver, SqsPublisher, SqsQueueUrlResolver } = runtime;

test('LocalStack publishers suite', async (t) => {
  const prefix = createSuitePrefix('publishers');
  const { sqs, sns } = createSdkClients();

  await t.test(
    'SQS publishers deliver JSON, string, serialized, batch, FIFO, and size-validated requests',
    async () => {
      const standardQueue = await createQueue(sqs, { name: `${prefix}-sqs-standard`, visibilityTimeoutSeconds: 3 });
      const fifoQueue = await createQueue(sqs, { name: `${prefix}-sqs-fifo`, fifo: true, visibilityTimeoutSeconds: 3 });

      const adapter = new AwsSqsAdapter(sqs);
      const resolver = new SqsQueueUrlResolver(adapter, {
        preload: { [standardQueue.name]: standardQueue.url, [fifoQueue.name]: fifoQueue.url },
        allowNetworkLookup: false,
      });
      const publisher = new SqsPublisher(adapter, resolver);
      const strictPublisher = new SqsPublisher(adapter, resolver, { sizeValidation: { maxBytes: 8 } });

      await publisher.sendJson({
        queue: standardQueue.name,
        payload: { mode: 'json', index: 1 },
        messageAttributes: { mode: runtime.sqsStringAttribute('json'), attempts: runtime.sqsNumberAttribute(1) },
      });
      await publisher.sendString({
        queue: standardQueue.name,
        body: 'plain-text-1',
        messageAttributes: { source: { DataType: 'String', StringValue: 'raw-map' } },
      });
      await publisher.sendSerialized({
        queue: standardQueue.name,
        payload: { mode: 'serialized', index: 3 },
        serialize: JSON.stringify,
      });
      await publisher.sendJsonBatch({
        queue: standardQueue.name,
        entries: [
          { id: 'json-batch-1', payload: { mode: 'json-batch', index: 4 } },
          { id: 'json-batch-2', payload: { mode: 'json-batch', index: 5 } },
        ],
      });
      await publisher.sendStringBatch({
        queue: standardQueue.name,
        entries: [
          { id: 'string-batch-1', body: 'plain-text-batch-1' },
          { id: 'string-batch-2', body: 'plain-text-batch-2' },
        ],
      });
      await publisher.sendSerializedBatch({
        queue: standardQueue.name,
        serialize: JSON.stringify,
        entries: [
          { id: 'serialized-batch-1', payload: { mode: 'serialized-batch', index: 8 } },
          { id: 'serialized-batch-2', payload: { mode: 'serialized-batch', index: 9 } },
        ],
      });
      await publisher.sendString({
        queue: fifoQueue.name,
        body: 'fifo-body-1',
        messageGroupId: 'fifo-group',
        messageDeduplicationId: 'fifo-dedupe-1',
      });

      await assert.rejects(
        strictPublisher.sendString({ queue: standardQueue.name, body: 'oversized-body' }),
        /exceeds the configured size limit/i,
      );
      await strictPublisher.sendString({ queue: standardQueue.name, body: 'oversized-body', sizeValidation: false });

      const standardMessages = await waitForMessages(sqs, standardQueue.url, {
        expectedCount: 10,
        deleteReceived: true,
        timeoutMs: 15_000,
      });
      const fifoMessages = await waitForMessages(sqs, fifoQueue.url, {
        expectedCount: 1,
        deleteReceived: true,
        timeoutMs: 10_000,
      });

      const standardBodies = standardMessages.map((message) => parseMessageBody(message)).sort();
      assert.deepEqual(standardBodies, [
        'oversized-body',
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
    },
  );

  await t.test(
    'SNS publishers deliver string-mode and structured messages, preserve attributes, and enforce local semantics',
    async () => {
      const standardRawQueue = await createQueue(sqs, {
        name: `${prefix}-sns-standard-raw`,
        visibilityTimeoutSeconds: 3,
      });
      const standardStructuredQueue = await createQueue(sqs, {
        name: `${prefix}-sns-structured`,
        visibilityTimeoutSeconds: 3,
      });
      const fifoQueue = await createQueue(sqs, { name: `${prefix}-sns-fifo`, fifo: true, visibilityTimeoutSeconds: 3 });
      const standardTopic = await createTopic(sns, { name: `${prefix}-topic-standard` });
      const structuredTopic = await createTopic(sns, { name: `${prefix}-topic-structured` });
      const fifoTopic = await createTopic(sns, {
        name: `${prefix}-topic-fifo`,
        fifo: true,
        contentBasedDeduplication: true,
      });

      await subscribeTopicToQueue(sns, sqs, {
        topicArn: standardTopic.arn,
        queueArn: standardRawQueue.arn,
        queueUrl: standardRawQueue.url,
        rawMessageDelivery: true,
      });
      await subscribeTopicToQueue(sns, sqs, {
        topicArn: structuredTopic.arn,
        queueArn: standardStructuredQueue.arn,
        queueUrl: standardStructuredQueue.url,
        rawMessageDelivery: true,
      });
      await subscribeTopicToQueue(sns, sqs, {
        topicArn: fifoTopic.arn,
        queueArn: fifoQueue.arn,
        queueUrl: fifoQueue.url,
        rawMessageDelivery: true,
      });

      const recording = createRecordingSnsAdapter(sns);
      const adapter = recording.adapter;
      const resolver = new SnsTopicArnResolver(adapter, {
        preload: {
          [standardTopic.name]: standardTopic.arn,
          [structuredTopic.name]: structuredTopic.arn,
          [fifoTopic.name]: fifoTopic.arn,
        },
        allowNetworkLookup: false,
      });
      const publisher = new SnsPublisher(adapter, resolver);
      const strictPublisher = new SnsPublisher(adapter, resolver, { sizeValidation: { maxBytes: 12 } });

      await publisher.publishJson({
        topic: standardTopic.name,
        payload: { mode: 'json', index: 1 },
        subject: 'json-event',
        messageGroupId: 'fair-group',
        messageAttributes: {
          mode: runtime.snsStringAttribute('json'),
          tags: runtime.snsStringArrayAttribute(['blue', 'green']),
        },
      });
      await publisher.publishString({
        topic: standardTopic.name,
        message: 'sns-plain-1',
        messageAttributes: { source: { DataType: 'String', StringValue: 'raw-map' } },
      });
      await publisher.publishSerialized({
        topic: standardTopic.name,
        payload: { mode: 'serialized', index: 3 },
        serialize: JSON.stringify,
      });
      await publisher.publishJsonBatch({
        topic: standardTopic.name,
        entries: [
          { id: 'json-batch-1', payload: { mode: 'json-batch', index: 4 } },
          { id: 'json-batch-2', payload: { mode: 'json-batch', index: 5 } },
        ],
      });
      await publisher.publishStringBatch({
        topic: standardTopic.name,
        entries: [
          { id: 'string-batch-1', message: 'sns-string-batch-1' },
          { id: 'string-batch-2', message: 'sns-string-batch-2' },
        ],
      });
      await publisher.publishSerializedBatch({
        topic: standardTopic.name,
        serialize: JSON.stringify,
        entries: [
          { id: 'serialized-batch-1', payload: { mode: 'serialized-batch', index: 8 } },
          { id: 'serialized-batch-2', payload: { mode: 'serialized-batch', index: 9 } },
        ],
      });
      await publisher.publishStructuredJson({
        topic: structuredTopic.name,
        payload: { default: 'structured-default-1' },
        subject: 'structured-one',
      });
      await publisher.publishStructuredJsonBatch({
        topic: structuredTopic.name,
        entries: [
          { id: 'structured-batch-1', payload: { default: 'structured-default-2' } },
          { id: 'structured-batch-2', payload: { default: 'structured-default-3' } },
        ],
      });
      await publisher.publishString({ topic: fifoTopic.name, message: 'fifo-sns-1', messageGroupId: 'fifo-group' });

      await assert.rejects(
        publisher.publishJson({
          topic: standardTopic.name,
          payload: { mode: 'invalid-dedupe' },
          messageDeduplicationId: 'dedupe-not-allowed',
        }),
        /standard SNS topic/i,
      );
      await assert.rejects(
        publisher.publishJson({ topic: fifoTopic.name, payload: { mode: 'missing-group' } }),
        /messageGroupId/i,
      );
      await assert.rejects(
        strictPublisher.publishString({ topic: standardTopic.name, message: 'sns-oversized-message' }),
        /exceeds the configured size limit/i,
      );
      await strictPublisher.publishString({
        topic: standardTopic.name,
        message: 'sns-oversized-message',
        sizeValidation: { maxBytes: 64 },
      });

      const standardRawMessages = await waitForMessages(sqs, standardRawQueue.url, {
        expectedCount: 10,
        deleteReceived: true,
        timeoutMs: 15_000,
      });
      const structuredMessages = await waitForMessages(sqs, standardStructuredQueue.url, {
        expectedCount: 3,
        deleteReceived: true,
        timeoutMs: 15_000,
      });
      const fifoMessages = await waitForMessages(sqs, fifoQueue.url, {
        expectedCount: 1,
        deleteReceived: true,
        timeoutMs: 10_000,
      });

      const standardBodies = standardRawMessages.map((message) => parseMessageBody(message)).sort();
      assert.deepEqual(standardBodies, [
        'sns-oversized-message',
        'sns-plain-1',
        'sns-string-batch-1',
        'sns-string-batch-2',
        '{"mode":"json","index":1}',
        '{"mode":"json-batch","index":4}',
        '{"mode":"json-batch","index":5}',
        '{"mode":"serialized","index":3}',
        '{"mode":"serialized-batch","index":8}',
        '{"mode":"serialized-batch","index":9}',
      ]);
      assert.deepEqual(structuredMessages.map((message) => parseMessageBody(message)).sort(), [
        'structured-default-1',
        'structured-default-2',
        'structured-default-3',
      ]);
      assert.deepEqual(
        fifoMessages.map((message) => parseMessageBody(message)),
        ['fifo-sns-1'],
      );

      const jsonMessage = standardRawMessages.find(
        (message) => parseMessageBody(message) === '{"mode":"json","index":1}',
      );
      assert.equal(jsonMessage?.MessageAttributes?.mode?.StringValue, 'json');
      assert.equal(jsonMessage?.MessageAttributes?.tags?.DataType, 'String.Array');
      assert.equal(jsonMessage?.MessageAttributes?.tags?.StringValue, '["blue","green"]');

      const stringMessage = standardRawMessages.find((message) => parseMessageBody(message) === 'sns-plain-1');
      assert.equal(stringMessage?.MessageAttributes?.source?.StringValue, 'raw-map');

      assert.equal(
        recording.records.publishInputs.some(
          (input) => input.TopicArn === standardTopic.arn && input.MessageGroupId === 'fair-group',
        ),
        true,
      );
      assert.equal(
        recording.records.publishInputs.some((input) => input.MessageStructure === 'json'),
        true,
      );
      assert.equal(
        recording.records.publishBatchInputs.some((input) =>
          (input.PublishBatchRequestEntries ?? []).every((entry) => entry.MessageStructure === 'json'),
        ),
        true,
      );
    },
  );
});
