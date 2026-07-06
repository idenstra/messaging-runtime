import assert from 'node:assert/strict';
import test from 'node:test';
import { type SNSClient } from '@aws-sdk/client-sns';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { AwsSnsAdapter, AwsSqsAdapter } from '../../src';

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
  await sqsAdapter.listQueues({ QueueNamePrefix: 'dispatch', MaxResults: 10, NextToken: 'page-1' });
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

  assert.equal(sentSqsCommands.length, 14);
  assert.equal(sentSnsCommands.length, 3);
});
