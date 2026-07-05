import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  CreateTopicCommand,
  PublishCommand,
  SetSubscriptionAttributesCommand,
  SNSClient,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import * as runtime from '../../../dist/index.js';

export const LOCALSTACK_ENDPOINT = process.env.MESSAGING_RUNTIME_LOCALSTACK_ENDPOINT ?? 'http://127.0.0.1:4566';
export const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
export const AWS_ACCOUNT_ID = '000000000000';
const RUN_ID = process.env.MESSAGING_RUNTIME_LOCALSTACK_RUN_ID ?? 'manual';

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

export function createSuitePrefix(suite) {
  const normalizedSuite = suite.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `mr-${RUN_ID}-${normalizedSuite}`;
}

export function createAwsConfig() {
  return {
    region: AWS_REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
  };
}

export function createSdkClients() {
  const config = createAwsConfig();
  return { sqs: new SQSClient(config), sns: new SNSClient(config) };
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

  const wrapper = {
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
    adapter: new runtime.AwsSqsAdapter(wrapper),
    records,
    failReceiveOnceForQueue(queueUrl) {
      failReceiveOnceQueueUrls.add(queueUrl);
    },
  };
}

export function createRecordingSnsAdapter(sdkClient) {
  const records = { publishInputs: [], publishBatchInputs: [], listTopicsInputs: [] };

  const wrapper = {
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

  return { adapter: new runtime.AwsSnsAdapter(wrapper), records };
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
  assert.equal(typeof response.QueueUrl, 'string', 'LocalStack must return a queue URL.');

  const queueUrl = response.QueueUrl;
  const attributesResponse = await sqsClient.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['QueueArn', 'RedrivePolicy', 'RedriveAllowPolicy', 'FifoQueue'],
    }),
  );
  const queueArn = attributesResponse.Attributes?.QueueArn;
  assert.equal(typeof queueArn, 'string', 'LocalStack must return a queue ARN.');

  return { name: normalizedName, url: queueUrl, arn: queueArn, fifo };
}

export async function createTopic(snsClient, { name, fifo = false, contentBasedDeduplication = true } = {}) {
  const topicName = assertNonEmptyText(name, 'LocalStack topic fixture name');
  const normalizedName = fifo && !topicName.endsWith('.fifo') ? `${topicName}.fifo` : topicName;
  const attributes = fifo
    ? { FifoTopic: 'true', ContentBasedDeduplication: contentBasedDeduplication ? 'true' : 'false' }
    : undefined;
  const response = await snsClient.send(new CreateTopicCommand({ Name: normalizedName, Attributes: attributes }));

  assert.equal(typeof response.TopicArn, 'string', 'LocalStack must return a topic ARN.');
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
  assert.equal(typeof response.SubscriptionArn, 'string', 'LocalStack must return a subscription ARN.');

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

export async function waitForMessages(
  sqsClient,
  queueUrl,
  { expectedCount = 1, timeoutMs = 10_000, deleteReceived = false, visibilityTimeoutSeconds, waitTimeSeconds = 1 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  const messagesById = new Map();

  while (Date.now() < deadline) {
    const response = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: Math.min(10, Math.max(1, expectedCount)),
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

function assertNonEmptyText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}
