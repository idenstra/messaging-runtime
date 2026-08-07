import assert from 'node:assert/strict';
import test from 'node:test';
import type { ListTopicsCommandInput, PublishCommandInput } from '@aws-sdk/client-sns';
import type { GetQueueUrlCommandInput, SendMessageCommandInput } from '@aws-sdk/client-sqs';
import {
  SnsPublisher,
  type SnsStructuredJsonMessage,
  type SnsTransportClient,
  SqsPublisher,
  type SqsTransportClient,
  SqsWorkerManager,
  snsJsonQueueRoute,
  snsStringAttribute,
  sqsJsonRoute,
  sqsJsonToQueueForwardHandler,
  sqsJsonToTopicForwardHandler,
  sqsSerializedToQueueForwardHandler,
  sqsSerializedToTopicForwardHandler,
  sqsStringAttribute,
  sqsStringRoute,
  sqsStringToQueueForwardHandler,
  sqsStringToTopicForwardHandler,
  sqsStructuredJsonToTopicForwardHandler,
} from '../src';
import type { SqsWorkerHandlerContext, SqsWorkerMessage, SqsWorkerRoute, SqsWorkerServiceRoute } from '../src/core';
import { FakeSqsClient, waitFor } from './core/support';

class FakeQueueTransportClient implements SqsTransportClient {
  readonly getQueueUrlInputs: GetQueueUrlCommandInput[] = [];
  readonly sendMessageInputs: SendMessageCommandInput[] = [];
  readonly sendMessageBatchInputs: never[] = [];
  readonly deleteMessageBatchInputs: never[] = [];
  readonly changeMessageVisibilityBatchInputs: never[] = [];
  private readonly queueUrls = new Map<string, string>();
  sendMessageImpl?: (input: SendMessageCommandInput) => Promise<{ MessageId?: string; SequenceNumber?: string }>;

  withQueueUrl(queueName: string, queueUrl: string): this {
    this.queueUrls.set(queueName, queueUrl);
    return this;
  }

  async getQueueUrl(input: GetQueueUrlCommandInput) {
    this.getQueueUrlInputs.push(input);
    return { QueueUrl: input.QueueName ? this.queueUrls.get(input.QueueName) : undefined };
  }

  async sendMessage(input: SendMessageCommandInput) {
    this.sendMessageInputs.push(input);
    if (this.sendMessageImpl) {
      return this.sendMessageImpl(input);
    }

    return { MessageId: 'message-1', SequenceNumber: '1' };
  }

  async sendMessageBatch(): Promise<never> {
    throw new Error('sendMessageBatch should not be called in forward-handler tests.');
  }

  async deleteMessageBatch(): Promise<never> {
    throw new Error('deleteMessageBatch should not be called in forward-handler tests.');
  }

  async changeMessageVisibilityBatch(): Promise<never> {
    throw new Error('changeMessageVisibilityBatch should not be called in forward-handler tests.');
  }
}

class FakeTopicTransportClient implements SnsTransportClient {
  readonly listTopicsInputs: ListTopicsCommandInput[] = [];
  readonly publishInputs: PublishCommandInput[] = [];
  readonly publishBatchInputs: never[] = [];
  private readonly topicArns = new Map<string, string>();

  withTopicArn(topicName: string, topicArn: string): this {
    this.topicArns.set(topicName, topicArn);
    return this;
  }

  async listTopics(input: ListTopicsCommandInput) {
    this.listTopicsInputs.push(input);
    return { Topics: [...this.topicArns.entries()].map(([, topicArn]) => ({ TopicArn: topicArn })) };
  }

  async publish(input: PublishCommandInput) {
    this.publishInputs.push(input);
    return { MessageId: 'sns-message-1', SequenceNumber: '2' };
  }

  async publishBatch(): Promise<never> {
    throw new Error('publishBatch should not be called in forward-handler tests.');
  }
}

test('queue forwarding helpers compose with route factories for direct-manager and service-host routes', () => {
  const queuePublisher = new SqsPublisher(
    new FakeQueueTransportClient().withQueueUrl('relay-target', 'https://queue.test/relay-target'),
  );
  const topicPublisher = new SnsPublisher(
    new FakeTopicTransportClient().withTopicArn('relay-topic', 'arn:aws:sns:us-east-1:123456789012:relay-topic'),
  );

  const directRoute: SqsWorkerRoute<{ jobId: string }> = sqsJsonRoute({
    name: 'jobs',
    queueUrl: 'https://queue.test/jobs',
    handle: sqsJsonToQueueForwardHandler({ publisher: queuePublisher, queue: 'relay-target' }),
  });

  const hostRoute: SqsWorkerServiceRoute<string> = sqsStringRoute({
    name: 'raw-jobs',
    queue: 'raw-jobs',
    handle: sqsStringToTopicForwardHandler({ publisher: topicPublisher, topic: 'relay-topic' }),
  });

  const snsRoute: SqsWorkerServiceRoute<{ eventId: string }> = snsJsonQueueRoute({
    name: 'events',
    queue: 'events',
    handle: sqsJsonToTopicForwardHandler({
      publisher: topicPublisher,
      topic: 'relay-topic',
      subject: ({ payload }) => `event:${payload.eventId}`,
    }),
  });

  void [directRoute, hostRoute, snsRoute];
});

test('sqsJsonToQueueForwardHandler forwards payload as-is and can extend copied attributes', async () => {
  const queueClient = new FakeQueueTransportClient().withQueueUrl('relay-target', 'https://queue.test/relay-target');
  const publisher = new SqsPublisher(queueClient);
  const handler = sqsJsonToQueueForwardHandler<{ jobId: string }>({
    publisher,
    queue: 'relay-target',
    copyMessageAttributes: true,
    buildMessageAttributes: ({ copiedMessageAttributes }) => ({
      ...copiedMessageAttributes,
      forwarded: sqsStringAttribute('yes'),
    }),
    delaySeconds: ({ payload }) => payload.jobId.length,
    messageGroupId: 'group-1',
    messageDeduplicationId: ({ payload }) => `dedupe:${payload.jobId}`,
    sizeValidation: { maxBytes: 1_024 },
  });

  await handler(
    createHandlerContext(
      { jobId: 'job-1' },
      { messageAttributes: { origin: { dataType: 'String', stringValue: 'source' } } },
    ),
  );

  assert.equal(queueClient.sendMessageInputs.length, 1);
  assert.deepEqual(queueClient.sendMessageInputs[0], {
    QueueUrl: 'https://queue.test/relay-target',
    MessageBody: JSON.stringify({ jobId: 'job-1' }),
    DelaySeconds: 5,
    MessageAttributes: {
      origin: { DataType: 'String', StringValue: 'source', BinaryValue: undefined },
      forwarded: { DataType: 'String', StringValue: 'yes' },
    },
    MessageGroupId: 'group-1',
    MessageDeduplicationId: 'dedupe:job-1',
  });
});

test('string forwarding helpers use direct string payloads or explicit mapping', async () => {
  const queueClient = new FakeQueueTransportClient().withQueueUrl('relay-target', 'https://queue.test/relay-target');
  const topicClient = new FakeTopicTransportClient().withTopicArn(
    'relay-topic',
    'arn:aws:sns:us-east-1:123456789012:relay-topic',
  );
  const queuePublisher = new SqsPublisher(queueClient);
  const topicPublisher = new SnsPublisher(topicClient);

  const queueStringHandler = sqsStringToQueueForwardHandler({ publisher: queuePublisher, queue: 'relay-target' });
  await queueStringHandler(createHandlerContext('plain-text'));

  const topicStringHandler = sqsStringToTopicForwardHandler<{ eventType: string }>({
    publisher: topicPublisher,
    topic: 'relay-topic',
    mapMessage: ({ payload }) => `event:${payload.eventType}`,
    subject: ({ payload }) => payload.eventType,
  });
  await topicStringHandler(createHandlerContext({ eventType: 'created' }));

  assert.equal(queueClient.sendMessageInputs[0]?.MessageBody, 'plain-text');
  assert.equal(topicClient.publishInputs[0]?.Message, 'event:created');
  assert.equal(topicClient.publishInputs[0]?.Subject, 'created');

  const invalidQueueStringHandler = sqsStringToQueueForwardHandler({
    publisher: queuePublisher,
    queue: 'relay-target',
  });
  await assert.rejects(
    () => invalidQueueStringHandler(createHandlerContext({ eventType: 'created' })),
    /sqsStringToQueueForwardHandler payload must be a non-empty string/i,
  );
});

test('serialized forwarding helpers use the provided serializer and mapped payload when needed', async () => {
  const queueClient = new FakeQueueTransportClient().withQueueUrl('relay-target', 'https://queue.test/relay-target');
  const topicClient = new FakeTopicTransportClient().withTopicArn(
    'relay-topic',
    'arn:aws:sns:us-east-1:123456789012:relay-topic',
  );
  const queuePublisher = new SqsPublisher(queueClient);
  const topicPublisher = new SnsPublisher(topicClient);

  const queueHandler = sqsSerializedToQueueForwardHandler<{ jobId: string }, { relayId: string }>({
    publisher: queuePublisher,
    queue: 'relay-target',
    mapPayload: ({ payload }) => ({ relayId: payload.jobId }),
    serialize: (payload) => `queue:${payload.relayId}`,
  });

  const topicHandler = sqsSerializedToTopicForwardHandler<{ jobId: string }, { relayId: string }>({
    publisher: topicPublisher,
    topic: 'relay-topic',
    mapPayload: ({ payload }) => ({ relayId: payload.jobId }),
    serialize: (payload) => `topic:${payload.relayId}`,
    subject: 'relay',
  });

  await queueHandler(createHandlerContext({ jobId: 'job-9' }));
  await topicHandler(createHandlerContext({ jobId: 'job-9' }));

  assert.equal(queueClient.sendMessageInputs[0]?.MessageBody, 'queue:job-9');
  assert.equal(topicClient.publishInputs[0]?.Message, 'topic:job-9');
  assert.equal(topicClient.publishInputs[0]?.Subject, 'relay');
});

test('topic forwarding helpers support copied SNS String.Array attributes while queue helpers reject them', async () => {
  const queueClient = new FakeQueueTransportClient().withQueueUrl('relay-target', 'https://queue.test/relay-target');
  const topicClient = new FakeTopicTransportClient().withTopicArn(
    'relay-topic',
    'arn:aws:sns:us-east-1:123456789012:relay-topic',
  );
  const queuePublisher = new SqsPublisher(queueClient);
  const topicPublisher = new SnsPublisher(topicClient);
  const messageAttributes = {
    filters: { dataType: 'String.Array', stringValue: JSON.stringify(['created', 'updated']) },
  };

  await sqsJsonToTopicForwardHandler<{ eventId: string }>({
    publisher: topicPublisher,
    topic: 'relay-topic',
    copyMessageAttributes: true,
    buildMessageAttributes: ({ copiedMessageAttributes }) => ({
      ...copiedMessageAttributes,
      relay: snsStringAttribute('topic'),
    }),
  })(createHandlerContext({ eventId: 'evt-1' }, { messageAttributes }));

  assert.deepEqual(topicClient.publishInputs[0]?.MessageAttributes, {
    filters: { DataType: 'String.Array', StringValue: JSON.stringify(['created', 'updated']), BinaryValue: undefined },
    relay: { DataType: 'String', StringValue: 'topic' },
  });

  await assert.rejects(
    () =>
      sqsJsonToQueueForwardHandler<{ eventId: string }>({
        publisher: queuePublisher,
        queue: 'relay-target',
        copyMessageAttributes: true,
      })(createHandlerContext({ eventId: 'evt-1' }, { messageAttributes })),
    /does not support String\.Array attributes/i,
  );
});

test('forwarding helpers fail clearly on unsupported list-valued inbound attribute shapes', async () => {
  const topicClient = new FakeTopicTransportClient().withTopicArn(
    'relay-topic',
    'arn:aws:sns:us-east-1:123456789012:relay-topic',
  );
  const publisher = new SnsPublisher(topicClient);

  await assert.rejects(
    () =>
      sqsJsonToTopicForwardHandler<{ eventId: string }>({
        publisher,
        topic: 'relay-topic',
        copyMessageAttributes: true,
      })(
        createHandlerContext(
          { eventId: 'evt-1' },
          {
            messageAttributes: {
              invalid: { dataType: 'String', stringValue: 'value', stringListValues: ['unexpected'] },
            },
          },
        ),
      ),
    /list-valued message attributes are not supported/i,
  );
});

test('sqsStructuredJsonToTopicForwardHandler forwards structured payloads and supports explicit mapping', async () => {
  const topicClient = new FakeTopicTransportClient().withTopicArn(
    'relay-topic.fifo',
    'arn:aws:sns:us-east-1:123456789012:relay-topic.fifo',
  );
  const publisher = new SnsPublisher(topicClient);
  const directHandler = sqsStructuredJsonToTopicForwardHandler({
    publisher,
    topic: 'relay-topic.fifo',
    messageGroupId: 'group-1',
  });

  await directHandler(
    createHandlerContext<SnsStructuredJsonMessage>({
      default: JSON.stringify({ eventId: 'evt-1' }),
      sqs: JSON.stringify({ eventId: 'evt-1', channel: 'sqs' }),
    }),
  );

  const mappedHandler = sqsStructuredJsonToTopicForwardHandler<{ eventId: string }>({
    publisher,
    topic: 'relay-topic.fifo',
    messageGroupId: ({ payload }) => payload.eventId,
    mapPayload: ({ payload }) => ({
      default: JSON.stringify(payload),
      https: JSON.stringify({ ...payload, channel: 'https' }),
    }),
  });

  await mappedHandler(createHandlerContext({ eventId: 'evt-2' }));

  assert.equal(topicClient.publishInputs[0]?.MessageStructure, 'json');
  assert.equal(topicClient.publishInputs[0]?.MessageGroupId, 'group-1');
  assert.equal(topicClient.publishInputs[1]?.MessageStructure, 'json');
  assert.equal(topicClient.publishInputs[1]?.MessageGroupId, 'evt-2');

  await assert.rejects(
    () =>
      sqsStructuredJsonToTopicForwardHandler<{ eventId: string }>({
        publisher,
        topic: 'relay-topic.fifo',
        messageGroupId: 'group-3',
      })(createHandlerContext({ eventId: 'evt-3' })),
    /must be an SNS structured JSON message or provide mapPayload/i,
  );
});

test('successful forwarding returns normally and keeps the normal manager delete-on-success path', async () => {
  const runtimeClient = new FakeSqsClient([
    { Messages: [{ MessageId: 'message-1', ReceiptHandle: 'receipt-1', Body: JSON.stringify({ eventId: 'evt-1' }) }] },
  ]);
  const transportClient = new FakeQueueTransportClient().withQueueUrl(
    'relay-target',
    'https://queue.test/relay-target',
  );
  const publisher = new SqsPublisher(transportClient);
  const manager = new SqsWorkerManager(runtimeClient);

  manager.register(
    sqsJsonRoute<{ eventId: string }>({
      name: 'events',
      queueUrl: 'https://queue.test/events',
      config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10 },
      handle: sqsJsonToQueueForwardHandler({ publisher, queue: 'relay-target' }),
    }),
  );

  await manager.start();
  await waitFor(() => runtimeClient.deleteBatchInputs.length === 1 && transportClient.sendMessageInputs.length === 1, {
    timeoutMs: 2_000,
  });
  await manager.stop();

  assert.equal(runtimeClient.deleteBatchInputs.length, 1);
  assert.equal(transportClient.sendMessageInputs.length, 1);
  assert.equal(manager.getSnapshot().routes[0]?.counters.messageDeleteCount, 1);
});

test('publish failure throws and keeps the normal worker failure path', async () => {
  const runtimeClient = new FakeSqsClient([
    { Messages: [{ MessageId: 'message-2', ReceiptHandle: 'receipt-2', Body: JSON.stringify({ eventId: 'evt-2' }) }] },
  ]);
  const transportClient = new FakeQueueTransportClient().withQueueUrl(
    'relay-target',
    'https://queue.test/relay-target',
  );
  transportClient.sendMessageImpl = async () => {
    throw new Error('publish failed');
  };
  const publisher = new SqsPublisher(transportClient);
  const manager = new SqsWorkerManager(runtimeClient);

  manager.register(
    sqsJsonRoute<{ eventId: string }>({
      name: 'events',
      queueUrl: 'https://queue.test/events',
      config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10 },
      handle: sqsJsonToQueueForwardHandler({ publisher, queue: 'relay-target' }),
    }),
  );

  await manager.start();
  await waitFor(() => manager.getSnapshot().routes[0]?.counters.messageKeepCount === 1, { timeoutMs: 2_000 });
  await manager.stop();

  assert.equal(runtimeClient.deleteInputs.length, 0);
  assert.equal(runtimeClient.deleteBatchInputs.length, 0);
  assert.equal(manager.getSnapshot().routes[0]?.counters.handlerFailureCount, 1);
  assert.equal(manager.getSnapshot().routes[0]?.counters.messageKeepCount, 1);
});

function createHandlerContext<TPayload>(
  payload: TPayload,
  overrides: Partial<Pick<SqsWorkerMessage, 'body' | 'messageAttributes'>> = {},
): SqsWorkerHandlerContext<TPayload> {
  return {
    routeName: 'relay-route',
    queueUrl: 'https://queue.test/source',
    payload,
    message: {
      messageId: 'message-1',
      receiptHandle: 'receipt-1',
      body: overrides.body,
      attributes: {},
      systemAttributes: {},
      messageAttributes: overrides.messageAttributes ?? {},
      raw: {} as never,
    },
    abortSignal: new AbortController().signal,
    heartbeat: async () => undefined,
  };
}
