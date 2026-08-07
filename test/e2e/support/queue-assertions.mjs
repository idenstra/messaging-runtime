import assert from 'node:assert/strict';
import { PublishCommand } from '@aws-sdk/client-sns';
import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { sleep, waitForCondition } from './timing.mjs';

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
