import type { QueueAttributeName } from '@aws-sdk/client-sqs';
import type {
  SqsQueueAttributesMap,
  SqsQueueDescription,
  SqsQueueRedriveAllowPolicy,
  SqsQueueRedrivePolicy,
} from './types';

const SQS_ARN_SERVICE = 'sqs';
const DEFAULT_DEAD_LETTER_SOURCE_PAGE_SIZE = 1_000;
const MAX_DEAD_LETTER_SOURCE_PAGE_SIZE = 1_000;
const DEFAULT_MOVE_TASK_RESULT_LIMIT = 10;
const MAX_MOVE_TASK_RESULT_LIMIT = 10;
const MAX_MESSAGES_PER_SECOND = 500;
const QUEUE_INSPECTION_ATTRIBUTE_NAMES: QueueAttributeName[] = [
  'QueueArn',
  'ApproximateNumberOfMessages',
  'ApproximateNumberOfMessagesNotVisible',
  'ApproximateNumberOfMessagesDelayed',
  'VisibilityTimeout',
  'MessageRetentionPeriod',
  'ReceiveMessageWaitTimeSeconds',
  'DelaySeconds',
  'RedrivePolicy',
  'RedriveAllowPolicy',
];

export function buildQueueDescription(input: {
  queueIdentifier: string;
  queueUrl: string;
  attributes: SqsQueueAttributesMap;
}): SqsQueueDescription {
  const queueArn = readOptionalNonEmptyText(input.attributes.QueueArn, 'SQS queue QueueArn attribute');
  const queueName = queueArn
    ? extractNameFromArn(queueArn, SQS_ARN_SERVICE, 'SQS queue ARN')
    : extractNameFromUrl(input.queueUrl, 'SQS queue URL');

  return {
    queueIdentifier: input.queueIdentifier,
    queueName,
    queueUrl: input.queueUrl,
    queueArn,
    fifo: readOptionalBooleanAttribute(input.attributes, 'FifoQueue') ?? queueName.endsWith('.fifo'),
    approximateNumberOfMessages: readOptionalIntegerAttribute(input.attributes, 'ApproximateNumberOfMessages'),
    approximateNumberOfMessagesNotVisible: readOptionalIntegerAttribute(
      input.attributes,
      'ApproximateNumberOfMessagesNotVisible',
    ),
    approximateNumberOfMessagesDelayed: readOptionalIntegerAttribute(
      input.attributes,
      'ApproximateNumberOfMessagesDelayed',
    ),
    visibilityTimeoutSeconds: readOptionalIntegerAttribute(input.attributes, 'VisibilityTimeout'),
    messageRetentionSeconds: readOptionalIntegerAttribute(input.attributes, 'MessageRetentionPeriod'),
    receiveMessageWaitTimeSeconds: readOptionalIntegerAttribute(input.attributes, 'ReceiveMessageWaitTimeSeconds'),
    delaySeconds: readOptionalIntegerAttribute(input.attributes, 'DelaySeconds'),
    redrivePolicy: parseRedrivePolicy(input.attributes.RedrivePolicy),
    redriveAllowPolicy: parseRedriveAllowPolicy(input.attributes.RedriveAllowPolicy),
    attributes: input.attributes,
  };
}

export function buildQueueInspectionAttributeNames(queueUrl: string): QueueAttributeName[] {
  const attributeNames = [...QUEUE_INSPECTION_ATTRIBUTE_NAMES];
  const queueName = extractNameFromUrl(queueUrl, 'SQS queue URL');
  if (queueName.endsWith('.fifo')) {
    attributeNames.push('FifoQueue');
  }
  return attributeNames;
}

export function normalizeDeadLetterSourcePageSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_DEAD_LETTER_SOURCE_PAGE_SIZE;
  }

  return assertIntegerInRange(value, 'SQS dead-letter source queue page size', 1, MAX_DEAD_LETTER_SOURCE_PAGE_SIZE);
}

export function normalizeMoveTaskResultLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MOVE_TASK_RESULT_LIMIT;
  }

  return assertIntegerInRange(value, 'SQS message move task maxResults', 1, MAX_MOVE_TASK_RESULT_LIMIT);
}

export function normalizeMaxMessagesPerSecond(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return assertIntegerInRange(value, 'SQS message move maxMessagesPerSecond', 1, MAX_MESSAGES_PER_SECOND);
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

export function readOptionalNonEmptyText(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return assertNonEmptyText(value, label);
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

export function extractNameFromUrl(url: string, label: string): string {
  const normalizedUrl = assertNonEmptyText(url, label);
  if (!normalizedUrl.startsWith('https://') && !normalizedUrl.startsWith('http://')) {
    throw new Error(`${label} must be an HTTP(S) URL.`);
  }

  const pathname = new URL(normalizedUrl).pathname;
  const queueName = pathname.split('/').filter(Boolean).at(-1);
  if (!queueName) {
    throw new Error(`${label} must include a queue name path segment.`);
  }

  return queueName;
}

export function parseRedrivePolicy(value: string | undefined): SqsQueueRedrivePolicy | undefined {
  if (value === undefined) {
    return undefined;
  }

  const raw = parseJsonObject(value, 'SQS queue RedrivePolicy attribute');
  const deadLetterTargetArn = readOptionalNonEmptyText(
    raw.deadLetterTargetArn,
    'SQS RedrivePolicy deadLetterTargetArn',
  );
  const maxReceiveCount = readOptionalIntegerLike(raw.maxReceiveCount, 'SQS RedrivePolicy maxReceiveCount');

  return { deadLetterTargetArn, maxReceiveCount, raw };
}

export function parseRedriveAllowPolicy(value: string | undefined): SqsQueueRedriveAllowPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }

  const raw = parseJsonObject(value, 'SQS queue RedriveAllowPolicy attribute');
  const redrivePermission = readOptionalNonEmptyText(raw.redrivePermission, 'SQS RedriveAllowPolicy redrivePermission');
  const sourceQueueArns =
    raw.sourceQueueArns === undefined
      ? undefined
      : assertStringArray(raw.sourceQueueArns, 'SQS RedriveAllowPolicy sourceQueueArns');

  return { redrivePermission, sourceQueueArns, raw };
}

function assertIntegerInRange(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

function readOptionalIntegerAttribute(
  attributes: SqsQueueAttributesMap,
  attributeName: QueueAttributeName,
): number | undefined {
  const value = attributes[attributeName];
  if (value === undefined) {
    return undefined;
  }

  return parseBaseTenInteger(value, `SQS queue ${attributeName} attribute`);
}

function readOptionalBooleanAttribute(
  attributes: SqsQueueAttributesMap,
  attributeName: QueueAttributeName,
): boolean | undefined {
  const value = attributes[attributeName];
  if (value === undefined) {
    return undefined;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`SQS queue ${attributeName} attribute must be "true" or "false".`);
}

function readOptionalIntegerLike(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return assertIntegerValue(value, label);
  }

  if (typeof value === 'string') {
    return parseBaseTenInteger(value, label);
  }

  throw new Error(`${label} must be a number or a base-10 integer string.`);
}

function parseBaseTenInteger(value: string, label: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`${label} must be a base-10 integer string.`);
  }

  return assertIntegerValue(Number.parseInt(value, 10), label);
}

function assertIntegerValue(value: number, label: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`);
  }

  return value;
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const raw = assertNonEmptyText(value, label);

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must decode to a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message.includes('must decode to a JSON object')) {
      throw error;
    }

    throw new Error(`Invalid ${label} JSON.`, { cause: error });
  }
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return value.map((entry, index) => assertNonEmptyText(entry, `${label}[${index}]`));
}

function isArnForService(value: string, service: string): boolean {
  const parts = value.split(':');
  return parts.length >= 6 && parts[0] === 'arn' && parts[2] === service;
}
