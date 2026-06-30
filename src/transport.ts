import {
  ListTopicsCommand,
  type ListTopicsCommandInput,
  type ListTopicsCommandOutput,
  PublishCommand,
  type PublishCommandInput,
  type PublishCommandOutput,
  SNSClient,
  type MessageAttributeValue as SnsSdkMessageAttributeValue,
} from '@aws-sdk/client-sns';
import {
  type BatchResultErrorEntry,
  ChangeMessageVisibilityCommand,
  type ChangeMessageVisibilityCommandInput,
  DeleteMessageCommand,
  type DeleteMessageCommandInput,
  GetQueueUrlCommand,
  type GetQueueUrlCommandInput,
  type GetQueueUrlCommandOutput,
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
} from '@aws-sdk/client-sqs';
import type { SqsRuntimeClient, SqsRuntimeRequestOptions } from './core';

const SQS_ARN_SERVICE = 'sqs';
const SNS_ARN_SERVICE = 'sns';
const DEFAULT_SQS_JSON_LABEL = 'SQS message body';
const DEFAULT_SNS_ENVELOPE_LABEL = 'SNS envelope body';
const DEFAULT_SNS_NOTIFICATION_LABEL = 'SNS notification message';

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

export interface SqsQueueUrlResolverClient {
  getQueueUrl(input: Pick<GetQueueUrlCommandInput, 'QueueName'>): Promise<Pick<GetQueueUrlCommandOutput, 'QueueUrl'>>;
}

export interface SnsTopicArnResolverClient {
  listTopics(
    input: Pick<ListTopicsCommandInput, 'NextToken'>,
  ): Promise<Pick<ListTopicsCommandOutput, 'NextToken' | 'Topics'>>;
}

export interface SqsPublishClient {
  sendMessage(input: SendMessageCommandInput): Promise<SendMessageCommandOutput>;
  sendMessageBatch(input: SendMessageBatchCommandInput): Promise<SendMessageBatchCommandOutput>;
}

export interface SnsPublishClient {
  publish(input: PublishCommandInput): Promise<PublishCommandOutput>;
}

export type SqsTransportClient = SqsQueueUrlResolverClient & SqsPublishClient;
export type SnsTransportClient = SnsTopicArnResolverClient & SnsPublishClient;

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

export interface SnsPublishJsonOptions {
  subject?: string;
  messageAttributes?: SnsMessageAttributes;
  messageGroupId?: string;
  messageDeduplicationId?: string;
}

export interface SnsPublishJsonInput<TPayload> extends SnsPublishJsonOptions {
  topic: string;
  payload: TPayload;
}

export interface SnsPublishJsonResult {
  topicArn: string;
  messageId?: string;
  sequenceNumber?: string;
}

export interface SqsQueueUrlResolverOptions {
  preload?: Record<string, string>;
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
  }

  async resolve(queue: string): Promise<string> {
    const queueIdentifier = assertNonEmptyIdentifier(queue, 'SQS queue identifier');
    const cached = this.identifierCache.get(queueIdentifier);
    if (cached) {
      return cached;
    }

    if (isHttpUrl(queueIdentifier)) {
      const queueName = extractNameFromUrl(queueIdentifier, 'SQS queue URL');
      this.cacheResolution(queueIdentifier, queueName, queueIdentifier);
      return queueIdentifier;
    }

    const queueName = isArnForService(queueIdentifier, SQS_ARN_SERVICE)
      ? extractNameFromArn(queueIdentifier, SQS_ARN_SERVICE, 'SQS queue ARN')
      : queueIdentifier;

    const namedCacheHit = this.queueNameCache.get(queueName);
    if (namedCacheHit) {
      this.cacheResolution(queueIdentifier, queueName, namedCacheHit);
      return namedCacheHit;
    }

    if (!this.allowNetworkLookup) {
      throw new Error(
        `SQS queue "${queueIdentifier}" was not found in preloaded mappings and network lookup is disabled.`,
      );
    }

    const response = await this.client.getQueueUrl({ QueueName: queueName });
    const queueUrl = assertNonEmptyText(response.QueueUrl, `resolved queue URL for ${queueName}`);
    this.cacheResolution(queueIdentifier, queueName, queueUrl);
    return queueUrl;
  }

  private cacheResolution(identifier: string, queueName: string, queueUrl: string): void {
    this.identifierCache.set(identifier, queueUrl);
    this.identifierCache.set(queueName, queueUrl);
    this.identifierCache.set(queueUrl, queueUrl);
    this.queueNameCache.set(queueName, queueUrl);
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
      this.cacheResolution(normalizedIdentifier, queueName, queueUrl);
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
    assertUniqueBatchEntryIds(input.entries);
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
}

export class AwsSqsAdapter implements SqsTransportClient, SqsRuntimeClient {
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

  async getQueueUrl(
    input: Pick<GetQueueUrlCommandInput, 'QueueName'>,
  ): Promise<Pick<GetQueueUrlCommandOutput, 'QueueUrl'>> {
    const response = await this.client.send(new GetQueueUrlCommand(input));
    return { QueueUrl: response.QueueUrl };
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

function assertUniqueBatchEntryIds<TId extends string>(entries: Array<SqsSendJsonBatchEntry<TId, unknown>>): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const identifier = assertNonEmptyText(entry.id, 'SQS batch entry id');
    if (seen.has(identifier)) {
      throw new Error(`Duplicate SQS batch entry id "${identifier}" is not allowed.`);
    }
    seen.add(identifier);
  }
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

function recordFailedBatchEntries<TId extends string>(
  internalIdMap: Map<string, TId>,
  failedEntries: BatchResultErrorEntry[],
  failedById: Record<string, SqsSendJsonBatchFailure<TId>>,
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
