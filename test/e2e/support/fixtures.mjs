import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  CreateTopicCommand,
  DeleteTopicCommand,
  SetSubscriptionAttributesCommand,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

export function createScopedPrefix(runId, label, { prefix = 'mr' } = {}) {
  return `${prefix}-${assertNonEmptyText(runId, 'run id')}-${normalizeLabel(label)}`;
}

export async function createQueue(
  sqsClient,
  {
    name,
    fifo = false,
    visibilityTimeoutSeconds = 2,
    receiveMessageWaitTimeSeconds = 0,
    delaySeconds = 0,
    redrivePolicy,
    redriveAllowPolicy,
    assertLabel = 'AWS',
  },
) {
  const normalizedName = fifo && !name.endsWith('.fifo') ? `${name}.fifo` : name;
  const attributes = {
    VisibilityTimeout: String(visibilityTimeoutSeconds),
    ReceiveMessageWaitTimeSeconds: String(receiveMessageWaitTimeSeconds),
    DelaySeconds: String(delaySeconds),
  };

  if (fifo) {
    attributes.FifoQueue = 'true';
    attributes.ContentBasedDeduplication = 'true';
  }

  if (redrivePolicy) {
    attributes.RedrivePolicy = JSON.stringify(redrivePolicy);
  }

  if (redriveAllowPolicy) {
    attributes.RedriveAllowPolicy = JSON.stringify(redriveAllowPolicy);
  }

  const response = await sqsClient.send(new CreateQueueCommand({ QueueName: normalizedName, Attributes: attributes }));
  assert.equal(typeof response.QueueUrl, 'string', `${assertLabel} must return a queue URL.`);

  const queueUrl = response.QueueUrl;
  const attributeNames = ['QueueArn', 'RedrivePolicy', 'RedriveAllowPolicy'];
  if (fifo) {
    attributeNames.push('FifoQueue');
  }
  const attributesResponse = await sqsClient.send(
    new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: attributeNames }),
  );
  const queueArn = attributesResponse.Attributes?.QueueArn;
  assert.equal(typeof queueArn, 'string', `${assertLabel} must return a queue ARN.`);

  return { name: normalizedName, url: queueUrl, arn: queueArn, fifo };
}

export async function createTopic(
  snsClient,
  { name, fifo = false, contentBasedDeduplication = true, assertLabel = 'AWS' } = {},
) {
  const topicName = assertNonEmptyText(name, 'topic fixture name');
  const normalizedName = fifo && !topicName.endsWith('.fifo') ? `${topicName}.fifo` : topicName;
  const attributes = fifo
    ? { FifoTopic: 'true', ContentBasedDeduplication: contentBasedDeduplication ? 'true' : 'false' }
    : undefined;
  const response = await snsClient.send(new CreateTopicCommand({ Name: normalizedName, Attributes: attributes }));

  assert.equal(typeof response.TopicArn, 'string', `${assertLabel} must return a topic ARN.`);
  return { name: normalizedName, arn: response.TopicArn, fifo };
}

export async function subscribeTopicToQueue(
  snsClient,
  sqsClient,
  { topicArn, queueArn, queueUrl, rawMessageDelivery = true },
) {
  await sqsClient.send(
    new SetQueueAttributesCommand({
      QueueUrl: queueUrl,
      Attributes: {
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: `allow-topic-${randomUUID()}`,
              Effect: 'Allow',
              Principal: '*',
              Action: 'sqs:SendMessage',
              Resource: queueArn,
              Condition: { ArnEquals: { 'aws:SourceArn': topicArn } },
            },
          ],
        }),
      },
    }),
  );

  const response = await snsClient.send(
    new SubscribeCommand({ TopicArn: topicArn, Protocol: 'sqs', Endpoint: queueArn, ReturnSubscriptionArn: true }),
  );
  assert.equal(typeof response.SubscriptionArn, 'string', 'SNS must return a subscription ARN.');

  if (rawMessageDelivery) {
    await snsClient.send(
      new SetSubscriptionAttributesCommand({
        SubscriptionArn: response.SubscriptionArn,
        AttributeName: 'RawMessageDelivery',
        AttributeValue: 'true',
      }),
    );
  }

  return response.SubscriptionArn;
}

export async function cleanupFixtures({ sqs, sns, queues = [], topics = [], label = 'fixture cleanup' }) {
  const cleanupErrors = [];

  for (const topic of [...topics].reverse()) {
    try {
      await sns.send(new DeleteTopicCommand({ TopicArn: topic.arn }));
    } catch (error) {
      if (!isIgnorableCleanupError(error)) {
        cleanupErrors.push(
          new Error(
            `Failed to delete SNS topic ${topic.arn}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }
  }

  for (const queue of [...queues].reverse()) {
    try {
      await sqs.send(new DeleteQueueCommand({ QueueUrl: queue.url }));
    } catch (error) {
      if (!isIgnorableCleanupError(error)) {
        cleanupErrors.push(
          new Error(
            `Failed to delete SQS queue ${queue.url}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `${label} failed.`);
  }
}

function assertNonEmptyText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function normalizeLabel(value) {
  return assertNonEmptyText(value, 'fixture label')
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase();
}

function isIgnorableCleanupError(error) {
  const name = typeof error?.name === 'string' ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);

  return (
    name === 'NotFound' ||
    name === 'QueueDoesNotExist' ||
    message.includes('NonExistentQueue') ||
    message.includes('NotFound') ||
    message.includes('does not exist')
  );
}
