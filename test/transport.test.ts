import assert from 'node:assert/strict';
import test from 'node:test';
import { type ListTopicsCommandInput, type PublishBatchCommandInput, SNSClient } from '@aws-sdk/client-sns';
import type {
  ChangeMessageVisibilityBatchCommandInput,
  DeleteMessageBatchCommandInput,
  GetQueueUrlCommandInput,
  SendMessageBatchCommandInput,
  SendMessageCommandInput,
  SQSClient,
  MessageAttributeValue as SqsMessageAttributeValue,
} from '@aws-sdk/client-sqs';
import {
  AwsSnsAdapter,
  AwsSqsAdapter,
  decodeSnsEnvelope,
  decodeSnsNotificationJson,
  decodeSqsJsonBody,
  SnsPublisher,
  SnsTopicArnResolver,
  type SnsTransportClient,
  SqsMessageBatchOperator,
  SqsPublisher,
  SqsQueueUrlResolver,
  type SqsTransportClient,
} from '../src';

class FakeSqsTransportClient implements SqsTransportClient {
  readonly getQueueUrlInputs: GetQueueUrlCommandInput[] = [];
  readonly sendMessageInputs: SendMessageCommandInput[] = [];
  readonly sendMessageBatchInputs: SendMessageBatchCommandInput[] = [];
  readonly deleteMessageBatchInputs: DeleteMessageBatchCommandInput[] = [];
  readonly changeMessageVisibilityBatchInputs: ChangeMessageVisibilityBatchCommandInput[] = [];
  private readonly queueUrls = new Map<string, string>();
  private readonly batchResponses: Array<{
    Successful?: Array<{
      Id?: string;
      MessageId?: string;
      SequenceNumber?: string;
      MD5OfMessageBody?: string;
      MD5OfMessageAttributes?: string;
      MD5OfMessageSystemAttributes?: string;
    }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }> = [];
  private readonly deleteBatchResponses: Array<{
    Successful?: Array<{ Id?: string }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }> = [];
  private readonly visibilityBatchResponses: Array<{
    Successful?: Array<{ Id?: string }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }> = [];

  withQueueUrl(queueName: string, queueUrl: string): this {
    this.queueUrls.set(queueName, queueUrl);
    return this;
  }

  withBatchResponse(response: {
    Successful?: Array<{
      Id?: string;
      MessageId?: string;
      SequenceNumber?: string;
      MD5OfMessageBody?: string;
      MD5OfMessageAttributes?: string;
      MD5OfMessageSystemAttributes?: string;
    }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }): this {
    this.batchResponses.push(response);
    return this;
  }

  withDeleteBatchResponse(response: {
    Successful?: Array<{ Id?: string }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }): this {
    this.deleteBatchResponses.push(response);
    return this;
  }

  withVisibilityBatchResponse(response: {
    Successful?: Array<{ Id?: string }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }): this {
    this.visibilityBatchResponses.push(response);
    return this;
  }

  async getQueueUrl(input: GetQueueUrlCommandInput) {
    this.getQueueUrlInputs.push(input);
    return { QueueUrl: input.QueueName ? this.queueUrls.get(input.QueueName) : undefined };
  }

  async sendMessage(input: SendMessageCommandInput) {
    this.sendMessageInputs.push(input);
    return { MessageId: 'message-1', SequenceNumber: '1', MD5OfMessageBody: 'md5-body' };
  }

  async sendMessageBatch(input: SendMessageBatchCommandInput) {
    this.sendMessageBatchInputs.push(input);
    return this.batchResponses.shift() ?? { Successful: [], Failed: [] };
  }

  async deleteMessageBatch(input: DeleteMessageBatchCommandInput) {
    this.deleteMessageBatchInputs.push(input);
    return this.deleteBatchResponses.shift() ?? { Successful: [], Failed: [] };
  }

  async changeMessageVisibilityBatch(input: ChangeMessageVisibilityBatchCommandInput) {
    this.changeMessageVisibilityBatchInputs.push(input);
    return this.visibilityBatchResponses.shift() ?? { Successful: [], Failed: [] };
  }
}

class FakeSnsTransportClient implements SnsTransportClient {
  readonly listTopicsInputs: ListTopicsCommandInput[] = [];
  readonly publishInputs: Array<Record<string, unknown>> = [];
  readonly publishBatchInputs: PublishBatchCommandInput[] = [];
  private readonly listTopicsResponses: Array<{ NextToken?: string; Topics?: Array<{ TopicArn?: string }> }> = [];
  private readonly publishBatchResponses: Array<{
    Successful?: Array<{ Id?: string; MessageId?: string; SequenceNumber?: string }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }> = [];

  withListTopicsResponse(response: { NextToken?: string; Topics?: Array<{ TopicArn?: string }> }): this {
    this.listTopicsResponses.push(response);
    return this;
  }

  withPublishBatchResponse(response: {
    Successful?: Array<{ Id?: string; MessageId?: string; SequenceNumber?: string }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }): this {
    this.publishBatchResponses.push(response);
    return this;
  }

  async listTopics(input: ListTopicsCommandInput) {
    this.listTopicsInputs.push(input);
    return this.listTopicsResponses.shift() ?? { Topics: [] };
  }

  async publish(input: Record<string, unknown>) {
    this.publishInputs.push(input);
    return { MessageId: 'sns-message-1', SequenceNumber: '2' };
  }

  async publishBatch(input: PublishBatchCommandInput) {
    this.publishBatchInputs.push(input);
    return this.publishBatchResponses.shift() ?? { Successful: [], Failed: [] };
  }
}

test('decodeSqsJsonBody parses valid JSON', () => {
  const decoded = decodeSqsJsonBody<{ kind: string }>(JSON.stringify({ kind: 'alpha' }));
  assert.deepEqual(decoded, { kind: 'alpha' });
});

test('decodeSqsJsonBody rejects missing or invalid JSON', () => {
  assert.throws(() => decodeSqsJsonBody(undefined), /SQS message body must be a non-empty string/i);
  assert.throws(() => decodeSqsJsonBody('{'), /Invalid SQS message body JSON/i);
});

test('decodeSnsEnvelope parses notification envelopes and preserves metadata', () => {
  const decoded = decodeSnsEnvelope(
    JSON.stringify({
      Type: 'Notification',
      MessageId: 'sns-1',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events',
      Subject: 'Hello',
      Message: JSON.stringify({ kind: 'delivery' }),
      Timestamp: '2026-06-29T00:00:00.000Z',
      SignatureVersion: '1',
    }),
  );

  assert.equal(decoded.Type, 'Notification');
  assert.equal(decoded.TopicArn, 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events');
  assert.equal(decoded.Subject, 'Hello');
  assert.equal(decoded.SignatureVersion, '1');
});

test('decodeSnsEnvelope parses subscription confirmation and unsubscribe confirmation envelopes', () => {
  const subscription = decodeSnsEnvelope(
    JSON.stringify({
      Type: 'SubscriptionConfirmation',
      MessageId: 'sns-2',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events',
      Message: 'confirm',
      Timestamp: '2026-06-29T00:00:00.000Z',
      Token: 'token-1',
      SubscribeURL: 'https://sns.example/confirm',
    }),
  );
  const unsubscribe = decodeSnsEnvelope(
    JSON.stringify({
      Type: 'UnsubscribeConfirmation',
      MessageId: 'sns-3',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events',
      Message: 'unsubscribe',
      Timestamp: '2026-06-29T00:00:00.000Z',
      Token: 'token-2',
      SubscribeURL: 'https://sns.example/unsubscribe',
    }),
  );

  assert.equal(subscription.Type, 'SubscriptionConfirmation');
  assert.equal(subscription.Token, 'token-1');
  assert.equal(unsubscribe.Type, 'UnsubscribeConfirmation');
  assert.equal(unsubscribe.SubscribeURL, 'https://sns.example/unsubscribe');
});

test('decodeSnsEnvelope rejects malformed non-SNS bodies', () => {
  assert.throws(() => decodeSnsEnvelope(JSON.stringify({ foo: 'bar' })), /Type must be Notification/i);
});

test('decodeSnsNotificationJson parses notification JSON and rejects control or invalid payloads', () => {
  const decoded = decodeSnsNotificationJson<{ eventType: string }>(
    JSON.stringify({
      Type: 'Notification',
      MessageId: 'sns-1',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events',
      Message: JSON.stringify({ eventType: 'DELIVERY' }),
      Timestamp: '2026-06-29T00:00:00.000Z',
    }),
  );

  assert.equal(decoded.envelope.Type, 'Notification');
  assert.deepEqual(decoded.payload, { eventType: 'DELIVERY' });

  assert.throws(
    () =>
      decodeSnsNotificationJson(
        JSON.stringify({
          Type: 'SubscriptionConfirmation',
          MessageId: 'sns-2',
          TopicArn: 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events',
          Message: 'confirm',
          Timestamp: '2026-06-29T00:00:00.000Z',
          Token: 'token-1',
          SubscribeURL: 'https://sns.example/confirm',
        }),
      ),
    /must be an SNS Notification envelope/i,
  );
  assert.throws(
    () =>
      decodeSnsNotificationJson(
        JSON.stringify({
          Type: 'Notification',
          MessageId: 'sns-3',
          TopicArn: 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events',
          Message: '{',
          Timestamp: '2026-06-29T00:00:00.000Z',
        }),
      ),
    /Invalid SNS notification message payload JSON/i,
  );
});

test('SqsQueueUrlResolver resolves queue names with caching and accepts URLs and ARNs', async () => {
  const client = new FakeSqsTransportClient().withQueueUrl(
    'dispatch-queue',
    'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
  );
  const resolver = new SqsQueueUrlResolver(client);

  const resolvedByName = await resolver.resolve('dispatch-queue');
  const resolvedByNameAgain = await resolver.resolve('dispatch-queue');
  const resolvedByUrl = await resolver.resolve('https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue');
  const resolvedByArn = await resolver.resolve('arn:aws:sqs:us-east-1:123456789012:dispatch-queue');

  assert.equal(resolvedByName, 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue');
  assert.equal(resolvedByNameAgain, resolvedByName);
  assert.equal(resolvedByUrl, resolvedByName);
  assert.equal(resolvedByArn, resolvedByName);
  assert.equal(client.getQueueUrlInputs.length, 1);
});

test('SqsQueueUrlResolver supports preloaded mappings and optional no-network mode', async () => {
  const client = new FakeSqsTransportClient();
  const resolver = new SqsQueueUrlResolver(client, {
    preload: {
      'dispatch-queue': 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
      'arn:aws:sqs:us-east-1:123456789012:audit-queue': 'https://sqs.us-east-1.amazonaws.com/123456789012/audit-queue',
    },
    allowNetworkLookup: false,
  });

  assert.equal(
    await resolver.resolve('dispatch-queue'),
    'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
  );
  assert.equal(
    await resolver.resolve('https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue'),
    'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
  );
  assert.equal(
    await resolver.resolve('arn:aws:sqs:us-east-1:123456789012:audit-queue'),
    'https://sqs.us-east-1.amazonaws.com/123456789012/audit-queue',
  );
  assert.equal(client.getQueueUrlInputs.length, 0);
  await assert.rejects(() => resolver.resolve('missing-queue'), /network lookup is disabled/i);
});

test('SnsTopicArnResolver resolves topic names with pagination, accepts ARNs, and caches results', async () => {
  const client = new FakeSnsTransportClient()
    .withListTopicsResponse({
      NextToken: 'page-2',
      Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:123456789012:other-topic' }],
    })
    .withListTopicsResponse({ Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events' }] });
  const resolver = new SnsTopicArnResolver(client);

  const resolvedByName = await resolver.resolve('idenstra-email-events');
  const resolvedByArn = await resolver.resolve('arn:aws:sns:us-east-1:123456789012:idenstra-email-events');
  const resolvedByNameAgain = await resolver.resolve('idenstra-email-events');

  assert.equal(resolvedByName, 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events');
  assert.equal(resolvedByArn, resolvedByName);
  assert.equal(resolvedByNameAgain, resolvedByName);
  assert.deepEqual(client.listTopicsInputs, [{ NextToken: undefined }, { NextToken: 'page-2' }]);
});

test('SnsTopicArnResolver supports preloaded mappings and optional no-network mode', async () => {
  const client = new FakeSnsTransportClient();
  const resolver = new SnsTopicArnResolver(client, {
    preload: {
      'idenstra-email-events': 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events',
      'arn:aws:sns:us-east-1:123456789012:tenant-events': 'arn:aws:sns:us-east-1:123456789012:tenant-events',
    },
    allowNetworkLookup: false,
  });

  assert.equal(
    await resolver.resolve('idenstra-email-events'),
    'arn:aws:sns:us-east-1:123456789012:idenstra-email-events',
  );
  assert.equal(
    await resolver.resolve('arn:aws:sns:us-east-1:123456789012:tenant-events'),
    'arn:aws:sns:us-east-1:123456789012:tenant-events',
  );
  assert.equal(client.listTopicsInputs.length, 0);
  await assert.rejects(() => resolver.resolve('missing-topic'), /network lookup is disabled/i);
});

test('SnsTopicArnResolver fails cleanly when a topic name cannot be found', async () => {
  const client = new FakeSnsTransportClient().withListTopicsResponse({ Topics: [] });
  const resolver = new SnsTopicArnResolver(client);

  await assert.rejects(() => resolver.resolve('missing-topic'), /missing-topic.*not found/i);
});

test('SqsPublisher sendJson resolves queue identifiers and forwards transport-native options', async () => {
  const attribute: SqsMessageAttributeValue = { DataType: 'String', StringValue: 'alpha' };
  const client = new FakeSqsTransportClient().withQueueUrl(
    'dispatch-queue',
    'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
  );
  const publisher = new SqsPublisher(client);

  const result = await publisher.sendJson({
    queue: 'arn:aws:sqs:us-east-1:123456789012:dispatch-queue',
    payload: { kind: 'dispatch' },
    delaySeconds: 5,
    messageAttributes: { mode: attribute },
    messageGroupId: 'group-1',
    messageDeduplicationId: 'dedupe-1',
  });

  assert.equal(result.queueUrl, 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue');
  assert.equal(client.getQueueUrlInputs.length, 1);
  assert.deepEqual(client.sendMessageInputs[0], {
    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
    MessageBody: JSON.stringify({ kind: 'dispatch' }),
    DelaySeconds: 5,
    MessageAttributes: { mode: attribute },
    MessageGroupId: 'group-1',
    MessageDeduplicationId: 'dedupe-1',
  });
});

test('SqsPublisher sendJsonBatch chunks entries and returns keyed aggregate results', async () => {
  const client = new FakeSqsTransportClient()
    .withQueueUrl('dispatch-queue', 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue')
    .withBatchResponse({
      Successful: Array.from({ length: 10 }, (_, index) => ({ Id: `entry-${index}`, MessageId: `message-${index}` })),
    })
    .withBatchResponse({
      Successful: [{ Id: 'entry-10', MessageId: 'message-10' }],
      Failed: [{ Id: 'entry-11', Code: 'InternalError', Message: 'boom', SenderFault: false }],
    });
  const publisher = new SqsPublisher(client);

  const result = await publisher.sendJsonBatch({
    queue: 'dispatch-queue',
    entries: Array.from({ length: 12 }, (_, index) => ({ id: `job-${index}`, payload: { index } })),
  });

  assert.equal(client.sendMessageBatchInputs.length, 2);
  assert.equal(client.sendMessageBatchInputs[0]?.Entries?.length, 10);
  assert.equal(client.sendMessageBatchInputs[1]?.Entries?.length, 2);
  assert.equal(result.requestedCount, 12);
  assert.equal(result.successfulCount, 11);
  assert.equal(result.failedCount, 1);
  assert.equal(result.successfulById['job-0']?.messageId, 'message-0');
  assert.equal(result.successfulById['job-10']?.messageId, 'message-10');
  assert.equal(result.failedById['job-11']?.code, 'InternalError');
});

test('SqsMessageBatchOperator deleteMessages chunks entries and returns keyed aggregate results', async () => {
  const client = new FakeSqsTransportClient()
    .withQueueUrl('dispatch-queue', 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue')
    .withDeleteBatchResponse({ Successful: Array.from({ length: 10 }, (_, index) => ({ Id: `entry-${index}` })) })
    .withDeleteBatchResponse({
      Successful: [{ Id: 'entry-10' }],
      Failed: [{ Id: 'entry-11', Code: 'ReceiptHandleIsInvalid', Message: 'boom', SenderFault: true }],
    });
  const operator = new SqsMessageBatchOperator(client);

  const result = await operator.deleteMessages({
    queue: 'dispatch-queue',
    entries: Array.from({ length: 12 }, (_, index) => ({ id: `job-${index}`, receiptHandle: `receipt-${index}` })),
  });

  assert.equal(client.deleteMessageBatchInputs.length, 2);
  assert.equal(client.deleteMessageBatchInputs[0]?.Entries?.length, 10);
  assert.equal(client.deleteMessageBatchInputs[1]?.Entries?.length, 2);
  assert.equal(result.requestedCount, 12);
  assert.equal(result.successfulCount, 11);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.successfulById['job-0'], { id: 'job-0' });
  assert.equal(result.failedById['job-11']?.code, 'ReceiptHandleIsInvalid');
});

test('SqsMessageBatchOperator changeMessageVisibility chunks entries, forwards per-entry timeouts, and normalizes results', async () => {
  const client = new FakeSqsTransportClient()
    .withQueueUrl('dispatch-queue', 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue')
    .withVisibilityBatchResponse({
      Successful: [{ Id: 'entry-0' }],
      Failed: [{ Id: 'entry-1', Code: 'InternalError', Message: 'boom', SenderFault: false }],
    });
  const operator = new SqsMessageBatchOperator(client);

  const result = await operator.changeMessageVisibility({
    queue: 'dispatch-queue',
    entries: [
      { id: 'job-0', receiptHandle: 'receipt-0', visibilityTimeoutSeconds: 30 },
      { id: 'job-1', receiptHandle: 'receipt-1', visibilityTimeoutSeconds: 45 },
    ],
  });

  assert.deepEqual(client.changeMessageVisibilityBatchInputs[0], {
    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
    Entries: [
      { Id: 'entry-0', ReceiptHandle: 'receipt-0', VisibilityTimeout: 30 },
      { Id: 'entry-1', ReceiptHandle: 'receipt-1', VisibilityTimeout: 45 },
    ],
  });
  assert.deepEqual(result.successfulById['job-0'], { id: 'job-0' });
  assert.equal(result.failedById['job-1']?.message, 'boom');
});

test('SqsMessageBatchOperator rejects duplicate caller IDs before any AWS call', async () => {
  const client = new FakeSqsTransportClient().withQueueUrl(
    'dispatch-queue',
    'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
  );
  const operator = new SqsMessageBatchOperator(client);

  await assert.rejects(
    () =>
      operator.deleteMessages({
        queue: 'dispatch-queue',
        entries: [
          { id: 'job-0', receiptHandle: 'receipt-0' },
          { id: 'job-0', receiptHandle: 'receipt-1' },
        ],
      }),
    /Duplicate SQS delete batch entry id "job-0" is not allowed\./i,
  );
  assert.equal(client.deleteMessageBatchInputs.length, 0);
});

test('SnsPublisher publishJson resolves topic identifiers and forwards publish options', async () => {
  const client = new FakeSnsTransportClient().withListTopicsResponse({
    Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events' }],
  });
  const publisher = new SnsPublisher(client);

  const result = await publisher.publishJson({
    topic: 'idenstra-email-events',
    payload: { kind: 'delivery' },
    subject: 'SES Delivery',
    messageAttributes: { channel: { DataType: 'String', StringValue: 'email' } },
    messageGroupId: 'group-1',
    messageDeduplicationId: 'dedupe-1',
  });

  assert.equal(result.topicArn, 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events');
  assert.deepEqual(client.publishInputs[0], {
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events',
    Message: JSON.stringify({ kind: 'delivery' }),
    Subject: 'SES Delivery',
    MessageAttributes: { channel: { DataType: 'String', StringValue: 'email' } },
    MessageGroupId: 'group-1',
    MessageDeduplicationId: 'dedupe-1',
  });
});

test('SnsPublisher publishJsonBatch chunks entries and returns keyed aggregate results', async () => {
  const client = new FakeSnsTransportClient()
    .withPublishBatchResponse({
      Successful: Array.from({ length: 10 }, (_, index) => ({ Id: `entry-${index}`, MessageId: `message-${index}` })),
    })
    .withPublishBatchResponse({
      Successful: [{ Id: 'entry-10', MessageId: 'message-10', SequenceNumber: '10' }],
      Failed: [{ Id: 'entry-11', Code: 'InternalError', Message: 'boom', SenderFault: false }],
    });
  const publisher = new SnsPublisher(client);

  const result = await publisher.publishJsonBatch({
    topic: 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events',
    entries: Array.from({ length: 12 }, (_, index) => ({
      id: `event-${index}`,
      payload: { index },
      subject: `Event ${index}`,
    })),
  });

  assert.equal(client.publishBatchInputs.length, 2);
  assert.equal(client.publishBatchInputs[0]?.PublishBatchRequestEntries?.length, 10);
  assert.equal(client.publishBatchInputs[1]?.PublishBatchRequestEntries?.length, 2);
  assert.equal(result.requestedCount, 12);
  assert.equal(result.successfulCount, 11);
  assert.equal(result.failedCount, 1);
  assert.equal(result.successfulById['event-10']?.sequenceNumber, '10');
  assert.equal(result.failedById['event-11']?.code, 'InternalError');
});

test('SnsPublisher publishJsonBatch forwards FIFO fields and rejects FIFO violations', async () => {
  const client = new FakeSnsTransportClient().withPublishBatchResponse({
    Successful: [{ Id: 'entry-0', MessageId: 'message-0', SequenceNumber: '1' }],
  });
  const publisher = new SnsPublisher(client);

  await publisher.publishJsonBatch({
    topic: 'arn:aws:sns:us-east-1:123456789012:events.fifo',
    entries: [
      { id: 'event-0', payload: { kind: 'delivery' }, messageGroupId: 'group-1', messageDeduplicationId: 'dedupe-1' },
    ],
  });

  assert.deepEqual(client.publishBatchInputs[0], {
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:events.fifo',
    PublishBatchRequestEntries: [
      {
        Id: 'entry-0',
        Message: JSON.stringify({ kind: 'delivery' }),
        Subject: undefined,
        MessageAttributes: undefined,
        MessageGroupId: 'group-1',
        MessageDeduplicationId: 'dedupe-1',
      },
    ],
  });

  await assert.rejects(
    () =>
      publisher.publishJsonBatch({
        topic: 'arn:aws:sns:us-east-1:123456789012:events.fifo',
        entries: [{ id: 'event-1', payload: { kind: 'delivery' } }],
      }),
    /messageGroupId for SNS FIFO batch entry event-1/i,
  );

  await assert.rejects(
    () =>
      publisher.publishJsonBatch({
        topic: 'arn:aws:sns:us-east-1:123456789012:events',
        entries: [{ id: 'event-2', payload: { kind: 'delivery' }, messageGroupId: 'group-2' }],
      }),
    /SNS standard topic batch entry event-2 must not declare messageGroupId/i,
  );
});

test('AWS adapters delegate to AWS SDK v3 clients across runtime and transport operations', async () => {
  const sentSqsCommands: unknown[] = [];
  const sentSnsCommands: unknown[] = [];
  const sqsAdapter = new AwsSqsAdapter({
    send: async (command: unknown) => {
      sentSqsCommands.push(command);
      return {};
    },
  } as SQSClient);
  const snsAdapter = new AwsSnsAdapter({
    send: async (command: unknown) => {
      sentSnsCommands.push(command);
      return {};
    },
  } as SNSClient);

  await sqsAdapter.receiveMessage({ QueueUrl: 'https://queue.test/dispatch' });
  await sqsAdapter.deleteMessage({ QueueUrl: 'https://queue.test/dispatch', ReceiptHandle: 'receipt-1' });
  await sqsAdapter.changeMessageVisibility({
    QueueUrl: 'https://queue.test/dispatch',
    ReceiptHandle: 'receipt-1',
    VisibilityTimeout: 30,
  });
  await sqsAdapter.deleteMessageBatch({
    QueueUrl: 'https://queue.test/dispatch',
    Entries: [{ Id: 'entry-0', ReceiptHandle: 'receipt-1' }],
  });
  await sqsAdapter.changeMessageVisibilityBatch({
    QueueUrl: 'https://queue.test/dispatch',
    Entries: [{ Id: 'entry-0', ReceiptHandle: 'receipt-1', VisibilityTimeout: 30 }],
  });
  await sqsAdapter.getQueueUrl({ QueueName: 'dispatch-queue' });
  await sqsAdapter.getQueueAttributes({
    QueueUrl: 'https://queue.test/dispatch',
    AttributeNames: ['QueueArn', 'ApproximateNumberOfMessages'],
  });
  await sqsAdapter.listDeadLetterSourceQueues({ QueueUrl: 'https://queue.test/dispatch', MaxResults: 10 });
  await sqsAdapter.startMessageMoveTask({
    SourceArn: 'arn:aws:sqs:us-east-1:123456789012:dispatch-dlq',
    DestinationArn: 'arn:aws:sqs:us-east-1:123456789012:dispatch-primary',
    MaxNumberOfMessagesPerSecond: 25,
  });
  await sqsAdapter.listMessageMoveTasks({
    SourceArn: 'arn:aws:sqs:us-east-1:123456789012:dispatch-dlq',
    MaxResults: 5,
  });
  await sqsAdapter.cancelMessageMoveTask({ TaskHandle: 'task-1' });
  await sqsAdapter.sendMessage({ QueueUrl: 'https://queue.test/dispatch', MessageBody: '{}' });
  await sqsAdapter.sendMessageBatch({
    QueueUrl: 'https://queue.test/dispatch',
    Entries: [{ Id: 'entry-0', MessageBody: '{}' }],
  });
  await snsAdapter.listTopics({ NextToken: undefined });
  await snsAdapter.publish({ TopicArn: 'arn:aws:sns:us-east-1:123456789012:topic', Message: '{}' });
  await snsAdapter.publishBatch({
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:topic',
    PublishBatchRequestEntries: [{ Id: 'entry-0', Message: '{}' }],
  });

  assert.equal(sentSqsCommands.length, 13);
  assert.equal(sentSnsCommands.length, 3);
});
