import { SqsQueueUrlResolver, type SqsQueueUrlResolverClient } from '../transport';
import { SqsQueueInspector } from './inspector';
import {
  assertNonEmptyIdentifier,
  assertNonEmptyText,
  normalizeMaxMessagesPerSecond,
  normalizeMoveTaskResultLimit,
} from './shared';
import type {
  CancelSqsDlqRedriveInput,
  CancelSqsDlqRedriveResult,
  ListSqsDlqRedriveTasksInput,
  ListSqsDlqRedriveTasksResult,
  SqsQueueDescription,
  SqsQueueOperationsClient,
  StartSqsDlqRedriveInput,
  StartSqsDlqRedriveResult,
} from './types';

export interface SqsDlqRedriveManagerOptions {
  queueResolver?: SqsQueueUrlResolver;
  queueInspector?: SqsQueueInspector;
}

export class SqsDlqRedriveManager {
  private readonly inspector: SqsQueueInspector;

  constructor(
    private readonly client: SqsQueueOperationsClient & SqsQueueUrlResolverClient,
    options: SqsDlqRedriveManagerOptions = {},
  ) {
    this.inspector = options.queueInspector ?? new SqsQueueInspector(client, { queueResolver: options.queueResolver });
  }

  async listRedriveTasks(input: ListSqsDlqRedriveTasksInput): Promise<ListSqsDlqRedriveTasksResult> {
    const sourceQueue = await this.inspectQueueWithArn(input.sourceQueue, 'source queue');
    const response = await this.client.listMessageMoveTasks({
      SourceArn: sourceQueue.queueArn,
      MaxResults: normalizeMoveTaskResultLimit(input.maxResults),
    });

    return {
      sourceQueueIdentifier: sourceQueue.queueIdentifier,
      sourceQueueUrl: sourceQueue.queueUrl,
      sourceQueueArn: sourceQueue.queueArn,
      tasks: (response.Results ?? []).map((task) => ({
        taskHandle: task.TaskHandle,
        status: task.Status,
        sourceArn: task.SourceArn,
        destinationArn: task.DestinationArn,
        maxMessagesPerSecond: task.MaxNumberOfMessagesPerSecond,
        approximateNumberOfMessagesMoved: task.ApproximateNumberOfMessagesMoved,
        approximateNumberOfMessagesToMove: task.ApproximateNumberOfMessagesToMove,
        failureReason: task.FailureReason,
        startedTimestamp: task.StartedTimestamp,
      })),
    };
  }

  async startRedrive(input: StartSqsDlqRedriveInput): Promise<StartSqsDlqRedriveResult> {
    const maxMessagesPerSecond = normalizeMaxMessagesPerSecond(input.maxMessagesPerSecond);
    const sourceQueue = await this.inspectQueueWithArn(input.sourceQueue, 'source queue');
    const runningTasks = await this.listRedriveTasks({ sourceQueue: sourceQueue.queueUrl });
    if (runningTasks.tasks.some((task) => task.status === 'RUNNING')) {
      throw new Error(`SQS queue "${sourceQueue.queueIdentifier}" already has a RUNNING message move task.`);
    }

    let destinationQueue: SqsQueueDescription | undefined;
    if (input.destinationQueue !== undefined) {
      destinationQueue = await this.inspectQueueWithArn(input.destinationQueue, 'destination queue');
      if (destinationQueue.queueArn === sourceQueue.queueArn) {
        throw new Error('SQS source and destination queues for DLQ redrive must not be the same queue.');
      }
    } else {
      const sourceQueues = await this.inspector.listDeadLetterSourceQueues(sourceQueue.queueUrl);
      if (sourceQueues.sourceQueueUrls.length === 0) {
        throw new Error(
          `SQS queue "${sourceQueue.queueIdentifier}" has no dead-letter source queues; provide an explicit destination queue to redrive messages.`,
        );
      }
    }

    const response = await this.client.startMessageMoveTask({
      SourceArn: sourceQueue.queueArn,
      DestinationArn: destinationQueue?.queueArn,
      MaxNumberOfMessagesPerSecond: maxMessagesPerSecond,
    });

    return {
      sourceQueueIdentifier: sourceQueue.queueIdentifier,
      sourceQueueUrl: sourceQueue.queueUrl,
      sourceQueueArn: sourceQueue.queueArn,
      destinationQueueIdentifier: destinationQueue?.queueIdentifier,
      destinationQueueUrl: destinationQueue?.queueUrl,
      destinationQueueArn: destinationQueue?.queueArn,
      taskHandle: response.TaskHandle,
    };
  }

  async cancelRedrive(input: CancelSqsDlqRedriveInput): Promise<CancelSqsDlqRedriveResult> {
    const taskHandle = assertNonEmptyIdentifier(input.taskHandle, 'SQS message move task handle');
    const response = await this.client.cancelMessageMoveTask({ TaskHandle: taskHandle });

    return { taskHandle, approximateNumberOfMessagesMoved: response.ApproximateNumberOfMessagesMoved };
  }

  private async inspectQueueWithArn(queue: string, label: string): Promise<SqsQueueDescription & { queueArn: string }> {
    const description = await this.inspector.inspectQueue(queue);
    return { ...description, queueArn: assertNonEmptyText(description.queueArn, `${label} ARN`) };
  }
}
