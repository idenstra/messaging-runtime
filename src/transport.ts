import {
  ListTopicsCommand,
  type ListTopicsCommandInput,
  type ListTopicsCommandOutput,
  PublishBatchCommand,
  type PublishBatchCommandInput,
  type PublishBatchCommandOutput,
  type PublishBatchResultEntry,
  PublishCommand,
  type PublishCommandInput,
  type PublishCommandOutput,
  SNSClient,
  type BatchResultErrorEntry as SnsBatchResultErrorEntry,
  type MessageAttributeValue as SnsSdkMessageAttributeValue,
} from '@aws-sdk/client-sns';
import {
  type BatchResultErrorEntry,
  CancelMessageMoveTaskCommand,
  type CancelMessageMoveTaskCommandInput,
  type CancelMessageMoveTaskCommandOutput,
  ChangeMessageVisibilityBatchCommand,
  type ChangeMessageVisibilityBatchCommandInput,
  type ChangeMessageVisibilityBatchCommandOutput,
  type ChangeMessageVisibilityBatchResultEntry,
  ChangeMessageVisibilityCommand,
  type ChangeMessageVisibilityCommandInput,
  DeleteMessageBatchCommand,
  type DeleteMessageBatchCommandInput,
  type DeleteMessageBatchCommandOutput,
  type DeleteMessageBatchResultEntry,
  DeleteMessageCommand,
  type DeleteMessageCommandInput,
  GetQueueAttributesCommand,
  type GetQueueAttributesCommandInput,
  type GetQueueAttributesCommandOutput,
  GetQueueUrlCommand,
  type GetQueueUrlCommandInput,
  type GetQueueUrlCommandOutput,
  ListDeadLetterSourceQueuesCommand,
  type ListDeadLetterSourceQueuesCommandInput,
  type ListDeadLetterSourceQueuesCommandOutput,
  ListMessageMoveTasksCommand,
  type ListMessageMoveTasksCommandInput,
  type ListMessageMoveTasksCommandOutput,
  ListQueuesCommand,
  type ListQueuesCommandInput,
  type ListQueuesCommandOutput,
  ReceiveMessageCommand,
  type ReceiveMessageCommandInput,
  type ReceiveMessageCommandOutput,
  SendMessageBatchCommand,
  type SendMessageBatchCommandInput,
  type SendMessageBatchCommandOutput,
  type SendMessageBatchResultEntry,
  SendMessageCommand,
  type SendMessageCommandInput,
  type SendMessageCommandOutput,
  SQSClient,
  type MessageAttributeValue as SqsSdkMessageAttributeValue,
  StartMessageMoveTaskCommand,
  type StartMessageMoveTaskCommandInput,
  type StartMessageMoveTaskCommandOutput,
} from '@aws-sdk/client-sqs';
import type { SqsRuntimeClient, SqsRuntimeRequestOptions } from './core';
import type { SqsQueueOperationsClient } from './queue-ops';

const SQS_ARN_SERVICE = 'sqs';
const SNS_ARN_SERVICE = 'sns';
const DEFAULT_SQS_JSON_LABEL = 'SQS message body';
const DEFAULT_SNS_ENVELOPE_LABEL = 'SNS envelope body';
const DEFAULT_SNS_NOTIFICATION_LABEL = 'SNS notification message';
const DEFAULT_SQS_QUEUE_DISCOVERY_PAGE_SIZE = 1_000;
const MAX_SQS_QUEUE_DISCOVERY_PAGE_SIZE = 1_000;

export type SnsEnvelopeType = 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';

export type SqsMessageAttributes = Record<string, SqsSdkMessageAttributeValue>;
export type SnsMessageAttributes = Record<string, SnsSdkMessageAttributeValue>;

export interface SnsEnvelopeBase extends Record<string, unknown> {
  Type: SnsEnvelopeType;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion?: string;
  Signature?: string;
  SigningCertURL?: string;
  UnsubscribeURL?: string;
}

export interface SnsNotificationEnvelope extends SnsEnvelopeBase {
  Type: 'Notification';
  Subject?: string;
}

export interface SnsSubscriptionConfirmationEnvelope extends SnsEnvelopeBase {
  Type: 'SubscriptionConfirmation';
  Token: string;
  SubscribeURL: string;
}

export interface SnsUnsubscribeConfirmationEnvelope extends SnsEnvelopeBase {
  Type: 'UnsubscribeConfirmation';
  Token: string;
  SubscribeURL: string;
}

export type SnsEnvelope =
  | SnsNotificationEnvelope
  | SnsSubscriptionConfirmationEnvelope
  | SnsUnsubscribeConfirmationEnvelope;

export interface DecodedSnsNotificationJson<TPayload> {
  envelope: SnsNotificationEnvelope;
  payload: TPayload;
}

export interface SqsQueueResolutionInput {
  queue: string;
  ownerAccountId?: string;
}

export interface SqsQueueUrlResolverPreloadEntry {
  queue: string;
  queueUrl: string;
  ownerAccountId?: string;
}

export interface SqsQueueUrlResolverClient {
  getQueueUrl(
    input: Pick<GetQueueUrlCommandInput, 'QueueName' | 'QueueOwnerAWSAccountId'>,
  ): Promise<Pick<GetQueueUrlCommandOutput, 'QueueUrl'>>;
}

export interface SnsTopicArnResolverClient {
  listTopics(
    input: Pick<ListTopicsCommandInput, 'NextToken'>,
  ): Promise<Pick<ListTopicsCommandOutput, 'NextToken' | 'Topics'>>;
}

export interface SqsQueueDiscoveryClient {
  listQueues(
    input: Pick<ListQueuesCommandInput, 'QueueNamePrefix' | 'NextToken' | 'MaxResults'>,
  ): Promise<Pick<ListQueuesCommandOutput, 'QueueUrls' | 'NextToken'>>;
}

export interface SqsPublishClient {
  sendMessage(input: SendMessageCommandInput): Promise<SendMessageCommandOutput>;
  sendMessageBatch(input: SendMessageBatchCommandInput): Promise<SendMessageBatchCommandOutput>;
}

export interface SqsBatchOperationClient {
  deleteMessageBatch(input: DeleteMessageBatchCommandInput): Promise<DeleteMessageBatchCommandOutput>;
  changeMessageVisibilityBatch(
    input: ChangeMessageVisibilityBatchCommandInput,
  ): Promise<ChangeMessageVisibilityBatchCommandOutput>;
}

export interface SnsPublishClient {
  publish(input: PublishCommandInput): Promise<PublishCommandOutput>;
  publishBatch(input: PublishBatchCommandInput): Promise<PublishBatchCommandOutput>;
}

export type SqsTransportClient = SqsQueueUrlResolverClient & SqsPublishClient & SqsBatchOperationClient;
export type SnsTransportClient = SnsTopicArnResolverClient & SnsPublishClient;

export interface SqsQueueSummary {
  queueName: string;
  queueUrl: string;
  fifo: boolean;
}

export interface ListSqsQueuesInput {
  namePrefix?: string;
  pageSize?: number;
  nextToken?: string;
}

export interface ListSqsQueuesResult {
  queues: SqsQueueSummary[];
  nextToken?: string;
}

export interface SnsTopicSummary {
  topicName: string;
  topicArn: string;
  fifo: boolean;
}

export interface ListSnsTopicsInput {
  nextToken?: string;
}

export interface ListSnsTopicsResult {
  topics: SnsTopicSummary[];
  nextToken?: string;
}

export interface SqsSendJsonOptions {
  delaySeconds?: number;
  messageAttributes?: SqsMessageAttributes;
  messageGroupId?: string;
  messageDeduplicationId?: string;
}

export interface SqsSendJsonInput<TPayload> extends SqsSendJsonOptions {
  queue: string;
  payload: TPayload;
}

export interface SqsSendJsonBatchEntry<TId extends string = string, TPayload = unknown> extends SqsSendJsonOptions {
  id: TId;
  payload: TPayload;
}

export interface SqsSendJsonBatchInput<TId extends string = string, TPayload = unknown> {
  queue: string;
  entries: Array<SqsSendJsonBatchEntry<TId, TPayload>>;
}

export interface SqsSendJsonResult {
  queueUrl: string;
  messageId?: string;
  sequenceNumber?: string;
  md5OfMessageBody?: string;
  md5OfMessageAttributes?: string;
  md5OfMessageSystemAttributes?: string;
}

export interface SqsSendJsonBatchSuccess<TId extends string = string> {
  id: TId;
  messageId?: string;
  sequenceNumber?: string;
  md5OfMessageBody?: string;
  md5OfMessageAttributes?: string;
  md5OfMessageSystemAttributes?: string;
}

export interface SqsSendJsonBatchFailure<TId extends string = string> {
  id: TId;
  code?: string;
  message?: string;
  senderFault?: boolean;
}

export interface SqsSendJsonBatchResult<TId extends string = string> {
  queueUrl: string;
  requestedCount: number;
  successfulCount: number;
  failedCount: number;
  successfulById: Record<string, SqsSendJsonBatchSuccess<TId>>;
  failedById: Record<string, SqsSendJsonBatchFailure<TId>>;
}

export interface SqsBatchOperationSuccess<TId extends string = string> {
  id: TId;
}

export interface SqsBatchOperationFailure<TId extends string = string> {
  id: TId;
  code?: string;
  message?: string;
  senderFault?: boolean;
}

export interface SqsDeleteMessagesBatchEntry<TId extends string = string> {
  id: TId;
  receiptHandle: string;
}

export interface SqsDeleteMessagesInput<TId extends string = string> {
  queue: string;
  entries: Array<SqsDeleteMessagesBatchEntry<TId>>;
}

export interface SqsDeleteMessagesResult<TId extends string = string> {
  queueUrl: string;
  requestedCount: number;
  successfulCount: number;
  failedCount: number;
  successfulById: Record<string, SqsBatchOperationSuccess<TId>>;
  failedById: Record<string, SqsBatchOperationFailure<TId>>;
}

export interface SqsChangeMessageVisibilityBatchEntry<TId extends string = string> {
  id: TId;
  receiptHandle: string;
  visibilityTimeoutSeconds: number;
}

export interface SqsChangeMessageVisibilityInput<TId extends string = string> {
  queue: string;
  entries: Array<SqsChangeMessageVisibilityBatchEntry<TId>>;
}

export interface SqsChangeMessageVisibilityResult<TId extends string = string> {
  queueUrl: string;
  requestedCount: number;
  successfulCount: number;
  failedCount: number;
  successfulById: Record<string, SqsBatchOperationSuccess<TId>>;
  failedById: Record<string, SqsBatchOperationFailure<TId>>;
}

export interface SnsPublishJsonOptions {
  subject?: string;
  messageAttributes?: SnsMessageAttributes;
  messageGroupId?: string;
  messageDeduplicationId?: string;
}

export interface SnsStructuredJsonMessage {
  default: string;
  http?: string;
  https?: string;
  email?: string;
  'email-json'?: string;
  sms?: string;
  sqs?: string;
  lambda?: string;
  application?: string;
}

export interface SnsPublishStructuredJsonOptions {
  subject?: string;
  messageGroupId?: string;
  messageDeduplicationId?: string;
}

export interface SnsPublishJsonInput<TPayload> extends SnsPublishJsonOptions {
  topic: string;
  payload: TPayload;
}

export interface SnsPublishStructuredJsonInput extends SnsPublishStructuredJsonOptions {
  topic: string;
  payload: SnsStructuredJsonMessage;
}

export interface SnsPublishJsonResult {
  topicArn: string;
  messageId?: string;
  sequenceNumber?: string;
}

export interface SnsPublishJsonBatchEntry<TId extends string = string, TPayload = unknown>
  extends SnsPublishJsonOptions {
  id: TId;
  payload: TPayload;
}

export interface SnsPublishStructuredJsonBatchEntry<TId extends string = string>
  extends SnsPublishStructuredJsonOptions {
  id: TId;
  payload: SnsStructuredJsonMessage;
}

export interface SnsPublishJsonBatchInput<TId extends string = string, TPayload = unknown> {
  topic: string;
  entries: Array<SnsPublishJsonBatchEntry<TId, TPayload>>;
}

export interface SnsPublishStructuredJsonBatchInput<TId extends string = string> {
  topic: string;
  entries: Array<SnsPublishStructuredJsonBatchEntry<TId>>;
}

export interface SnsPublishJsonBatchSuccess<TId extends string = string> {
  id: TId;
  messageId?: string;
  sequenceNumber?: string;
}

export interface SnsPublishJsonBatchFailure<TId extends string = string> {
  id: TId;
  code?: string;
  message?: string;
  senderFault?: boolean;
}

export interface SnsPublishJsonBatchResult<TId extends string = string> {
  topicArn: string;
  requestedCount: number;
  successfulCount: number;
  failedCount: number;
  successfulById: Record<string, SnsPublishJsonBatchSuccess<TId>>;
  failedById: Record<string, SnsPublishJsonBatchFailure<TId>>;
}

export interface SqsQueueUrlResolverOptions {
  preload?: Record<string, string>;
  preloadEntries?: SqsQueueUrlResolverPreloadEntry[];
  allowNetworkLookup?: boolean;
}

export interface SnsTopicArnResolverOptions {
  preload?: Record<string, string>;
  allowNetworkLookup?: boolean;
}

export function decodeSqsJsonBody<TPayload>(body: string | undefined, label = DEFAULT_SQS_JSON_LABEL): TPayload {
  const rawBody = assertNonEmptyText(body, label);

  try {
    return JSON.parse(rawBody) as TPayload;
  } catch (error) {
    throw new Error(`Invalid ${label} JSON.`, { cause: error });
  }
}

export function decodeSnsEnvelope(body: string | undefined, label = DEFAULT_SNS_ENVELOPE_LABEL): SnsEnvelope {
  const envelope = assertRecord(decodeSqsJsonBody<Record<string, unknown>>(body, label), label);
  const type = assertSnsEnvelopeType(envelope.Type, label);
  const messageId = assertNonEmptyText(envelope.MessageId, `${label} MessageId`);
  const topicArn = assertNonEmptyText(envelope.TopicArn, `${label} TopicArn`);
  const message = assertNonEmptyText(envelope.Message, `${label} Message`);
  const timestamp = assertNonEmptyText(envelope.Timestamp, `${label} Timestamp`);
  const common = {
    ...envelope,
    Type: type,
    MessageId: messageId,
    TopicArn: topicArn,
    Message: message,
    Timestamp: timestamp,
  };

  switch (type) {
    case 'Notification': {
      const subject = readOptionalText(envelope.Subject, `${label} Subject`);
      const notificationEnvelope: SnsNotificationEnvelope =
        subject === undefined
          ? { ...common, Type: 'Notification' }
          : { ...common, Type: 'Notification', Subject: subject };
      return notificationEnvelope;
    }
    case 'SubscriptionConfirmation':
      return {
        ...common,
        Type: 'SubscriptionConfirmation',
        Token: assertNonEmptyText(envelope.Token, `${label} Token`),
        SubscribeURL: assertNonEmptyText(envelope.SubscribeURL, `${label} SubscribeURL`),
      };
    case 'UnsubscribeConfirmation':
      return {
        ...common,
        Type: 'UnsubscribeConfirmation',
        Token: assertNonEmptyText(envelope.Token, `${label} Token`),
        SubscribeURL: assertNonEmptyText(envelope.SubscribeURL, `${label} SubscribeURL`),
      };
  }
}

export function decodeSnsNotificationJson<TPayload>(
  body: string | undefined,
  label = DEFAULT_SNS_NOTIFICATION_LABEL,
): DecodedSnsNotificationJson<TPayload> {
  const envelope = decodeSnsEnvelope(body, label);
  if (envelope.Type !== 'Notification') {
    throw new Error(`${label} must be an SNS Notification envelope.`);
  }

  return { envelope, payload: decodeSqsJsonBody<TPayload>(envelope.Message, `${label} payload`) };
}

export class SqsQueueUrlResolver {
  private readonly identifierCache = new Map<string, string>();
  private readonly queueNameCache = new Map<string, string>();
  private readonly allowNetworkLookup: boolean;

  constructor(
    private readonly client: SqsQueueUrlResolverClient,
    options: SqsQueueUrlResolverOptions = {},
  ) {
    this.allowNetworkLookup = options.allowNetworkLookup ?? true;
    this.seedPreload(options.preload ?? {});
    this.seedPreloadEntries(options.preloadEntries ?? []);
  }

  async resolve(queue: string): Promise<string>;
  async resolve(input: SqsQueueResolutionInput): Promise<string>;
  async resolve(input: string | SqsQueueResolutionInput): Promise<string> {
    const resolution = normalizeSqsQueueResolutionInput(input);
    const cached = this.identifierCache.get(resolution.identifierCacheKey);
    if (cached) {
      return cached;
    }

    if (resolution.directQueueUrl) {
      this.cacheResolution(resolution, resolution.directQueueUrl);
      return resolution.directQueueUrl;
    }

    const namedCacheHit = this.queueNameCache.get(resolution.queueNameCacheKey);
    if (namedCacheHit) {
      this.cacheResolution(resolution, namedCacheHit);
      return namedCacheHit;
    }

    if (!this.allowNetworkLookup) {
      throw new Error(
        `SQS queue "${resolution.queueIdentifier}" was not found in preloaded mappings and network lookup is disabled.`,
      );
    }

    const response = await this.client.getQueueUrl({
      QueueName: resolution.queueName,
      QueueOwnerAWSAccountId: resolution.ownerAccountId,
    });
    const queueUrl = assertNonEmptyText(response.QueueUrl, `resolved queue URL for ${resolution.queueName}`);
    this.cacheResolution(resolution, queueUrl);
    return queueUrl;
  }

  private cacheResolution(resolution: NormalizedSqsQueueResolutionInput, queueUrl: string): void {
    this.identifierCache.set(resolution.identifierCacheKey, queueUrl);
    this.identifierCache.set(queueUrl, queueUrl);
    if (resolution.cacheUnnamedQueueName) {
      this.queueNameCache.set(createSqsQueueNameCacheKey(resolution.queueName), queueUrl);
    }

    const derivedOwnerAccountId = resolution.ownerAccountId ?? extractAccountIdFromSqsQueueUrl(queueUrl);
    if (derivedOwnerAccountId) {
      this.queueNameCache.set(createSqsQueueNameCacheKey(resolution.queueName, derivedOwnerAccountId), queueUrl);
    }
  }

  private seedPreload(preload: Record<string, string>): void {
    for (const [identifier, resolvedQueueUrl] of Object.entries(preload)) {
      const normalizedIdentifier = assertNonEmptyIdentifier(identifier, 'preloaded SQS queue identifier');
      const queueUrl = assertSqsQueueUrl(resolvedQueueUrl, `preloaded SQS queue URL for ${normalizedIdentifier}`);
      const queueName = isHttpUrl(normalizedIdentifier)
        ? extractNameFromUrl(normalizedIdentifier, 'preloaded SQS queue URL')
        : isArnForService(normalizedIdentifier, SQS_ARN_SERVICE)
          ? extractNameFromArn(normalizedIdentifier, SQS_ARN_SERVICE, 'preloaded SQS queue ARN')
          : normalizedIdentifier;
      this.identifierCache.set(normalizedIdentifier, queueUrl);
      this.identifierCache.set(queueName, queueUrl);
      this.identifierCache.set(queueUrl, queueUrl);
      this.queueNameCache.set(createSqsQueueNameCacheKey(queueName), queueUrl);

      const derivedOwnerAccountId = extractAccountIdFromSqsQueueUrl(queueUrl);
      if (derivedOwnerAccountId) {
        this.queueNameCache.set(createSqsQueueNameCacheKey(queueName, derivedOwnerAccountId), queueUrl);
      }
    }
  }

  private seedPreloadEntries(preloadEntries: SqsQueueUrlResolverPreloadEntry[]): void {
    for (const preloadEntry of preloadEntries) {
      const queueUrl = assertSqsQueueUrl(preloadEntry.queueUrl, 'preloaded SQS queue URL');
      const resolution = normalizeSqsQueueResolutionInput({
        queue: preloadEntry.queue,
        ownerAccountId: preloadEntry.ownerAccountId,
      });
      this.cacheResolution(resolution, queueUrl);
    }
  }
}

export class SnsTopicArnResolver {
  private readonly identifierCache = new Map<string, string>();
  private readonly topicNameCache = new Map<string, string>();
  private readonly allowNetworkLookup: boolean;

  constructor(
    private readonly client: SnsTopicArnResolverClient,
    options: SnsTopicArnResolverOptions = {},
  ) {
    this.allowNetworkLookup = options.allowNetworkLookup ?? true;
    this.seedPreload(options.preload ?? {});
  }

  async resolve(topic: string): Promise<string> {
    const topicIdentifier = assertNonEmptyIdentifier(topic, 'SNS topic identifier');
    const cached = this.identifierCache.get(topicIdentifier);
    if (cached) {
      return cached;
    }

    if (isArnForService(topicIdentifier, SNS_ARN_SERVICE)) {
      const topicName = extractNameFromArn(topicIdentifier, SNS_ARN_SERVICE, 'SNS topic ARN');
      this.cacheResolution(topicIdentifier, topicName, topicIdentifier);
      return topicIdentifier;
    }

    const namedCacheHit = this.topicNameCache.get(topicIdentifier);
    if (namedCacheHit) {
      this.cacheResolution(topicIdentifier, topicIdentifier, namedCacheHit);
      return namedCacheHit;
    }

    if (!this.allowNetworkLookup) {
      throw new Error(
        `SNS topic "${topicIdentifier}" was not found in preloaded mappings and network lookup is disabled.`,
      );
    }

    let nextToken: string | undefined;
    do {
      const response = await this.client.listTopics({ NextToken: nextToken });
      for (const topicEntry of response.Topics ?? []) {
        if (!topicEntry.TopicArn) {
          continue;
        }

        const currentTopicName = extractNameFromArn(topicEntry.TopicArn, SNS_ARN_SERVICE, 'SNS topic ARN');
        if (currentTopicName !== topicIdentifier) {
          continue;
        }

        this.cacheResolution(topicIdentifier, currentTopicName, topicEntry.TopicArn);
        return topicEntry.TopicArn;
      }
      nextToken = response.NextToken;
    } while (nextToken);

    throw new Error(`SNS topic "${topicIdentifier}" was not found by ListTopics.`);
  }

  private cacheResolution(identifier: string, topicName: string, topicArn: string): void {
    this.identifierCache.set(identifier, topicArn);
    this.identifierCache.set(topicName, topicArn);
    this.identifierCache.set(topicArn, topicArn);
    this.topicNameCache.set(topicName, topicArn);
  }

  private seedPreload(preload: Record<string, string>): void {
    for (const [identifier, resolvedTopicArn] of Object.entries(preload)) {
      const normalizedIdentifier = assertNonEmptyIdentifier(identifier, 'preloaded SNS topic identifier');
      const topicArn = assertSnsTopicArn(resolvedTopicArn, `preloaded SNS topic ARN for ${normalizedIdentifier}`);
      const topicName = extractNameFromArn(topicArn, SNS_ARN_SERVICE, 'preloaded SNS topic ARN');
      this.cacheResolution(normalizedIdentifier, topicName, topicArn);
    }
  }
}

export class SqsQueueDiscovery {
  constructor(private readonly client: SqsQueueDiscoveryClient) {}

  async listQueues(input: ListSqsQueuesInput = {}): Promise<ListSqsQueuesResult> {
    const pageSize = normalizeSqsQueueDiscoveryPageSize(input.pageSize);
    const queueNamePrefix =
      input.namePrefix === undefined ? undefined : assertNonEmptyIdentifier(input.namePrefix, 'SQS queue name prefix');
    const nextToken =
      input.nextToken === undefined ? undefined : assertNonEmptyIdentifier(input.nextToken, 'SQS nextToken');
    const response = await this.client.listQueues({
      QueueNamePrefix: queueNamePrefix,
      MaxResults: pageSize,
      NextToken: nextToken,
    });

    return {
      queues: (response.QueueUrls ?? []).map((queueUrl) => {
        const normalizedQueueUrl = assertSqsQueueUrl(queueUrl, 'discovered SQS queue URL');
        const queueName = extractNameFromUrl(normalizedQueueUrl, 'discovered SQS queue URL');
        return { queueName, queueUrl: normalizedQueueUrl, fifo: queueName.endsWith('.fifo') };
      }),
      nextToken: response.NextToken,
    };
  }
}

export class SnsTopicDiscovery {
  constructor(private readonly client: SnsTopicArnResolverClient) {}

  async listTopics(input: ListSnsTopicsInput = {}): Promise<ListSnsTopicsResult> {
    const nextToken =
      input.nextToken === undefined ? undefined : assertNonEmptyIdentifier(input.nextToken, 'SNS nextToken');
    const response = await this.client.listTopics({ NextToken: nextToken });

    return {
      topics: (response.Topics ?? [])
        .filter((topicEntry): topicEntry is { TopicArn: string } => typeof topicEntry.TopicArn === 'string')
        .map((topicEntry) => {
          const topicArn = assertSnsTopicArn(topicEntry.TopicArn, 'discovered SNS topic ARN');
          const topicName = extractNameFromArn(topicArn, SNS_ARN_SERVICE, 'discovered SNS topic ARN');
          return { topicName, topicArn, fifo: topicName.endsWith('.fifo') };
        }),
      nextToken: response.NextToken,
    };
  }
}

export class SqsPublisher {
  private readonly resolver: SqsQueueUrlResolver;

  constructor(
    private readonly client: SqsTransportClient,
    resolver?: SqsQueueUrlResolver,
  ) {
    this.resolver = resolver ?? new SqsQueueUrlResolver(client);
  }

  async sendJson<TPayload>(input: SqsSendJsonInput<TPayload>): Promise<SqsSendJsonResult> {
    const queueUrl = await this.resolver.resolve(input.queue);
    const response = await this.client.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(input.payload),
      DelaySeconds: input.delaySeconds,
      MessageAttributes: input.messageAttributes,
      MessageGroupId: input.messageGroupId,
      MessageDeduplicationId: input.messageDeduplicationId,
    });

    return {
      queueUrl,
      messageId: response.MessageId,
      sequenceNumber: response.SequenceNumber,
      md5OfMessageBody: response.MD5OfMessageBody,
      md5OfMessageAttributes: response.MD5OfMessageAttributes,
      md5OfMessageSystemAttributes: response.MD5OfMessageSystemAttributes,
    };
  }

  async sendJsonBatch<TId extends string, TPayload>(
    input: SqsSendJsonBatchInput<TId, TPayload>,
  ): Promise<SqsSendJsonBatchResult<TId>> {
    assertUniqueBatchEntryIds(input.entries, 'SQS batch publish entry id');
    const queueUrl = await this.resolver.resolve(input.queue);
    const successfulById: Record<string, SqsSendJsonBatchSuccess<TId>> = {};
    const failedById: Record<string, SqsSendJsonBatchFailure<TId>> = {};

    for (let offset = 0; offset < input.entries.length; offset += 10) {
      const chunk = input.entries.slice(offset, offset + 10);
      const internalIdMap = new Map<string, TId>();
      const response = await this.client.sendMessageBatch({
        QueueUrl: queueUrl,
        Entries: chunk.map((entry, index) => {
          const internalId = `entry-${offset + index}`;
          internalIdMap.set(internalId, entry.id);

          return {
            Id: internalId,
            MessageBody: JSON.stringify(entry.payload),
            DelaySeconds: entry.delaySeconds,
            MessageAttributes: entry.messageAttributes,
            MessageGroupId: entry.messageGroupId,
            MessageDeduplicationId: entry.messageDeduplicationId,
          };
        }),
      });

      recordSuccessfulBatchEntries(internalIdMap, response.Successful ?? [], successfulById);
      recordFailedBatchEntries(internalIdMap, response.Failed ?? [], failedById);
    }

    return {
      queueUrl,
      requestedCount: input.entries.length,
      successfulCount: Object.keys(successfulById).length,
      failedCount: Object.keys(failedById).length,
      successfulById,
      failedById,
    };
  }
}

export class SqsMessageBatchOperator {
  private readonly resolver: SqsQueueUrlResolver;

  constructor(
    private readonly client: SqsQueueUrlResolverClient & SqsBatchOperationClient,
    resolver?: SqsQueueUrlResolver,
  ) {
    this.resolver = resolver ?? new SqsQueueUrlResolver(client);
  }

  async deleteMessages<TId extends string>(input: SqsDeleteMessagesInput<TId>): Promise<SqsDeleteMessagesResult<TId>> {
    assertUniqueBatchEntryIds(input.entries, 'SQS delete batch entry id');
    const queueUrl = await this.resolver.resolve(input.queue);
    const successfulById: Record<string, SqsBatchOperationSuccess<TId>> = {};
    const failedById: Record<string, SqsBatchOperationFailure<TId>> = {};

    for (let offset = 0; offset < input.entries.length; offset += 10) {
      const chunk = input.entries.slice(offset, offset + 10);
      const internalIdMap = new Map<string, TId>();
      const response = await this.client.deleteMessageBatch({
        QueueUrl: queueUrl,
        Entries: chunk.map((entry, index) => {
          const internalId = createInternalBatchEntryId(offset, index);
          internalIdMap.set(internalId, entry.id);

          return {
            Id: internalId,
            ReceiptHandle: assertNonEmptyText(
              entry.receiptHandle,
              `receiptHandle for SQS delete batch entry ${entry.id}`,
            ),
          };
        }),
      });

      recordSimpleSuccessfulBatchEntries(internalIdMap, response.Successful ?? [], successfulById);
      recordFailedBatchEntries(internalIdMap, response.Failed ?? [], failedById);
    }

    return createSimpleBatchResult(queueUrl, input.entries.length, successfulById, failedById);
  }

  async changeMessageVisibility<TId extends string>(
    input: SqsChangeMessageVisibilityInput<TId>,
  ): Promise<SqsChangeMessageVisibilityResult<TId>> {
    assertUniqueBatchEntryIds(input.entries, 'SQS visibility batch entry id');
    const queueUrl = await this.resolver.resolve(input.queue);
    const successfulById: Record<string, SqsBatchOperationSuccess<TId>> = {};
    const failedById: Record<string, SqsBatchOperationFailure<TId>> = {};

    for (let offset = 0; offset < input.entries.length; offset += 10) {
      const chunk = input.entries.slice(offset, offset + 10);
      const internalIdMap = new Map<string, TId>();
      const response = await this.client.changeMessageVisibilityBatch({
        QueueUrl: queueUrl,
        Entries: chunk.map((entry, index) => {
          const internalId = createInternalBatchEntryId(offset, index);
          internalIdMap.set(internalId, entry.id);

          return {
            Id: internalId,
            ReceiptHandle: assertNonEmptyText(
              entry.receiptHandle,
              `receiptHandle for SQS visibility batch entry ${entry.id}`,
            ),
            VisibilityTimeout: assertIntegerInRange(
              entry.visibilityTimeoutSeconds,
              `visibilityTimeoutSeconds for SQS visibility batch entry ${entry.id}`,
              0,
              43_200,
            ),
          };
        }),
      });

      recordSimpleSuccessfulBatchEntries(internalIdMap, response.Successful ?? [], successfulById);
      recordFailedBatchEntries(internalIdMap, response.Failed ?? [], failedById);
    }

    return createSimpleBatchResult(queueUrl, input.entries.length, successfulById, failedById);
  }
}

export class SnsPublisher {
  private readonly resolver: SnsTopicArnResolver;

  constructor(
    private readonly client: SnsTransportClient,
    resolver?: SnsTopicArnResolver,
  ) {
    this.resolver = resolver ?? new SnsTopicArnResolver(client);
  }

  async publishJson<TPayload>(input: SnsPublishJsonInput<TPayload>): Promise<SnsPublishJsonResult> {
    const topicArn = await this.resolver.resolve(input.topic);
    validateSnsPublishEntry(
      {
        subject: input.subject,
        messageAttributes: input.messageAttributes,
        messageGroupId: input.messageGroupId,
        messageDeduplicationId: input.messageDeduplicationId,
      },
      { topicArn, label: 'SNS publish request', structuredJson: false },
    );
    const response = await this.client.publish({
      TopicArn: topicArn,
      Message: JSON.stringify(input.payload),
      Subject: input.subject,
      MessageAttributes: input.messageAttributes,
      MessageGroupId: input.messageGroupId,
      MessageDeduplicationId: input.messageDeduplicationId,
    });

    return { topicArn, messageId: response.MessageId, sequenceNumber: response.SequenceNumber };
  }

  async publishStructuredJson(input: SnsPublishStructuredJsonInput): Promise<SnsPublishJsonResult> {
    const topicArn = await this.resolver.resolve(input.topic);
    validateSnsStructuredJsonMessage(input.payload, 'SNS structured publish payload');
    validateSnsPublishEntry(
      {
        subject: input.subject,
        messageAttributes: readUnsupportedStructuredMessageAttributes(input),
        messageGroupId: input.messageGroupId,
        messageDeduplicationId: input.messageDeduplicationId,
      },
      { topicArn, label: 'SNS structured publish request', structuredJson: true },
    );
    const response = await this.client.publish({
      TopicArn: topicArn,
      Message: JSON.stringify(input.payload),
      MessageStructure: 'json',
      Subject: input.subject,
      MessageGroupId: input.messageGroupId,
      MessageDeduplicationId: input.messageDeduplicationId,
    });

    return { topicArn, messageId: response.MessageId, sequenceNumber: response.SequenceNumber };
  }

  async publishJsonBatch<TId extends string, TPayload>(
    input: SnsPublishJsonBatchInput<TId, TPayload>,
  ): Promise<SnsPublishJsonBatchResult<TId>> {
    assertUniqueBatchEntryIds(input.entries, 'SNS batch publish entry id');
    const topicArn = await this.resolver.resolve(input.topic);
    const successfulById: Record<string, SnsPublishJsonBatchSuccess<TId>> = {};
    const failedById: Record<string, SnsPublishJsonBatchFailure<TId>> = {};

    for (let offset = 0; offset < input.entries.length; offset += 10) {
      const chunk = input.entries.slice(offset, offset + 10);
      const internalIdMap = new Map<string, TId>();
      const response = await this.client.publishBatch({
        TopicArn: topicArn,
        PublishBatchRequestEntries: chunk.map((entry, index) => {
          validateSnsPublishEntry(entry, {
            topicArn,
            label: `SNS batch publish entry ${entry.id}`,
            structuredJson: false,
          });
          const internalId = createInternalBatchEntryId(offset, index);
          internalIdMap.set(internalId, entry.id);

          return {
            Id: internalId,
            Message: JSON.stringify(entry.payload),
            Subject: entry.subject,
            MessageAttributes: entry.messageAttributes,
            MessageGroupId: entry.messageGroupId,
            MessageDeduplicationId: entry.messageDeduplicationId,
          };
        }),
      });

      recordSnsPublishSuccessfulBatchEntries(internalIdMap, response.Successful ?? [], successfulById);
      recordFailedBatchEntries(internalIdMap, response.Failed ?? [], failedById);
    }

    return {
      topicArn,
      requestedCount: input.entries.length,
      successfulCount: Object.keys(successfulById).length,
      failedCount: Object.keys(failedById).length,
      successfulById,
      failedById,
    };
  }

  async publishStructuredJsonBatch<TId extends string>(
    input: SnsPublishStructuredJsonBatchInput<TId>,
  ): Promise<SnsPublishJsonBatchResult<TId>> {
    assertUniqueBatchEntryIds(input.entries, 'SNS structured batch publish entry id');
    const topicArn = await this.resolver.resolve(input.topic);
    const successfulById: Record<string, SnsPublishJsonBatchSuccess<TId>> = {};
    const failedById: Record<string, SnsPublishJsonBatchFailure<TId>> = {};

    for (let offset = 0; offset < input.entries.length; offset += 10) {
      const chunk = input.entries.slice(offset, offset + 10);
      const internalIdMap = new Map<string, TId>();
      const response = await this.client.publishBatch({
        TopicArn: topicArn,
        PublishBatchRequestEntries: chunk.map((entry, index) => {
          validateSnsStructuredJsonMessage(entry.payload, `SNS structured batch publish payload ${entry.id}`);
          validateSnsPublishEntry(
            { ...entry, messageAttributes: readUnsupportedStructuredMessageAttributes(entry) },
            { topicArn, label: `SNS structured batch publish entry ${entry.id}`, structuredJson: true },
          );
          const internalId = createInternalBatchEntryId(offset, index);
          internalIdMap.set(internalId, entry.id);

          return {
            Id: internalId,
            Message: JSON.stringify(entry.payload),
            MessageStructure: 'json',
            Subject: entry.subject,
            MessageGroupId: entry.messageGroupId,
            MessageDeduplicationId: entry.messageDeduplicationId,
          };
        }),
      });

      recordSnsPublishSuccessfulBatchEntries(internalIdMap, response.Successful ?? [], successfulById);
      recordFailedBatchEntries(internalIdMap, response.Failed ?? [], failedById);
    }

    return {
      topicArn,
      requestedCount: input.entries.length,
      successfulCount: Object.keys(successfulById).length,
      failedCount: Object.keys(failedById).length,
      successfulById,
      failedById,
    };
  }
}

export class AwsSqsAdapter
  implements SqsTransportClient, SqsRuntimeClient, SqsQueueOperationsClient, SqsQueueDiscoveryClient
{
  constructor(private readonly client: SQSClient) {}

  receiveMessage(
    input: ReceiveMessageCommandInput,
    options?: SqsRuntimeRequestOptions,
  ): Promise<ReceiveMessageCommandOutput> {
    return this.client.send(new ReceiveMessageCommand(input), options);
  }

  async deleteMessage(input: DeleteMessageCommandInput): Promise<void> {
    await this.client.send(new DeleteMessageCommand(input));
  }

  async changeMessageVisibility(input: ChangeMessageVisibilityCommandInput): Promise<void> {
    await this.client.send(new ChangeMessageVisibilityCommand(input));
  }

  async deleteMessageBatch(input: DeleteMessageBatchCommandInput): Promise<DeleteMessageBatchCommandOutput> {
    return this.client.send(new DeleteMessageBatchCommand(input));
  }

  async changeMessageVisibilityBatch(
    input: ChangeMessageVisibilityBatchCommandInput,
  ): Promise<ChangeMessageVisibilityBatchCommandOutput> {
    return this.client.send(new ChangeMessageVisibilityBatchCommand(input));
  }

  async getQueueUrl(
    input: Pick<GetQueueUrlCommandInput, 'QueueName' | 'QueueOwnerAWSAccountId'>,
  ): Promise<Pick<GetQueueUrlCommandOutput, 'QueueUrl'>> {
    const response = await this.client.send(new GetQueueUrlCommand(input));
    return { QueueUrl: response.QueueUrl };
  }

  async listQueues(
    input: Pick<ListQueuesCommandInput, 'QueueNamePrefix' | 'NextToken' | 'MaxResults'>,
  ): Promise<Pick<ListQueuesCommandOutput, 'QueueUrls' | 'NextToken'>> {
    const response = await this.client.send(new ListQueuesCommand(input));
    return { QueueUrls: response.QueueUrls, NextToken: response.NextToken };
  }

  async getQueueAttributes(
    input: Pick<GetQueueAttributesCommandInput, 'QueueUrl' | 'AttributeNames'>,
  ): Promise<Pick<GetQueueAttributesCommandOutput, 'Attributes'>> {
    const response = await this.client.send(new GetQueueAttributesCommand(input));
    return { Attributes: response.Attributes };
  }

  async listDeadLetterSourceQueues(
    input: Pick<ListDeadLetterSourceQueuesCommandInput, 'QueueUrl' | 'NextToken' | 'MaxResults'>,
  ): Promise<Pick<ListDeadLetterSourceQueuesCommandOutput, 'queueUrls' | 'NextToken'>> {
    const response = await this.client.send(new ListDeadLetterSourceQueuesCommand(input));
    return { queueUrls: response.queueUrls, NextToken: response.NextToken };
  }

  async startMessageMoveTask(
    input: Pick<StartMessageMoveTaskCommandInput, 'SourceArn' | 'DestinationArn' | 'MaxNumberOfMessagesPerSecond'>,
  ): Promise<Pick<StartMessageMoveTaskCommandOutput, 'TaskHandle'>> {
    const response = await this.client.send(new StartMessageMoveTaskCommand(input));
    return { TaskHandle: response.TaskHandle };
  }

  async listMessageMoveTasks(
    input: Pick<ListMessageMoveTasksCommandInput, 'SourceArn' | 'MaxResults'>,
  ): Promise<Pick<ListMessageMoveTasksCommandOutput, 'Results'>> {
    const response = await this.client.send(new ListMessageMoveTasksCommand(input));
    return { Results: response.Results };
  }

  async cancelMessageMoveTask(
    input: Pick<CancelMessageMoveTaskCommandInput, 'TaskHandle'>,
  ): Promise<Pick<CancelMessageMoveTaskCommandOutput, 'ApproximateNumberOfMessagesMoved'>> {
    const response = await this.client.send(new CancelMessageMoveTaskCommand(input));
    return { ApproximateNumberOfMessagesMoved: response.ApproximateNumberOfMessagesMoved };
  }

  async sendMessage(input: SendMessageCommandInput): Promise<SendMessageCommandOutput> {
    return this.client.send(new SendMessageCommand(input));
  }

  async sendMessageBatch(input: SendMessageBatchCommandInput): Promise<SendMessageBatchCommandOutput> {
    return this.client.send(new SendMessageBatchCommand(input));
  }
}

export class AwsSnsAdapter implements SnsTransportClient {
  constructor(private readonly client: SNSClient) {}

  async listTopics(
    input: Pick<ListTopicsCommandInput, 'NextToken'>,
  ): Promise<Pick<ListTopicsCommandOutput, 'NextToken' | 'Topics'>> {
    const response = await this.client.send(new ListTopicsCommand(input));
    return { NextToken: response.NextToken, Topics: response.Topics };
  }

  async publish(input: PublishCommandInput): Promise<PublishCommandOutput> {
    return this.client.send(new PublishCommand(input));
  }

  async publishBatch(input: PublishBatchCommandInput): Promise<PublishBatchCommandOutput> {
    return this.client.send(new PublishBatchCommand(input));
  }
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

function normalizeSqsQueueResolutionInput(input: string | SqsQueueResolutionInput): NormalizedSqsQueueResolutionInput {
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

function createSqsQueueResolutionKey(queueName: string, ownerAccountId?: string): string {
  return ownerAccountId ? `${ownerAccountId}:${queueName}` : queueName;
}

function createSqsQueueNameCacheKey(queueName: string, ownerAccountId?: string): string {
  return ownerAccountId ? `${ownerAccountId}:${queueName}` : queueName;
}

function normalizeSqsQueueDiscoveryPageSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SQS_QUEUE_DISCOVERY_PAGE_SIZE;
  }

  return assertIntegerInRange(value, 'SQS queue discovery pageSize', 1, MAX_SQS_QUEUE_DISCOVERY_PAGE_SIZE);
}

function assertAwsAccountId(value: string, label: string): string {
  const normalized = assertNonEmptyIdentifier(value, label);
  if (!/^\d{12}$/.test(normalized)) {
    throw new Error(`${label} must be a 12-digit AWS account ID.`);
  }
  return normalized;
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

function readOptionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return assertNonEmptyText(value, label);
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must decode to a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function assertSnsEnvelopeType(value: unknown, label: string): SnsEnvelopeType {
  switch (value) {
    case 'Notification':
    case 'SubscriptionConfirmation':
    case 'UnsubscribeConfirmation':
      return value;
    default:
      throw new Error(`${label} Type must be Notification, SubscriptionConfirmation, or UnsubscribeConfirmation.`);
  }
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

function extractAccountIdFromArn(arn: string, service: string, label: string): string {
  if (!isArnForService(arn, service)) {
    throw new Error(`${label} must be a valid ${service.toUpperCase()} ARN.`);
  }

  const accountId = arn.split(':')[4];
  return assertAwsAccountId(accountId ?? '', `${label} account ID`);
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://');
}

function assertSqsQueueUrl(value: string, label: string): string {
  const normalized = assertNonEmptyIdentifier(value, label);
  if (!isHttpUrl(normalized)) {
    throw new Error(`${label} must be an SQS queue URL.`);
  }
  return normalized;
}

function assertSnsTopicArn(value: string, label: string): string {
  const normalized = assertNonEmptyIdentifier(value, label);
  if (!isArnForService(normalized, SNS_ARN_SERVICE)) {
    throw new Error(`${label} must be an SNS topic ARN.`);
  }
  return normalized;
}

function extractNameFromUrl(value: string, label: string): string {
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

function extractAccountIdFromSqsQueueUrl(value: string): string | undefined {
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

function assertUniqueBatchEntryIds<TId extends string>(entries: Array<{ id: TId }>, label: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const identifier = assertNonEmptyText(entry.id, label);
    if (seen.has(identifier)) {
      throw new Error(`Duplicate ${label} "${identifier}" is not allowed.`);
    }
    seen.add(identifier);
  }
}

function createInternalBatchEntryId(offset: number, index: number): string {
  return `entry-${offset + index}`;
}

function recordSuccessfulBatchEntries<TId extends string>(
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

function recordSimpleSuccessfulBatchEntries<TId extends string>(
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

function recordFailedBatchEntries<TId extends string>(
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

function recordSnsPublishSuccessfulBatchEntries<TId extends string>(
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

function createSimpleBatchResult<TId extends string>(
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

function validateSnsPublishEntry(
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

function validateSnsStructuredJsonMessage(message: SnsStructuredJsonMessage, label: string): void {
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

function readUnsupportedStructuredMessageAttributes(value: unknown): SnsMessageAttributes | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const messageAttributes = (value as { messageAttributes?: SnsMessageAttributes }).messageAttributes;
  return messageAttributes === undefined ? undefined : messageAttributes;
}

function assertIntegerInRange(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }

  return value;
}
