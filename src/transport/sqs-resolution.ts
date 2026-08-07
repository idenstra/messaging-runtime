import { assertAwsAccountId, assertIntegerInRange, assertNonEmptyIdentifier } from './assertions';
import {
  extractAccountIdFromArn,
  extractAccountIdFromSqsQueueUrl,
  extractNameFromArn,
  extractNameFromUrl,
  isArnForService,
  isHttpUrl,
  SQS_ARN_SERVICE,
} from './identifiers';
import type { SqsQueueResolutionInput } from './types';

const DEFAULT_SQS_QUEUE_DISCOVERY_PAGE_SIZE = 1_000;
const MAX_SQS_QUEUE_DISCOVERY_PAGE_SIZE = 1_000;

export interface NormalizedSqsQueueResolutionInput {
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
