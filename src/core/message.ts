import type { Message as SqsSdkMessage } from '@aws-sdk/client-sqs';
import type { SqsWorkerMessage, SqsWorkerMessageSystemAttributes } from './types';

export function toWorkerMessage(message: SqsSdkMessage): SqsWorkerMessage {
  if (!message.MessageId || !message.ReceiptHandle) {
    throw new Error('SQS message is missing MessageId or ReceiptHandle.');
  }

  const attributes = message.Attributes ?? {};

  return {
    messageId: message.MessageId,
    receiptHandle: message.ReceiptHandle,
    body: message.Body,
    attributes,
    systemAttributes: normalizeWorkerMessageSystemAttributes(attributes),
    messageAttributes: Object.fromEntries(
      Object.entries(message.MessageAttributes ?? {}).map(([key, value]) => [
        key,
        {
          stringValue: value.StringValue,
          binaryValue: value.BinaryValue,
          stringListValues: value.StringListValues,
          binaryListValues: value.BinaryListValues,
          dataType: value.DataType,
        },
      ]),
    ),
    raw: message,
  };
}

export function defaultDecodePayload<TPayload>(message: SqsWorkerMessage): TPayload {
  if (message.body === undefined) {
    throw new Error('SQS message is missing a body.');
  }

  return JSON.parse(message.body) as TPayload;
}

function normalizeWorkerMessageSystemAttributes(
  attributes: Record<string, string>,
): Partial<SqsWorkerMessageSystemAttributes> {
  const systemAttributes: Partial<SqsWorkerMessageSystemAttributes> = {};

  if (attributes.ApproximateReceiveCount !== undefined) {
    systemAttributes.ApproximateReceiveCount = parseWorkerMessageIntegerSystemAttribute(
      'ApproximateReceiveCount',
      attributes.ApproximateReceiveCount,
    );
  }

  if (attributes.ApproximateFirstReceiveTimestamp !== undefined) {
    systemAttributes.ApproximateFirstReceiveTimestamp = parseWorkerMessageTimestampSystemAttribute(
      'ApproximateFirstReceiveTimestamp',
      attributes.ApproximateFirstReceiveTimestamp,
    );
  }

  if (attributes.SentTimestamp !== undefined) {
    systemAttributes.SentTimestamp = parseWorkerMessageTimestampSystemAttribute(
      'SentTimestamp',
      attributes.SentTimestamp,
    );
  }

  for (const attributeName of [
    'SenderId',
    'MessageGroupId',
    'MessageDeduplicationId',
    'SequenceNumber',
    'AWSTraceHeader',
    'DeadLetterQueueSourceArn',
  ] as const) {
    const attributeValue = attributes[attributeName];
    if (attributeValue === undefined) {
      continue;
    }

    systemAttributes[attributeName] = parseWorkerMessageNonEmptyStringSystemAttribute(attributeName, attributeValue);
  }

  return systemAttributes;
}

function parseWorkerMessageIntegerSystemAttribute(attributeName: string, value: string): number {
  if (!isStrictNonNegativeIntegerLiteral(value)) {
    throw new Error(
      `SQS message system attribute ${attributeName} must be a valid integer, got ${JSON.stringify(value)}.`,
    );
  }

  return Number(value);
}

function parseWorkerMessageTimestampSystemAttribute(attributeName: string, value: string): Date {
  if (!isStrictNonNegativeIntegerLiteral(value)) {
    throw new Error(
      `SQS message system attribute ${attributeName} must be a valid epoch-millisecond integer, got ${JSON.stringify(value)}.`,
    );
  }

  const parsedEpochMs = Number(value);
  const parsedDate = new Date(parsedEpochMs);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(
      `SQS message system attribute ${attributeName} must be a valid date, got ${JSON.stringify(value)}.`,
    );
  }

  return parsedDate;
}

function parseWorkerMessageNonEmptyStringSystemAttribute(attributeName: string, value: string): string {
  if (!value) {
    throw new Error(`SQS message system attribute ${attributeName} must be a non-empty string when present.`);
  }

  return value;
}

function isStrictNonNegativeIntegerLiteral(value: string): boolean {
  return /^(0|[1-9]\d*)$/.test(value);
}
