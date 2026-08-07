import type { PublishBatchCommandInput, PublishCommandInput } from '@aws-sdk/client-sns';
import {
  assertNonEmptyBinaryValue,
  assertNonEmptyIdentifier,
  assertNonEmptyText,
  assertPositiveSafeInteger,
  assertRecord,
} from './assertions';
import type {
  PublisherSerializer,
  PublisherSizeValidation,
  PublisherSizeValidationOverride,
  SnsMessageAttributes,
  SnsStructuredJsonMessage,
  SqsMessageAttributes,
} from './types';

export const DEFAULT_SQS_PUBLISH_MAX_BYTES = 1_048_576;
export const DEFAULT_SNS_PUBLISH_MAX_BYTES = 262_144;

export interface PreparedSqsPublishRequest {
  body: string;
  delaySeconds?: number;
  messageAttributes?: SqsMessageAttributes;
  messageGroupId?: string;
  messageDeduplicationId?: string;
}

export interface PreparedSnsPublishRequest {
  message: string;
  messageStructure?: 'json';
  subject?: string;
  messageAttributes?: SnsMessageAttributes;
  messageGroupId?: string;
  messageDeduplicationId?: string;
}

interface NormalizedSizeValidation {
  maxBytes: number;
}

interface AttributeValueLike {
  DataType?: string;
  StringValue?: string;
  BinaryValue?: Uint8Array;
  StringListValues?: string[];
  BinaryListValues?: Uint8Array[];
}

export function serializeJsonPayload<TPayload>(payload: TPayload, label: string): string {
  const serialized = JSON.stringify(payload);
  if (typeof serialized !== 'string') {
    throw new Error(`${label} must serialize to a JSON string.`);
  }
  return serialized;
}

export function serializeWithSerializer<TPayload>(
  payload: TPayload,
  serialize: PublisherSerializer<TPayload>,
  label: string,
): string {
  if (typeof serialize !== 'function') {
    throw new Error(`${label} serialize must be a function.`);
  }

  const serialized = serialize(payload);
  return assertNonEmptyText(serialized, `${label} serialized message`);
}

export function resolveSizeValidation(
  defaults: PublisherSizeValidation | undefined,
  override: PublisherSizeValidationOverride | undefined,
  label: string,
  defaultMaxBytes: number,
): NormalizedSizeValidation | undefined {
  if (override === false) {
    return undefined;
  }

  if (override === undefined && defaults === undefined) {
    return undefined;
  }

  const merged = { ...(defaults ?? {}), ...(override ?? {}) };
  return {
    maxBytes:
      merged.maxBytes === undefined ? defaultMaxBytes : assertPositiveSafeInteger(merged.maxBytes, `${label} maxBytes`),
  };
}

export function validateSqsPublishRequestSize(
  body: string,
  messageAttributes: SqsMessageAttributes | undefined,
  sizeValidation: NormalizedSizeValidation | undefined,
  label: string,
): void {
  if (!sizeValidation) {
    return;
  }

  const sizeBytes = utf8ByteLength(body) + calculateMessageAttributeBytes(messageAttributes);
  assertWithinSizeLimit(sizeBytes, sizeValidation.maxBytes, label);
}

export function validateSnsPublishRequestSize(
  message: string,
  messageAttributes: SnsMessageAttributes | undefined,
  subject: string | undefined,
  sizeValidation: NormalizedSizeValidation | undefined,
  label: string,
): void {
  if (!sizeValidation) {
    return;
  }

  const sizeBytes =
    utf8ByteLength(message) +
    calculateMessageAttributeBytes(messageAttributes) +
    (subject === undefined ? 0 : utf8ByteLength(subject));
  assertWithinSizeLimit(sizeBytes, sizeValidation.maxBytes, label);
}

export function createSnsPublishCommandInput(
  topicArn: string,
  prepared: PreparedSnsPublishRequest,
  options: { includeMessageAttributes: boolean },
): PublishCommandInput {
  return {
    TopicArn: topicArn,
    Message: prepared.message,
    ...(prepared.messageStructure === undefined ? {} : { MessageStructure: prepared.messageStructure }),
    Subject: prepared.subject,
    ...(options.includeMessageAttributes ? { MessageAttributes: prepared.messageAttributes } : {}),
    MessageGroupId: prepared.messageGroupId,
    MessageDeduplicationId: prepared.messageDeduplicationId,
  };
}

export function createSnsPublishBatchRequestEntry(
  id: string,
  prepared: PreparedSnsPublishRequest,
  options: { includeMessageAttributes: boolean },
): NonNullable<PublishBatchCommandInput['PublishBatchRequestEntries']>[number] {
  return {
    Id: id,
    Message: prepared.message,
    ...(prepared.messageStructure === undefined ? {} : { MessageStructure: prepared.messageStructure }),
    Subject: prepared.subject,
    ...(options.includeMessageAttributes ? { MessageAttributes: prepared.messageAttributes } : {}),
    MessageGroupId: prepared.messageGroupId,
    MessageDeduplicationId: prepared.messageDeduplicationId,
  };
}

export function validateSnsPublishEntry(
  entry: {
    subject?: string;
    messageAttributes?: SnsMessageAttributes;
    messageGroupId?: string;
    messageDeduplicationId?: string;
  },
  context: { topicArn: string; label: string; structuredJson: boolean },
): void {
  if (entry.subject !== undefined) {
    assertNonEmptyText(entry.subject, `subject for ${context.label}`);
  }

  if (context.structuredJson && entry.messageAttributes !== undefined) {
    throw new Error(`${context.label} must not declare messageAttributes when MessageStructure is json.`);
  }

  const fifoTopic = context.topicArn.endsWith('.fifo');
  if (fifoTopic) {
    assertNonEmptyText(entry.messageGroupId, `messageGroupId for ${context.label}`);
    if (entry.messageDeduplicationId !== undefined) {
      assertNonEmptyText(entry.messageDeduplicationId, `messageDeduplicationId for ${context.label}`);
    }
    return;
  }

  if (entry.messageGroupId !== undefined) {
    assertNonEmptyText(entry.messageGroupId, `messageGroupId for ${context.label}`);
  }

  if (entry.messageDeduplicationId !== undefined) {
    throw new Error(`${context.label} must not declare messageDeduplicationId for a standard SNS topic.`);
  }
}

export function validateSnsStructuredJsonMessage(message: SnsStructuredJsonMessage, label: string): void {
  const record = assertRecord(message, label);
  if (!('default' in record)) {
    throw new Error(`${label} must define a "default" protocol value.`);
  }

  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string') {
      throw new Error(`${label} protocol value "${key}" must be a string.`);
    }
  }
}

export function readUnsupportedStructuredMessageAttributes(value: unknown): SnsMessageAttributes | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const messageAttributes = (value as { messageAttributes?: SnsMessageAttributes }).messageAttributes;
  return messageAttributes === undefined ? undefined : messageAttributes;
}

function assertWithinSizeLimit(sizeBytes: number, maxBytes: number, label: string): void {
  if (sizeBytes > maxBytes) {
    throw new Error(`${label} exceeds the configured size limit of ${maxBytes} bytes (${sizeBytes} bytes).`);
  }
}

function calculateMessageAttributeBytes(messageAttributes: Record<string, AttributeValueLike> | undefined): number {
  if (!messageAttributes) {
    return 0;
  }

  let total = 0;
  for (const [name, attribute] of Object.entries(messageAttributes)) {
    total += utf8ByteLength(assertNonEmptyIdentifier(name, 'message attribute name'));
    total += calculateMessageAttributeValueBytes(attribute);
  }
  return total;
}

function calculateMessageAttributeValueBytes(attribute: AttributeValueLike): number {
  let total = 0;
  if (typeof attribute.DataType === 'string') {
    total += utf8ByteLength(attribute.DataType);
  }
  if (typeof attribute.StringValue === 'string') {
    total += utf8ByteLength(attribute.StringValue);
  }
  if (attribute.BinaryValue instanceof Uint8Array) {
    total += attribute.BinaryValue.byteLength;
  }
  if (Array.isArray(attribute.StringListValues)) {
    for (const value of attribute.StringListValues) {
      total += utf8ByteLength(assertNonEmptyText(value, 'message attribute StringListValues item'));
    }
  }
  if (Array.isArray(attribute.BinaryListValues)) {
    for (const value of attribute.BinaryListValues) {
      total += assertNonEmptyBinaryValue(value, 'message attribute BinaryListValues item').byteLength;
    }
  }
  return total;
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}
