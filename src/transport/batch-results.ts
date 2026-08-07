import type { PublishBatchResultEntry, BatchResultErrorEntry as SnsBatchResultErrorEntry } from '@aws-sdk/client-sns';
import type {
  BatchResultErrorEntry,
  ChangeMessageVisibilityBatchResultEntry,
  DeleteMessageBatchResultEntry,
  SendMessageBatchResultEntry,
} from '@aws-sdk/client-sqs';
import { assertNonEmptyText } from './assertions';
import type {
  SnsPublishJsonBatchSuccess,
  SqsBatchOperationFailure,
  SqsBatchOperationSuccess,
  SqsSendJsonBatchSuccess,
} from './types';

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
