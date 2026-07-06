import type {
  PublishBatchCommandInput,
  PublishBatchResultEntry,
  PublishCommandInput,
  BatchResultErrorEntry as SnsBatchResultErrorEntry,
} from '@aws-sdk/client-sns';
import type {
  BatchResultErrorEntry,
  ChangeMessageVisibilityBatchResultEntry,
  DeleteMessageBatchResultEntry,
  SendMessageBatchResultEntry,
} from '@aws-sdk/client-sqs';
import type {
  PublisherSerializer,
  PublisherSizeValidation,
  PublisherSizeValidationOverride,
  SnsEnvelopeType,
  SnsMessageAttributes,
  SnsPublishJsonBatchSuccess,
  SnsStructuredJsonMessage,
  SqsBatchOperationFailure,
  SqsBatchOperationSuccess,
  SqsMessageAttributes,
  SqsQueueResolutionInput,
  SqsSendJsonBatchSuccess,
} from './types';

export const SQS_ARN_SERVICE = 'sqs';
export const SNS_ARN_SERVICE = 'sns';
export const DEFAULT_SQS_JSON_LABEL = 'SQS message body';
export const DEFAULT_SNS_ENVELOPE_LABEL = 'SNS envelope body';
export const DEFAULT_SNS_NOTIFICATION_LABEL = 'SNS notification message';
const DEFAULT_SQS_QUEUE_DISCOVERY_PAGE_SIZE = 1_000;
const MAX_SQS_QUEUE_DISCOVERY_PAGE_SIZE = 1_000;
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

interface NormalizedSqsQueueResolutionInput {
  queueIdentifier: string;
  identifierCacheKey: string;
  queueName: string;
  queueNameCacheKey: string;
  ownerAccountId?: string;
  cacheUnnamedQueueName: boolean;
  directQueueUrl?: string;
}

export function normalizeSqsQueueResolutionInput(
  input: string | SqsQueueResolutionInput,
): NormalizedSqsQueueResolutionInput {
  if (typeof input === 'string') {
    const queueIdentifier = assertNonEmptyIdentifier(input, 'SQS queue identifier');
    if (isHttpUrl(queueIdentifier)) {
      const queueName = extractNameFromUrl(queueIdentifier, 'SQS queue URL');
      return {
        queueIdentifier,
        identifierCacheKey: queueIdentifier,
        queueName,
        queueNameCacheKey: createSqsQueueNameCacheKey(queueName, extractAccountIdFromSqsQueueUrl(queueIdentifier)),
        cacheUnnamedQueueName: false,
        directQueueUrl: queueIdentifier,
      };
    }

    if (isArnForService(queueIdentifier, SQS_ARN_SERVICE)) {
      const queueName = extractNameFromArn(queueIdentifier, SQS_ARN_SERVICE, 'SQS queue ARN');
      const ownerAccountId = extractAccountIdFromArn(queueIdentifier, SQS_ARN_SERVICE, 'SQS queue ARN');
      return {
        queueIdentifier,
        identifierCacheKey: queueIdentifier,
        queueName,
        queueNameCacheKey: createSqsQueueNameCacheKey(queueName, ownerAccountId),
        ownerAccountId,
        cacheUnnamedQueueName: false,
      };
    }

    return {
      queueIdentifier,
      identifierCacheKey: queueIdentifier,
      queueName: queueIdentifier,
      queueNameCacheKey: createSqsQueueNameCacheKey(queueIdentifier),
      cacheUnnamedQueueName: true,
    };
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('SQS queue resolution input must be a string or object.');
  }

  const queueIdentifier = assertNonEmptyIdentifier(input.queue, 'SQS queue identifier');
  const ownerAccountId =
    input.ownerAccountId === undefined
      ? undefined
      : assertAwsAccountId(input.ownerAccountId, 'SQS queue owner account ID');

  if (isHttpUrl(queueIdentifier)) {
    if (ownerAccountId !== undefined) {
      throw new Error('SQS queue owner account ID is only supported when resolving a queue by name.');
    }

    const queueName = extractNameFromUrl(queueIdentifier, 'SQS queue URL');
    return {
      queueIdentifier,
      identifierCacheKey: queueIdentifier,
      queueName,
      queueNameCacheKey: createSqsQueueNameCacheKey(queueName, extractAccountIdFromSqsQueueUrl(queueIdentifier)),
      cacheUnnamedQueueName: false,
      directQueueUrl: queueIdentifier,
    };
  }

  if (isArnForService(queueIdentifier, SQS_ARN_SERVICE)) {
    if (ownerAccountId !== undefined) {
      throw new Error('SQS queue owner account ID is only supported when resolving a queue by name.');
    }

    const queueName = extractNameFromArn(queueIdentifier, SQS_ARN_SERVICE, 'SQS queue ARN');
    const derivedOwnerAccountId = extractAccountIdFromArn(queueIdentifier, SQS_ARN_SERVICE, 'SQS queue ARN');
    return {
      queueIdentifier,
      identifierCacheKey: queueIdentifier,
      queueName,
      queueNameCacheKey: createSqsQueueNameCacheKey(queueName, derivedOwnerAccountId),
      ownerAccountId: derivedOwnerAccountId,
      cacheUnnamedQueueName: false,
    };
  }

  return {
    queueIdentifier,
    identifierCacheKey: createSqsQueueResolutionKey(queueIdentifier, ownerAccountId),
    queueName: queueIdentifier,
    queueNameCacheKey: createSqsQueueNameCacheKey(queueIdentifier, ownerAccountId),
    ownerAccountId,
    cacheUnnamedQueueName: ownerAccountId === undefined,
  };
}

export function createSqsQueueResolutionKey(queueName: string, ownerAccountId?: string): string {
  return ownerAccountId ? `${ownerAccountId}:${queueName}` : queueName;
}

export function createSqsQueueNameCacheKey(queueName: string, ownerAccountId?: string): string {
  return ownerAccountId ? `${ownerAccountId}:${queueName}` : queueName;
}

export function normalizeSqsQueueDiscoveryPageSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SQS_QUEUE_DISCOVERY_PAGE_SIZE;
  }

  return assertIntegerInRange(value, 'SQS queue discovery pageSize', 1, MAX_SQS_QUEUE_DISCOVERY_PAGE_SIZE);
}

export function assertAwsAccountId(value: string, label: string): string {
  const normalized = assertNonEmptyIdentifier(value, label);
  if (!/^\d{12}$/.test(normalized)) {
    throw new Error(`${label} must be a 12-digit AWS account ID.`);
  }
  return normalized;
}

export function assertNonEmptyIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return normalized;
}

export function assertNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

export function readOptionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return assertNonEmptyText(value, label);
}

export function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must decode to a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function assertSnsEnvelopeType(value: unknown, label: string): SnsEnvelopeType {
  switch (value) {
    case 'Notification':
    case 'SubscriptionConfirmation':
    case 'UnsubscribeConfirmation':
      return value;
    default:
      throw new Error(`${label} Type must be Notification, SubscriptionConfirmation, or UnsubscribeConfirmation.`);
  }
}

export function isArnForService(value: string, service: string): boolean {
  const parts = value.split(':');
  return parts.length >= 6 && parts[0] === 'arn' && parts[2] === service;
}

export function extractNameFromArn(arn: string, service: string, label: string): string {
  if (!isArnForService(arn, service)) {
    throw new Error(`${label} must be a valid ${service.toUpperCase()} ARN.`);
  }

  const resource = arn.split(':').slice(5).join(':');
  const resourceName = resource.split(/[/:]/).filter(Boolean).at(-1);
  if (!resourceName) {
    throw new Error(`${label} must include a resource name.`);
  }
  return resourceName;
}

export function extractAccountIdFromArn(arn: string, service: string, label: string): string {
  if (!isArnForService(arn, service)) {
    throw new Error(`${label} must be a valid ${service.toUpperCase()} ARN.`);
  }

  const accountId = arn.split(':')[4];
  return assertAwsAccountId(accountId ?? '', `${label} account ID`);
}

export function isHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://');
}

export function assertSqsQueueUrl(value: string, label: string): string {
  const normalized = assertNonEmptyIdentifier(value, label);
  if (!isHttpUrl(normalized)) {
    throw new Error(`${label} must be an SQS queue URL.`);
  }
  return normalized;
}

export function assertSnsTopicArn(value: string, label: string): string {
  const normalized = assertNonEmptyIdentifier(value, label);
  if (!isArnForService(normalized, SNS_ARN_SERVICE)) {
    throw new Error(`${label} must be an SNS topic ARN.`);
  }
  return normalized;
}

export function extractNameFromUrl(value: string, label: string): string {
  try {
    const url = new URL(value);
    const name = url.pathname.split('/').filter(Boolean).at(-1);
    if (!name) {
      throw new Error(`${label} must include a queue name in the path.`);
    }
    return name;
  } catch (error) {
    throw new Error(`Invalid ${label}.`, { cause: error });
  }
}

export function extractAccountIdFromSqsQueueUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const accountId = pathSegments.at(-2);
    if (!accountId || !/^\d{12}$/.test(accountId)) {
      return undefined;
    }

    return accountId;
  } catch {
    return undefined;
  }
}

export function assertUniqueBatchEntryIds<TId extends string>(entries: Array<{ id: TId }>, label: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const identifier = assertNonEmptyText(entry.id, label);
    if (seen.has(identifier)) {
      throw new Error(`Duplicate ${label} "${identifier}" is not allowed.`);
    }
    seen.add(identifier);
  }
}

export function createInternalBatchEntryId(offset: number, index: number): string {
  return `entry-${offset + index}`;
}

export function recordSuccessfulBatchEntries<TId extends string>(
  internalIdMap: Map<string, TId>,
  successfulEntries: SendMessageBatchResultEntry[],
  successfulById: Record<string, SqsSendJsonBatchSuccess<TId>>,
): void {
  for (const entry of successfulEntries) {
    if (!entry.Id) {
      continue;
    }

    const callerId = internalIdMap.get(entry.Id);
    if (!callerId) {
      continue;
    }

    successfulById[callerId] = {
      id: callerId,
      messageId: entry.MessageId,
      sequenceNumber: entry.SequenceNumber,
      md5OfMessageBody: entry.MD5OfMessageBody,
      md5OfMessageAttributes: entry.MD5OfMessageAttributes,
      md5OfMessageSystemAttributes: entry.MD5OfMessageSystemAttributes,
    };
  }
}

export function recordSimpleSuccessfulBatchEntries<TId extends string>(
  internalIdMap: Map<string, TId>,
  successfulEntries: Array<DeleteMessageBatchResultEntry | ChangeMessageVisibilityBatchResultEntry>,
  successfulById: Record<string, SqsBatchOperationSuccess<TId>>,
): void {
  for (const entry of successfulEntries) {
    if (!entry.Id) {
      continue;
    }

    const callerId = internalIdMap.get(entry.Id);
    if (!callerId) {
      continue;
    }

    successfulById[callerId] = { id: callerId };
  }
}

export function recordFailedBatchEntries<TId extends string>(
  internalIdMap: Map<string, TId>,
  failedEntries: Array<BatchResultErrorEntry | SnsBatchResultErrorEntry>,
  failedById: Record<string, { id: TId; code?: string; message?: string; senderFault?: boolean }>,
): void {
  for (const entry of failedEntries) {
    if (!entry.Id) {
      continue;
    }

    const callerId = internalIdMap.get(entry.Id);
    if (!callerId) {
      continue;
    }

    failedById[callerId] = { id: callerId, code: entry.Code, message: entry.Message, senderFault: entry.SenderFault };
  }
}

export function recordSnsPublishSuccessfulBatchEntries<TId extends string>(
  internalIdMap: Map<string, TId>,
  successfulEntries: PublishBatchResultEntry[],
  successfulById: Record<string, SnsPublishJsonBatchSuccess<TId>>,
): void {
  for (const entry of successfulEntries) {
    if (!entry.Id) {
      continue;
    }

    const callerId = internalIdMap.get(entry.Id);
    if (!callerId) {
      continue;
    }

    successfulById[callerId] = { id: callerId, messageId: entry.MessageId, sequenceNumber: entry.SequenceNumber };
  }
}

export function createSimpleBatchResult<TId extends string>(
  queueUrl: string,
  requestedCount: number,
  successfulById: Record<string, SqsBatchOperationSuccess<TId>>,
  failedById: Record<string, SqsBatchOperationFailure<TId>>,
): {
  queueUrl: string;
  requestedCount: number;
  successfulCount: number;
  failedCount: number;
  successfulById: Record<string, SqsBatchOperationSuccess<TId>>;
  failedById: Record<string, SqsBatchOperationFailure<TId>>;
} {
  return {
    queueUrl,
    requestedCount,
    successfulCount: Object.keys(successfulById).length,
    failedCount: Object.keys(failedById).length,
    successfulById,
    failedById,
  };
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

export function normalizeNumericAttributeValue(value: number | bigint | string, label: string): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be a finite number.`);
    }
    return value.toString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  const normalized = assertNonEmptyText(value, label);
  if (!/^[+-]?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
    throw new Error(`${label} must be a numeric string.`);
  }
  return normalized;
}

export function assertNonEmptyBinaryValue(value: Uint8Array, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error(`${label} must be a non-empty Uint8Array.`);
  }
  return value;
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

export function assertIntegerInRange(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

function assertPositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }

  return value;
}

interface AttributeValueLike {
  DataType?: string;
  StringValue?: string;
  BinaryValue?: Uint8Array;
  StringListValues?: string[];
  BinaryListValues?: Uint8Array[];
}
