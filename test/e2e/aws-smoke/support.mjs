import assert from 'node:assert/strict';
import {
  CreateTopicCommand,
  DeleteTopicCommand,
  PublishCommand,
  SetSubscriptionAttributesCommand,
  SNSClient,
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
  SQSClient,
} from '@aws-sdk/client-sqs';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import * as runtime from '../../../dist/index.js';

export const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
export const AWS_PROFILE = process.env.AWS_PROFILE;
export const AWS_SMOKE_RUN_ID = process.env.MESSAGING_RUNTIME_AWS_SMOKE_RUN_ID ?? createFallbackRunId();

const forbiddenEndpointEnvVars = [
  'MESSAGING_RUNTIME_LOCALSTACK_ENDPOINT',
  'AWS_ENDPOINT_URL',
  'AWS_ENDPOINT_URL_SQS',
  'AWS_ENDPOINT_URL_SNS',
];

export function assertLiveAwsSafeEnvironment() {
  for (const envVar of forbiddenEndpointEnvVars) {
    if (process.env[envVar]) {
      throw new Error(`Live AWS smoke rejected because ${envVar} is set.`);
    }
  }

  if (
    process.env.AWS_ACCESS_KEY_ID === 'test' ||
    process.env.AWS_SECRET_ACCESS_KEY === 'test' ||
    process.env.AWS_SESSION_TOKEN === 'test'
  ) {
    throw new Error('Live AWS smoke rejected because the current shell is using test credentials.');
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCondition(
  check,
  { timeoutMs = 20_000, intervalMs = 250, description = 'condition' } = {},
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

export function createFixturePrefix(label) {
  const normalizedLabel = label.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `mr58-${AWS_SMOKE_RUN_ID}-${normalizedLabel}`;
}

export function createAwsConfig() {
  return { region: AWS_REGION };
}

export function createSdkClients() {
  const config = createAwsConfig();
  return { sqs: new SQSClient(config), sns: new SNSClient(config), sts: new STSClient(config) };
}

export async function getCallerIdentity(stsClient) {
  const response = await stsClient.send(new GetCallerIdentityCommand({}));
  assert.equal(typeof response.Account, 'string', 'STS must return an AWS account ID.');
  return { accountId: response.Account, arn: response.Arn, userId: response.UserId };
}

export async function createQueue(
  sqsClient,
  {
    name,
    fifo = false,
    visibilityTimeoutSeconds = 3,
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
  assert.equal(typeof response.QueueUrl, 'string', 'AWS must return a queue URL.');

  const queueUrl = response.QueueUrl;
  const attributeNames = ['QueueArn', 'RedrivePolicy', 'RedriveAllowPolicy'];
  if (fifo) {
    attributeNames.push('FifoQueue');
  }
  const attributesResponse = await sqsClient.send(
    new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: attributeNames }),
  );
  const queueArn = attributesResponse.Attributes?.QueueArn;
  assert.equal(typeof queueArn, 'string', 'AWS must return a queue ARN.');

  return { name: normalizedName, url: queueUrl, arn: queueArn, fifo };
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

export async function createTopic(snsClient, { name, fifo = false, contentBasedDeduplication = true } = {}) {
  const normalizedName = fifo && !name.endsWith('.fifo') ? `${name}.fifo` : name;
  const attributes = fifo
    ? { FifoTopic: 'true', ContentBasedDeduplication: contentBasedDeduplication ? 'true' : 'false' }
    : undefined;
  const response = await snsClient.send(new CreateTopicCommand({ Name: normalizedName, Attributes: attributes }));
  assert.equal(typeof response.TopicArn, 'string', 'AWS must return a topic ARN.');
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
              Sid: `allow-topic-${Date.now().toString(36)}`,
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
  assert.equal(typeof response.SubscriptionArn, 'string', 'AWS must return a subscription ARN.');

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
  { expectedCount = 1, timeoutMs = 20_000, deleteReceived = false, visibilityTimeoutSeconds, waitTimeSeconds = 2 } = {},
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
        VisibilityTimeout: visibilityTimeoutSeconds ?? (deleteReceived ? 30 : undefined),
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
  }

  throw new Error(`Timed out waiting for ${expectedCount} message(s) on ${queueUrl}.`);
}

export async function waitForApproximateVisibleMessageCount(
  sqsClient,
  queueUrl,
  { minCount = 1, timeoutMs = 20_000, intervalMs = 500 } = {},
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

export function parseMessageBody(message) {
  assert.equal(typeof message.Body, 'string', 'Expected a queue message body.');
  return message.Body;
}

export function parseJsonMessageBody(message) {
  return JSON.parse(parseMessageBody(message));
}

export function createStandardRuntimeDefaults(overrides = {}) {
  return { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, errorBackoffMs: 0, ...overrides };
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

export async function cleanupFixtures({ sqs, sns, queues, topics }) {
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
    throw new AggregateError(cleanupErrors, 'Live AWS smoke cleanup failed.');
  }
}

function createFallbackRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
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
