import { BUFFERED_VISIBILITY_EXTENSION_THRESHOLD_RATIO } from './config';
import type { WorkerProcessingDependencies } from './processing';
import type { BufferedRouteMessage, RouteRuntime } from './runtime-state';
import { describeUnknownError } from './utils';

export async function dispatchBufferedMessages<TPayload>(
  runtime: RouteRuntime<TPayload>,
  dependencies: WorkerProcessingDependencies,
): Promise<void> {
  const { route, status } = runtime;

  while (runtime.buffer.length > 0 && status.inFlight < route.config.concurrency) {
    const bufferedMessage = runtime.buffer.shift();
    status.buffered = runtime.buffer.length;
    if (!bufferedMessage) {
      return;
    }

    const ready = await prepareBufferedMessageForDispatch(runtime, bufferedMessage, dependencies);
    if (!ready) {
      continue;
    }

    dependencies.startMessageTask(runtime, bufferedMessage.rawMessage);
  }
}

async function prepareBufferedMessageForDispatch<TPayload>(
  runtime: RouteRuntime<TPayload>,
  bufferedMessage: BufferedRouteMessage,
  dependencies: WorkerProcessingDependencies,
): Promise<boolean> {
  const { route, status } = runtime;
  const visibilityThresholdMs =
    route.config.visibilityTimeoutSeconds * 1_000 * BUFFERED_VISIBILITY_EXTENSION_THRESHOLD_RATIO;
  if (visibilityThresholdMs <= 0) {
    return true;
  }

  const bufferedAgeMs = Date.now() - bufferedMessage.receivedAtMs;
  if (bufferedAgeMs < visibilityThresholdMs) {
    return true;
  }

  if (!bufferedMessage.rawMessage.ReceiptHandle) {
    const error = new Error('Buffered SQS message is missing a ReceiptHandle before dispatch.');
    const errorDetail = describeUnknownError(error);
    dependencies.emitInfrastructureRuntimeEvent(status, {
      type: 'buffered-message-drop',
      at: new Date(),
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: bufferedMessage.rawMessage.MessageId ?? '__missing-message-id__',
      dropReason: 'missing-receipt-handle',
      bufferedAgeMs,
      error,
      errorDetail,
    });
    dependencies.logger.warn('Dropping buffered SQS message before dispatch because the receipt handle is missing.', {
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: bufferedMessage.rawMessage.MessageId,
    });
    return false;
  }

  try {
    await dependencies.client.changeMessageVisibility({
      QueueUrl: route.queueUrl,
      ReceiptHandle: bufferedMessage.rawMessage.ReceiptHandle,
      VisibilityTimeout: route.config.visibilityTimeoutSeconds,
    });
    return true;
  } catch (error: unknown) {
    const errorDetail = describeUnknownError(error);
    dependencies.emitInfrastructureRuntimeEvent(status, {
      type: 'pre-dispatch-visibility-failure',
      at: new Date(),
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: bufferedMessage.rawMessage.MessageId ?? '__missing-message-id__',
      bufferedAgeMs,
      error,
      errorDetail,
    });
    dependencies.emitInfrastructureRuntimeEvent(status, {
      type: 'buffered-message-drop',
      at: new Date(),
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: bufferedMessage.rawMessage.MessageId ?? '__missing-message-id__',
      dropReason: 'pre-dispatch-visibility-failure',
      bufferedAgeMs,
      error,
      errorDetail,
    });
    dependencies.logger.warn('Dropping buffered SQS message after a pre-dispatch visibility extension failure.', {
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: bufferedMessage.rawMessage.MessageId,
      error: errorDetail,
    });
    return false;
  }
}
