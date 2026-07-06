import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  CreateTopicCommand,
  DeleteTopicCommand,
  PublishCommand,
  SetSubscriptionAttributesCommand,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import * as runtime from '../../../dist/index.js';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCondition(
  check,
  { timeoutMs = 10_000, intervalMs = 200, description = 'condition' } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ''}`,
  );
}

export function createRecordingSqsAdapter(sdkClient) {
  const records = {
    receiveInputs: [],
    deleteInputs: [],
    deleteBatchInputs: [],
    visibilityInputs: [],
    visibilityBatchInputs: [],
  };
  const failReceiveOnceQueueUrls = new Set();
  const failedReceiveQueueUrls = new Set();

  const recordingClient = {
    send: async (command, options) => {
      const commandName = command?.constructor?.name;
      const input = structuredClone(command.input);

      if (commandName === 'ReceiveMessageCommand') {
        records.receiveInputs.push(input);
        if (failReceiveOnceQueueUrls.has(input.QueueUrl) && !failedReceiveQueueUrls.has(input.QueueUrl)) {
          failedReceiveQueueUrls.add(input.QueueUrl);
          throw new Error(`Injected receive failure for ${input.QueueUrl}`);
        }
      } else if (commandName === 'DeleteMessageCommand') {
        records.deleteInputs.push(input);
      } else if (commandName === 'DeleteMessageBatchCommand') {
        records.deleteBatchInputs.push(input);
      } else if (commandName === 'ChangeMessageVisibilityCommand') {
        records.visibilityInputs.push(input);
      } else if (commandName === 'ChangeMessageVisibilityBatchCommand') {
        records.visibilityBatchInputs.push(input);
      }

      return sdkClient.send(command, options);
    },
  };

  return {
    adapter: new runtime.AwsSqsAdapter(recordingClient),
    records,
    failReceiveOnceForQueue(queueUrl) {
      failReceiveOnceQueueUrls.add(queueUrl);
    },
  };
}

export function createRecordingSnsAdapter(sdkClient) {
  const records = { publishInputs: [], publishBatchInputs: [], listTopicsInputs: [] };

  const recordingClient = {
    send: async (command, options) => {
      const commandName = command?.constructor?.name;
      const input = structuredClone(command.input);

      if (commandName === 'PublishCommand') {
        records.publishInputs.push(input);
      } else if (commandName === 'PublishBatchCommand') {
        records.publishBatchInputs.push(input);
      } else if (commandName === 'ListTopicsCommand') {
        records.listTopicsInputs.push(input);
      }

      return sdkClient.send(command, options);
    },
  };

  return { adapter: new runtime.AwsSnsAdapter(recordingClient), records };
}

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

export async function waitForMessages(
  sqsClient,
  queueUrl,
  { expectedCount = 1, timeoutMs = 10_000, deleteReceived = false, visibilityTimeoutSeconds, waitTimeSeconds = 1 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  const messagesById = new Map();

  while (Date.now() < deadline) {
    const remaining = expectedCount - messagesById.size;
    const response = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: Math.min(10, Math.max(1, remaining)),
        WaitTimeSeconds: waitTimeSeconds,
        VisibilityTimeout: visibilityTimeoutSeconds ?? (deleteReceived ? 30 : 0),
        MessageAttributeNames: ['All'],
        MessageSystemAttributeNames: ['All'],
      }),
    );

    for (const message of response.Messages ?? []) {
      if (!message.MessageId) {
        continue;
      }

      if (!messagesById.has(message.MessageId)) {
        messagesById.set(message.MessageId, message);
      }

      if (deleteReceived && message.ReceiptHandle) {
        await sqsClient.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
      }
    }

    if (messagesById.size >= expectedCount) {
      return [...messagesById.values()];
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting for ${expectedCount} message(s) on ${queueUrl}.`);
}

export async function waitForApproximateVisibleMessageCount(
  sqsClient,
  queueUrl,
  { minCount = 1, timeoutMs = 10_000, intervalMs = 250 } = {},
) {
  return waitForCondition(
    async () => {
      const response = await sqsClient.send(
        new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['ApproximateNumberOfMessages'] }),
      );
      const count = Number.parseInt(response.Attributes?.ApproximateNumberOfMessages ?? '0', 10);
      return Number.isFinite(count) && count >= minCount;
    },
    { timeoutMs, intervalMs, description: `approximate visible message count >= ${minCount} on ${queueUrl}` },
  );
}

export async function assertQueueEmpty(sqsClient, queueUrl, { waitTimeSeconds = 1 } = {}) {
  const response = await sqsClient.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: waitTimeSeconds,
      MessageAttributeNames: ['All'],
      MessageSystemAttributeNames: ['All'],
    }),
  );

  assert.equal(response.Messages?.length ?? 0, 0, `Expected queue ${queueUrl} to be empty.`);
}

export async function sendQueueJsonMessage(
  sqsClient,
  queueUrl,
  payload,
  { messageGroupId, messageDeduplicationId, messageAttributes } = {},
) {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(payload),
      MessageAttributes: messageAttributes,
      MessageGroupId: messageGroupId,
      MessageDeduplicationId: messageDeduplicationId,
    }),
  );
}

export async function sendQueueStringMessage(
  sqsClient,
  queueUrl,
  body,
  { messageGroupId, messageDeduplicationId, messageAttributes } = {},
) {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: body,
      MessageAttributes: messageAttributes,
      MessageGroupId: messageGroupId,
      MessageDeduplicationId: messageDeduplicationId,
    }),
  );
}

export async function publishTopicStringMessage(
  snsClient,
  topicArn,
  message,
  { messageGroupId, messageDeduplicationId, messageAttributes, subject } = {},
) {
  await snsClient.send(
    new PublishCommand({
      TopicArn: topicArn,
      Message: message,
      MessageAttributes: messageAttributes,
      MessageGroupId: messageGroupId,
      MessageDeduplicationId: messageDeduplicationId,
      Subject: subject,
    }),
  );
}

export function parseMessageBody(message) {
  assert.equal(typeof message.Body, 'string', 'Expected a queue message body.');
  return message.Body;
}

export function parseJsonMessageBody(message) {
  return JSON.parse(parseMessageBody(message));
}

export function parseSnsEnvelopeMessage(message) {
  return JSON.parse(parseMessageBody(message));
}

export function createStandardRuntimeDefaults(overrides = {}) {
  return { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, errorBackoffMs: 0, ...overrides };
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
