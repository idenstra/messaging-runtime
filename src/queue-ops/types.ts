import type {
  CancelMessageMoveTaskCommandInput,
  CancelMessageMoveTaskCommandOutput,
  GetQueueAttributesCommandInput,
  GetQueueAttributesCommandOutput,
  ListDeadLetterSourceQueuesCommandInput,
  ListDeadLetterSourceQueuesCommandOutput,
  ListMessageMoveTasksCommandInput,
  ListMessageMoveTasksCommandOutput,
  QueueAttributeName,
  StartMessageMoveTaskCommandInput,
  StartMessageMoveTaskCommandOutput,
} from '@aws-sdk/client-sqs';

export type SqsQueueAttributesMap = Partial<Record<QueueAttributeName, string>>;

export type SqsMessageMoveTaskStatus = 'RUNNING' | 'COMPLETED' | 'CANCELLING' | 'CANCELLED' | 'FAILED' | (string & {});

export interface SqsQueueOperationsClient {
  getQueueAttributes(
    input: Pick<GetQueueAttributesCommandInput, 'QueueUrl' | 'AttributeNames'>,
  ): Promise<Pick<GetQueueAttributesCommandOutput, 'Attributes'>>;
  listDeadLetterSourceQueues(
    input: Pick<ListDeadLetterSourceQueuesCommandInput, 'QueueUrl' | 'NextToken' | 'MaxResults'>,
  ): Promise<Pick<ListDeadLetterSourceQueuesCommandOutput, 'queueUrls' | 'NextToken'>>;
  startMessageMoveTask(
    input: Pick<StartMessageMoveTaskCommandInput, 'SourceArn' | 'DestinationArn' | 'MaxNumberOfMessagesPerSecond'>,
  ): Promise<Pick<StartMessageMoveTaskCommandOutput, 'TaskHandle'>>;
  listMessageMoveTasks(
    input: Pick<ListMessageMoveTasksCommandInput, 'SourceArn' | 'MaxResults'>,
  ): Promise<Pick<ListMessageMoveTasksCommandOutput, 'Results'>>;
  cancelMessageMoveTask(
    input: Pick<CancelMessageMoveTaskCommandInput, 'TaskHandle'>,
  ): Promise<Pick<CancelMessageMoveTaskCommandOutput, 'ApproximateNumberOfMessagesMoved'>>;
}

export interface SqsQueueRedrivePolicy {
  deadLetterTargetArn?: string;
  maxReceiveCount?: number;
  raw: Record<string, unknown>;
}

export interface SqsQueueRedriveAllowPolicy {
  redrivePermission?: string;
  sourceQueueArns?: string[];
  raw: Record<string, unknown>;
}

export interface SqsQueueDescription {
  queueIdentifier: string;
  queueName: string;
  queueUrl: string;
  queueArn?: string;
  fifo: boolean;
  approximateNumberOfMessages?: number;
  approximateNumberOfMessagesNotVisible?: number;
  approximateNumberOfMessagesDelayed?: number;
  visibilityTimeoutSeconds?: number;
  messageRetentionSeconds?: number;
  receiveMessageWaitTimeSeconds?: number;
  delaySeconds?: number;
  redrivePolicy?: SqsQueueRedrivePolicy;
  redriveAllowPolicy?: SqsQueueRedriveAllowPolicy;
  attributes: SqsQueueAttributesMap;
}

export interface SqsDeadLetterSourceQueuesResult {
  queueIdentifier: string;
  queueUrl: string;
  queueArn?: string;
  sourceQueueUrls: string[];
}

export interface SqsMessageMoveTaskSummary {
  taskHandle?: string;
  status?: SqsMessageMoveTaskStatus;
  sourceArn?: string;
  destinationArn?: string;
  maxMessagesPerSecond?: number;
  approximateNumberOfMessagesMoved?: number;
  approximateNumberOfMessagesToMove?: number;
  failureReason?: string;
  startedTimestamp?: number;
}

export interface ListSqsDlqRedriveTasksInput {
  sourceQueue: string;
  maxResults?: number;
}

export interface ListSqsDlqRedriveTasksResult {
  sourceQueueIdentifier: string;
  sourceQueueUrl: string;
  sourceQueueArn: string;
  tasks: SqsMessageMoveTaskSummary[];
}

export interface StartSqsDlqRedriveInput {
  sourceQueue: string;
  destinationQueue?: string;
  maxMessagesPerSecond?: number;
}

export interface StartSqsDlqRedriveResult {
  sourceQueueIdentifier: string;
  sourceQueueUrl: string;
  sourceQueueArn: string;
  destinationQueueIdentifier?: string;
  destinationQueueUrl?: string;
  destinationQueueArn?: string;
  taskHandle?: string;
}

export interface CancelSqsDlqRedriveInput {
  taskHandle: string;
}

export interface CancelSqsDlqRedriveResult {
  taskHandle: string;
  approximateNumberOfMessagesMoved?: number;
}
