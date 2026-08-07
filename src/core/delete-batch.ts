import type { DeleteMessageBatchCommandInput, DeleteMessageBatchCommandOutput } from '@aws-sdk/client-sqs';
import { DELETE_BATCH_FLUSH_DELAY_MS, DELETE_BATCH_SIZE_LIMIT } from './config';
import type { PendingDeleteEntry, RouteRuntime } from './runtime-state';
import { describeDeleteBatchResponseFailure } from './status';
import type {
  SqsRuntimeClient,
  SqsWorkerLogger,
  SqsWorkerMessage,
  SqsWorkerMessageFinalizationReason,
  SqsWorkerRouteStatus,
  SqsWorkerRuntimeEvent,
} from './types';
import { clearTimer, describeUnknownError } from './utils';

export interface DeleteBatchDependencies {
  client: SqsRuntimeClient;
  logger: SqsWorkerLogger;
  emitRuntimeEvent(status: SqsWorkerRouteStatus, event: SqsWorkerRuntimeEvent): void;
  emitInfrastructureRuntimeEvent(status: SqsWorkerRouteStatus, event: SqsWorkerRuntimeEvent): void;
  isStopping(): boolean;
}

export async function queueDelete<TPayload>(
  runtime: RouteRuntime<TPayload>,
  message: SqsWorkerMessage,
  reason: SqsWorkerMessageFinalizationReason,
  dependencies: DeleteBatchDependencies,
): Promise<void> {
  await new Promise<void>((resolve) => {
    runtime.deleteBatch.entries.push({ message, reason, resolve });
    if (
      dependencies.isStopping() ||
      runtime.status.stopping ||
      (runtime.buffer.length === 0 && runtime.status.inFlight <= 1) ||
      runtime.deleteBatch.entries.length >= DELETE_BATCH_SIZE_LIMIT
    ) {
      void flushPendingDeletes(runtime, dependencies);
      return;
    }

    if (runtime.deleteBatch.flushTimer) {
      return;
    }

    runtime.deleteBatch.flushTimer = setTimeout(() => {
      runtime.deleteBatch.flushTimer = undefined;
      void flushPendingDeletes(runtime, dependencies);
    }, DELETE_BATCH_FLUSH_DELAY_MS);
  });
}

export async function flushPendingDeletes<TPayload>(
  runtime: RouteRuntime<TPayload>,
  dependencies: DeleteBatchDependencies,
): Promise<void> {
  if (runtime.deleteBatch.flushPromise) {
    await runtime.deleteBatch.flushPromise;
    return;
  }

  if (runtime.deleteBatch.entries.length === 0) {
    clearTimer(runtime.deleteBatch.flushTimer);
    runtime.deleteBatch.flushTimer = undefined;
    return;
  }

  clearTimer(runtime.deleteBatch.flushTimer);
  runtime.deleteBatch.flushTimer = undefined;

  const flushPromise = drainPendingDeletes(runtime, dependencies).finally(() => {
    if (runtime.deleteBatch.flushPromise === flushPromise) {
      runtime.deleteBatch.flushPromise = undefined;
    }
    if (runtime.deleteBatch.entries.length > 0) {
      if (
        dependencies.isStopping() ||
        runtime.status.stopping ||
        runtime.deleteBatch.entries.length >= DELETE_BATCH_SIZE_LIMIT
      ) {
        void flushPendingDeletes(runtime, dependencies);
        return;
      }

      runtime.deleteBatch.flushTimer = setTimeout(() => {
        runtime.deleteBatch.flushTimer = undefined;
        void flushPendingDeletes(runtime, dependencies);
      }, DELETE_BATCH_FLUSH_DELAY_MS);
    }
  });

  runtime.deleteBatch.flushPromise = flushPromise;
  await flushPromise;
}

async function drainPendingDeletes<TPayload>(
  runtime: RouteRuntime<TPayload>,
  dependencies: DeleteBatchDependencies,
): Promise<void> {
  while (runtime.deleteBatch.entries.length > 0) {
    const batch = runtime.deleteBatch.entries.splice(0, DELETE_BATCH_SIZE_LIMIT);
    await flushDeleteBatchChunk(runtime, batch, dependencies);
  }
}

async function flushDeleteBatchChunk<TPayload>(
  runtime: RouteRuntime<TPayload>,
  entries: PendingDeleteEntry[],
  dependencies: DeleteBatchDependencies,
): Promise<void> {
  const { route, status } = runtime;
  const entryIdToDelete = new Map<string, PendingDeleteEntry>(
    entries.map((entry, index) => [`delete-${index}`, entry] as const),
  );
  const batchInput: DeleteMessageBatchCommandInput = {
    QueueUrl: route.queueUrl,
    Entries: entries.map((entry, index) => ({ Id: `delete-${index}`, ReceiptHandle: entry.message.receiptHandle })),
  };

  let batchOutput: DeleteMessageBatchCommandOutput | undefined;
  let batchError: unknown;
  try {
    batchOutput = await dependencies.client.deleteMessageBatch(batchInput);
  } catch (error: unknown) {
    batchError = error;
  }

  const failedEntries = new Map<string, PendingDeleteEntry>();

  if (batchError) {
    dependencies.emitInfrastructureRuntimeEvent(status, {
      type: 'delete-batch-failure',
      at: new Date(),
      routeName: route.name,
      queueUrl: route.queueUrl,
      batchSize: entries.length,
      failedCount: entries.length,
      messageIds: entries.map((entry) => entry.message.messageId),
      failureMode: 'request-error',
      error: batchError,
      errorDetail: describeUnknownError(batchError),
    });
    dependencies.logger.warn('SQS worker batched delete failed; retrying messages individually once.', {
      routeName: route.name,
      queueUrl: route.queueUrl,
      batchSize: entries.length,
      error: describeUnknownError(batchError),
    });
    for (const [entryId, entry] of entryIdToDelete.entries()) {
      failedEntries.set(entryId, entry);
    }
  } else {
    const successfulIds = new Set((batchOutput?.Successful ?? []).flatMap((entry) => (entry.Id ? [entry.Id] : [])));
    const failedIds = new Set((batchOutput?.Failed ?? []).flatMap((entry) => (entry.Id ? [entry.Id] : [])));
    const missingIds: string[] = [];

    for (const successfulEntry of batchOutput?.Successful ?? []) {
      const pendingEntry = successfulEntry.Id ? entryIdToDelete.get(successfulEntry.Id) : undefined;
      if (!pendingEntry) {
        continue;
      }

      dependencies.emitRuntimeEvent(status, {
        type: 'message-delete',
        at: new Date(),
        routeName: route.name,
        queueUrl: route.queueUrl,
        messageId: pendingEntry.message.messageId,
        reason: pendingEntry.reason,
      });
      pendingEntry.resolve();
    }

    for (const entryId of failedIds) {
      const pendingEntry = entryIdToDelete.get(entryId);
      if (pendingEntry) {
        failedEntries.set(entryId, pendingEntry);
      }
    }

    for (const [entryId, pendingEntry] of entryIdToDelete.entries()) {
      if (!successfulIds.has(entryId)) {
        if (!failedIds.has(entryId)) {
          missingIds.push(entryId);
        }
        failedEntries.set(entryId, pendingEntry);
      }
    }

    if (failedEntries.size > 0) {
      dependencies.emitInfrastructureRuntimeEvent(status, {
        type: 'delete-batch-failure',
        at: new Date(),
        routeName: route.name,
        queueUrl: route.queueUrl,
        batchSize: entries.length,
        failedCount: failedEntries.size,
        messageIds: [...failedEntries.values()].map((entry) => entry.message.messageId),
        failureMode: 'response-failure',
        errorDetail: describeDeleteBatchResponseFailure(batchOutput, [...failedIds], missingIds),
      });
    }
  }

  if (failedEntries.size === 0) {
    return;
  }

  await Promise.all(
    [...failedEntries.values()].map(async (entry) => {
      try {
        await dependencies.client.deleteMessage({
          QueueUrl: route.queueUrl,
          ReceiptHandle: entry.message.receiptHandle,
        });
        dependencies.emitRuntimeEvent(status, {
          type: 'message-delete',
          at: new Date(),
          routeName: route.name,
          queueUrl: route.queueUrl,
          messageId: entry.message.messageId,
          reason: entry.reason,
        });
      } catch (error: unknown) {
        dependencies.emitInfrastructureRuntimeEvent(status, {
          type: 'message-delete-failure',
          at: new Date(),
          routeName: route.name,
          queueUrl: route.queueUrl,
          messageId: entry.message.messageId,
          reason: entry.reason,
          error,
          errorDetail: describeUnknownError(error),
        });
        dependencies.logger.warn('SQS worker individual delete retry failed after batch delete failure.', {
          routeName: route.name,
          queueUrl: route.queueUrl,
          messageId: entry.message.messageId,
          error: describeUnknownError(error),
        });
      } finally {
        entry.resolve();
      }
    }),
  );
}
