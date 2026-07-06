import type {
  ListTopicsCommandInput,
  ListTopicsCommandOutput,
  PublishBatchCommandInput,
  PublishBatchCommandOutput,
  PublishCommandInput,
  PublishCommandOutput,
  MessageAttributeValue as SnsSdkMessageAttributeValue,
} from '@aws-sdk/client-sns';
import type {
  ChangeMessageVisibilityBatchCommandInput,
  ChangeMessageVisibilityBatchCommandOutput,
  DeleteMessageBatchCommandInput,
  DeleteMessageBatchCommandOutput,
  GetQueueUrlCommandInput,
  GetQueueUrlCommandOutput,
  ListQueuesCommandInput,
  ListQueuesCommandOutput,
  SendMessageBatchCommandInput,
  SendMessageBatchCommandOutput,
  SendMessageCommandInput,
  SendMessageCommandOutput,
  MessageAttributeValue as SqsSdkMessageAttributeValue,
} from '@aws-sdk/client-sqs';

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

export interface PublisherSizeValidation {
  maxBytes?: number;
}

export type PublisherSizeValidationOverride = PublisherSizeValidation | false;

export type PublisherSerializer<TPayload> = (payload: TPayload) => string;

export interface SqsPublisherOptions {
  sizeValidation?: PublisherSizeValidation;
}

export interface SnsPublisherOptions {
  sizeValidation?: PublisherSizeValidation;
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
  sizeValidation?: PublisherSizeValidationOverride;
}

export interface SqsSendJsonBatchEntry<TId extends string = string, TPayload = unknown> extends SqsSendJsonOptions {
  id: TId;
  payload: TPayload;
}

export interface SqsSendJsonBatchInput<TId extends string = string, TPayload = unknown> {
  queue: string;
  entries: Array<SqsSendJsonBatchEntry<TId, TPayload>>;
  sizeValidation?: PublisherSizeValidationOverride;
}

export interface SqsSendStringOptions extends SqsSendJsonOptions {}

export interface SqsSendStringInput extends SqsSendStringOptions {
  queue: string;
  body: string;
  sizeValidation?: PublisherSizeValidationOverride;
}

export interface SqsSendStringBatchEntry<TId extends string = string> extends SqsSendStringOptions {
  id: TId;
  body: string;
}

export interface SqsSendStringBatchInput<TId extends string = string> {
  queue: string;
  entries: Array<SqsSendStringBatchEntry<TId>>;
  sizeValidation?: PublisherSizeValidationOverride;
}

export interface SqsSendSerializedOptions extends SqsSendJsonOptions {}

export interface SqsSendSerializedInput<TPayload> extends SqsSendSerializedOptions {
  queue: string;
  payload: TPayload;
  serialize: PublisherSerializer<TPayload>;
  sizeValidation?: PublisherSizeValidationOverride;
}

export interface SqsSendSerializedBatchEntry<TId extends string = string, TPayload = unknown>
  extends SqsSendSerializedOptions {
  id: TId;
  payload: TPayload;
}

export interface SqsSendSerializedBatchInput<TId extends string = string, TPayload = unknown> {
  queue: string;
  serialize: PublisherSerializer<TPayload>;
  entries: Array<SqsSendSerializedBatchEntry<TId, TPayload>>;
  sizeValidation?: PublisherSizeValidationOverride;
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
  sizeValidation?: PublisherSizeValidationOverride;
}

export interface SnsPublishStructuredJsonInput extends SnsPublishStructuredJsonOptions {
  topic: string;
  payload: SnsStructuredJsonMessage;
  sizeValidation?: PublisherSizeValidationOverride;
}

export interface SnsPublishJsonResult {
  topicArn: string;
  messageId?: string;
  sequenceNumber?: string;
}

export interface SnsPublishStringOptions extends SnsPublishJsonOptions {}

export interface SnsPublishStringInput extends SnsPublishStringOptions {
  topic: string;
  message: string;
  sizeValidation?: PublisherSizeValidationOverride;
}

export interface SnsPublishSerializedOptions extends SnsPublishJsonOptions {}

export interface SnsPublishSerializedInput<TPayload> extends SnsPublishSerializedOptions {
  topic: string;
  payload: TPayload;
  serialize: PublisherSerializer<TPayload>;
  sizeValidation?: PublisherSizeValidationOverride;
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
  sizeValidation?: PublisherSizeValidationOverride;
}

export interface SnsPublishStructuredJsonBatchInput<TId extends string = string> {
  topic: string;
  entries: Array<SnsPublishStructuredJsonBatchEntry<TId>>;
  sizeValidation?: PublisherSizeValidationOverride;
}

export interface SnsPublishStringBatchEntry<TId extends string = string> extends SnsPublishStringOptions {
  id: TId;
  message: string;
}

export interface SnsPublishStringBatchInput<TId extends string = string> {
  topic: string;
  entries: Array<SnsPublishStringBatchEntry<TId>>;
  sizeValidation?: PublisherSizeValidationOverride;
}

export interface SnsPublishSerializedBatchEntry<TId extends string = string, TPayload = unknown>
  extends SnsPublishSerializedOptions {
  id: TId;
  payload: TPayload;
}

export interface SnsPublishSerializedBatchInput<TId extends string = string, TPayload = unknown> {
  topic: string;
  serialize: PublisherSerializer<TPayload>;
  entries: Array<SnsPublishSerializedBatchEntry<TId, TPayload>>;
  sizeValidation?: PublisherSizeValidationOverride;
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

export type SnsStringArrayAttributeValue = string | number | boolean | null;
