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
import { SqsQueueUrlResolver, type SqsQueueUrlResolverClient } from './transport';

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
  'FifoQueue',
  'RedrivePolicy',
  'RedriveAllowPolicy',
];

type QueueAttributesMap = Partial<Record<QueueAttributeName, string>>;

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
  attributes: QueueAttributesMap;
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

export interface SqsQueueInspectorOptions {
  queueResolver?: SqsQueueUrlResolver;
}

export interface SqsDlqRedriveManagerOptions {
  queueResolver?: SqsQueueUrlResolver;
  queueInspector?: SqsQueueInspector;
}

export class SqsQueueInspector {
  private readonly resolver: SqsQueueUrlResolver;

  constructor(
    private readonly client: SqsQueueOperationsClient & SqsQueueUrlResolverClient,
    options: SqsQueueInspectorOptions = {},
  ) {
    this.resolver = options.queueResolver ?? new SqsQueueUrlResolver(client);
  }

  async inspectQueue(queue: string): Promise<SqsQueueDescription> {
    const queueIdentifier = assertNonEmptyIdentifier(queue, 'SQS queue identifier');
    const queueUrl = await this.resolver.resolve(queueIdentifier);
    const response = await this.client.getQueueAttributes({
      QueueUrl: queueUrl,
      AttributeNames: QUEUE_INSPECTION_ATTRIBUTE_NAMES,
    });
    const attributes = { ...(response.Attributes ?? {}) };

    return buildQueueDescription({ queueIdentifier, queueUrl, attributes });
  }

  async listDeadLetterSourceQueues(
    queue: string,
    options: { pageSize?: number } = {},
  ): Promise<SqsDeadLetterSourceQueuesResult> {
    const description = await this.inspectQueue(queue);
    const pageSize = normalizeDeadLetterSourcePageSize(options.pageSize);
    const sourceQueueUrls: string[] = [];
    let nextToken: string | undefined;

    do {
      const response = await this.client.listDeadLetterSourceQueues({
        QueueUrl: description.queueUrl,
        MaxResults: pageSize,
        NextToken: nextToken,
      });
      sourceQueueUrls.push(...(response.queueUrls ?? []));
      nextToken = response.NextToken;
    } while (nextToken);

    return {
      queueIdentifier: description.queueIdentifier,
      queueUrl: description.queueUrl,
      queueArn: description.queueArn,
      sourceQueueUrls,
    };
  }
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
        status: task.Status as SqsMessageMoveTaskStatus | undefined,
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

function buildQueueDescription(input: {
  queueIdentifier: string;
  queueUrl: string;
  attributes: QueueAttributesMap;
}): SqsQueueDescription {
  const queueArn = readOptionalNonEmptyText(input.attributes.QueueArn, 'SQS queue QueueArn attribute');

  return {
    queueIdentifier: input.queueIdentifier,
    queueName: queueArn
      ? extractNameFromArn(queueArn, SQS_ARN_SERVICE, 'SQS queue ARN')
      : extractNameFromUrl(input.queueUrl, 'SQS queue URL'),
    queueUrl: input.queueUrl,
    queueArn,
    fifo: readOptionalBooleanAttribute(input.attributes, 'FifoQueue') ?? false,
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

function parseRedrivePolicy(value: string | undefined): SqsQueueRedrivePolicy | undefined {
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

function parseRedriveAllowPolicy(value: string | undefined): SqsQueueRedriveAllowPolicy | undefined {
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

function normalizeDeadLetterSourcePageSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_DEAD_LETTER_SOURCE_PAGE_SIZE;
  }

  return assertIntegerInRange(value, 'SQS dead-letter source queue page size', 1, MAX_DEAD_LETTER_SOURCE_PAGE_SIZE);
}

function normalizeMoveTaskResultLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MOVE_TASK_RESULT_LIMIT;
  }

  return assertIntegerInRange(value, 'SQS message move task maxResults', 1, MAX_MOVE_TASK_RESULT_LIMIT);
}

function normalizeMaxMessagesPerSecond(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return assertIntegerInRange(value, 'SQS message move maxMessagesPerSecond', 1, MAX_MESSAGES_PER_SECOND);
}

function assertIntegerInRange(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

function readOptionalIntegerAttribute(
  attributes: QueueAttributesMap,
  attributeName: QueueAttributeName,
): number | undefined {
  const value = attributes[attributeName];
  if (value === undefined) {
    return undefined;
  }

  return parseBaseTenInteger(value, `SQS queue ${attributeName} attribute`);
}

function readOptionalBooleanAttribute(
  attributes: QueueAttributesMap,
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

function assertNonEmptyIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return normalized;
}

function assertNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function readOptionalNonEmptyText(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return assertNonEmptyText(value, label);
}

function isArnForService(value: string, service: string): boolean {
  const parts = value.split(':');
  return parts.length >= 6 && parts[0] === 'arn' && parts[2] === service;
}

function extractNameFromArn(arn: string, service: string, label: string): string {
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

function extractNameFromUrl(url: string, label: string): string {
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
