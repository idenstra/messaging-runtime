import { assertIntegerInRange, assertNonEmptyText } from './assertions';
import {
  assertUniqueBatchEntryIds,
  createInternalBatchEntryId,
  createSimpleBatchResult,
  recordFailedBatchEntries,
  recordSimpleSuccessfulBatchEntries,
  recordSnsPublishSuccessfulBatchEntries,
  recordSuccessfulBatchEntries,
} from './batch-results';
import {
  createSnsPublishBatchRequestEntry,
  createSnsPublishCommandInput,
  DEFAULT_SNS_PUBLISH_MAX_BYTES,
  DEFAULT_SQS_PUBLISH_MAX_BYTES,
  type PreparedSnsPublishRequest,
  type PreparedSqsPublishRequest,
  readUnsupportedStructuredMessageAttributes,
  resolveSizeValidation,
  serializeJsonPayload,
  serializeWithSerializer,
  validateSnsPublishEntry,
  validateSnsPublishRequestSize,
  validateSnsStructuredJsonMessage,
  validateSqsPublishRequestSize,
} from './publish-support';
import { SnsTopicArnResolver, SqsQueueUrlResolver } from './resolvers';
import type {
  SnsPublisherOptions,
  SnsPublishJsonBatchInput,
  SnsPublishJsonBatchResult,
  SnsPublishJsonBatchSuccess,
  SnsPublishJsonInput,
  SnsPublishJsonResult,
  SnsPublishSerializedBatchInput,
  SnsPublishSerializedInput,
  SnsPublishStringBatchInput,
  SnsPublishStringInput,
  SnsPublishStructuredJsonBatchInput,
  SnsPublishStructuredJsonInput,
  SnsTransportClient,
  SqsBatchOperationClient,
  SqsBatchOperationFailure,
  SqsBatchOperationSuccess,
  SqsChangeMessageVisibilityInput,
  SqsChangeMessageVisibilityResult,
  SqsDeleteMessagesInput,
  SqsDeleteMessagesResult,
  SqsPublisherOptions,
  SqsQueueUrlResolverClient,
  SqsSendJsonBatchInput,
  SqsSendJsonBatchResult,
  SqsSendJsonBatchSuccess,
  SqsSendJsonInput,
  SqsSendJsonResult,
  SqsSendSerializedBatchInput,
  SqsSendSerializedInput,
  SqsSendStringBatchInput,
  SqsSendStringInput,
  SqsTransportClient,
} from './types';

export class SqsPublisher {
  private readonly resolver: SqsQueueUrlResolver;
  private readonly sizeValidationDefaults;

  constructor(
    private readonly client: SqsTransportClient,
    resolver?: SqsQueueUrlResolver,
    options: SqsPublisherOptions = {},
  ) {
    this.resolver = resolver ?? new SqsQueueUrlResolver(client);
    this.sizeValidationDefaults = options.sizeValidation;
  }

  async sendJson<TPayload>(input: SqsSendJsonInput<TPayload>): Promise<SqsSendJsonResult> {
    return this.sendPrepared(
      input.queue,
      {
        body: serializeJsonPayload(input.payload, 'SQS publish payload'),
        delaySeconds: input.delaySeconds,
        messageAttributes: input.messageAttributes,
        messageGroupId: input.messageGroupId,
        messageDeduplicationId: input.messageDeduplicationId,
      },
      input.sizeValidation,
      'SQS publish request',
    );
  }

  async sendString(input: SqsSendStringInput): Promise<SqsSendJsonResult> {
    return this.sendPrepared(
      input.queue,
      {
        body: assertNonEmptyText(input.body, 'SQS publish body'),
        delaySeconds: input.delaySeconds,
        messageAttributes: input.messageAttributes,
        messageGroupId: input.messageGroupId,
        messageDeduplicationId: input.messageDeduplicationId,
      },
      input.sizeValidation,
      'SQS string publish request',
    );
  }

  async sendSerialized<TPayload>(input: SqsSendSerializedInput<TPayload>): Promise<SqsSendJsonResult> {
    return this.sendPrepared(
      input.queue,
      {
        body: serializeWithSerializer(input.payload, input.serialize, 'SQS serialized publish payload'),
        delaySeconds: input.delaySeconds,
        messageAttributes: input.messageAttributes,
        messageGroupId: input.messageGroupId,
        messageDeduplicationId: input.messageDeduplicationId,
      },
      input.sizeValidation,
      'SQS serialized publish request',
    );
  }

  async sendJsonBatch<TId extends string, TPayload>(
    input: SqsSendJsonBatchInput<TId, TPayload>,
  ): Promise<SqsSendJsonBatchResult<TId>> {
    return this.sendBatchPrepared(input, (entry) => ({
      body: serializeJsonPayload(entry.payload, `SQS batch publish entry ${entry.id} payload`),
      delaySeconds: entry.delaySeconds,
      messageAttributes: entry.messageAttributes,
      messageGroupId: entry.messageGroupId,
      messageDeduplicationId: entry.messageDeduplicationId,
    }));
  }

  async sendStringBatch<TId extends string>(input: SqsSendStringBatchInput<TId>): Promise<SqsSendJsonBatchResult<TId>> {
    return this.sendBatchPrepared(input, (entry) => ({
      body: assertNonEmptyText(entry.body, `body for SQS string batch publish entry ${entry.id}`),
      delaySeconds: entry.delaySeconds,
      messageAttributes: entry.messageAttributes,
      messageGroupId: entry.messageGroupId,
      messageDeduplicationId: entry.messageDeduplicationId,
    }));
  }

  async sendSerializedBatch<TId extends string, TPayload>(
    input: SqsSendSerializedBatchInput<TId, TPayload>,
  ): Promise<SqsSendJsonBatchResult<TId>> {
    return this.sendBatchPrepared(input, (entry) => ({
      body: serializeWithSerializer(
        entry.payload,
        input.serialize,
        `SQS serialized batch publish entry ${entry.id} payload`,
      ),
      delaySeconds: entry.delaySeconds,
      messageAttributes: entry.messageAttributes,
      messageGroupId: entry.messageGroupId,
      messageDeduplicationId: entry.messageDeduplicationId,
    }));
  }

  private async sendPrepared(
    queue: string,
    prepared: PreparedSqsPublishRequest,
    sizeValidationOverride: import('./types').PublisherSizeValidationOverride | undefined,
    label: string,
  ): Promise<SqsSendJsonResult> {
    const queueUrl = await this.resolver.resolve(queue);
    validateSqsPublishRequestSize(
      prepared.body,
      prepared.messageAttributes,
      resolveSizeValidation(
        this.sizeValidationDefaults,
        sizeValidationOverride,
        `${label} sizeValidation`,
        DEFAULT_SQS_PUBLISH_MAX_BYTES,
      ),
      label,
    );
    const response = await this.client.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: prepared.body,
      DelaySeconds: prepared.delaySeconds,
      MessageAttributes: prepared.messageAttributes,
      MessageGroupId: prepared.messageGroupId,
      MessageDeduplicationId: prepared.messageDeduplicationId,
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

  private async sendBatchPrepared<TId extends string, TEntry extends { id: TId }>(
    input: { queue: string; entries: TEntry[]; sizeValidation?: import('./types').PublisherSizeValidationOverride },
    prepareEntry: (entry: TEntry) => PreparedSqsPublishRequest,
  ): Promise<SqsSendJsonBatchResult<TId>> {
    assertUniqueBatchEntryIds(input.entries, 'SQS batch publish entry id');
    const queueUrl = await this.resolver.resolve(input.queue);
    const sizeValidation = resolveSizeValidation(
      this.sizeValidationDefaults,
      input.sizeValidation,
      'SQS batch publish sizeValidation',
      DEFAULT_SQS_PUBLISH_MAX_BYTES,
    );
    const successfulById: Record<string, SqsSendJsonBatchSuccess<TId>> = {};
    const failedById: Record<string, import('./types').SqsSendJsonBatchFailure<TId>> = {};

    for (let offset = 0; offset < input.entries.length; offset += 10) {
      const chunk = input.entries.slice(offset, offset + 10);
      const internalIdMap = new Map<string, TId>();
      const response = await this.client.sendMessageBatch({
        QueueUrl: queueUrl,
        Entries: chunk.map((entry, index) => {
          const internalId = `entry-${offset + index}`;
          internalIdMap.set(internalId, entry.id);
          const prepared = prepareEntry(entry);
          validateSqsPublishRequestSize(
            prepared.body,
            prepared.messageAttributes,
            sizeValidation,
            `SQS batch publish entry ${entry.id}`,
          );

          return {
            Id: internalId,
            MessageBody: prepared.body,
            DelaySeconds: prepared.delaySeconds,
            MessageAttributes: prepared.messageAttributes,
            MessageGroupId: prepared.messageGroupId,
            MessageDeduplicationId: prepared.messageDeduplicationId,
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
  private readonly sizeValidationDefaults;

  constructor(
    private readonly client: SnsTransportClient,
    resolver?: SnsTopicArnResolver,
    options: SnsPublisherOptions = {},
  ) {
    this.resolver = resolver ?? new SnsTopicArnResolver(client);
    this.sizeValidationDefaults = options.sizeValidation;
  }

  async publishJson<TPayload>(input: SnsPublishJsonInput<TPayload>): Promise<SnsPublishJsonResult> {
    return this.publishPrepared(
      input.topic,
      {
        message: serializeJsonPayload(input.payload, 'SNS publish payload'),
        subject: input.subject,
        messageAttributes: input.messageAttributes,
        messageGroupId: input.messageGroupId,
        messageDeduplicationId: input.messageDeduplicationId,
      },
      input.sizeValidation,
      { label: 'SNS publish request', structuredJson: false },
    );
  }

  async publishString(input: SnsPublishStringInput): Promise<SnsPublishJsonResult> {
    return this.publishPrepared(
      input.topic,
      {
        message: assertNonEmptyText(input.message, 'SNS publish message'),
        subject: input.subject,
        messageAttributes: input.messageAttributes,
        messageGroupId: input.messageGroupId,
        messageDeduplicationId: input.messageDeduplicationId,
      },
      input.sizeValidation,
      { label: 'SNS string publish request', structuredJson: false },
    );
  }

  async publishSerialized<TPayload>(input: SnsPublishSerializedInput<TPayload>): Promise<SnsPublishJsonResult> {
    return this.publishPrepared(
      input.topic,
      {
        message: serializeWithSerializer(input.payload, input.serialize, 'SNS serialized publish payload'),
        subject: input.subject,
        messageAttributes: input.messageAttributes,
        messageGroupId: input.messageGroupId,
        messageDeduplicationId: input.messageDeduplicationId,
      },
      input.sizeValidation,
      { label: 'SNS serialized publish request', structuredJson: false },
    );
  }

  async publishStructuredJson(input: SnsPublishStructuredJsonInput): Promise<SnsPublishJsonResult> {
    validateSnsStructuredJsonMessage(input.payload, 'SNS structured publish payload');
    return this.publishPrepared(
      input.topic,
      {
        message: JSON.stringify(input.payload),
        messageStructure: 'json',
        subject: input.subject,
        messageAttributes: readUnsupportedStructuredMessageAttributes(input),
        messageGroupId: input.messageGroupId,
        messageDeduplicationId: input.messageDeduplicationId,
      },
      input.sizeValidation,
      { label: 'SNS structured publish request', structuredJson: true },
    );
  }

  async publishJsonBatch<TId extends string, TPayload>(
    input: SnsPublishJsonBatchInput<TId, TPayload>,
  ): Promise<SnsPublishJsonBatchResult<TId>> {
    return this.publishBatchPrepared(input, (entry) => ({
      message: serializeJsonPayload(entry.payload, `SNS batch publish entry ${entry.id} payload`),
      subject: entry.subject,
      messageAttributes: entry.messageAttributes,
      messageGroupId: entry.messageGroupId,
      messageDeduplicationId: entry.messageDeduplicationId,
    }));
  }

  async publishStringBatch<TId extends string>(
    input: SnsPublishStringBatchInput<TId>,
  ): Promise<SnsPublishJsonBatchResult<TId>> {
    return this.publishBatchPrepared(input, (entry) => ({
      message: assertNonEmptyText(entry.message, `message for SNS string batch publish entry ${entry.id}`),
      subject: entry.subject,
      messageAttributes: entry.messageAttributes,
      messageGroupId: entry.messageGroupId,
      messageDeduplicationId: entry.messageDeduplicationId,
    }));
  }

  async publishSerializedBatch<TId extends string, TPayload>(
    input: SnsPublishSerializedBatchInput<TId, TPayload>,
  ): Promise<SnsPublishJsonBatchResult<TId>> {
    return this.publishBatchPrepared(input, (entry) => ({
      message: serializeWithSerializer(
        entry.payload,
        input.serialize,
        `SNS serialized batch publish entry ${entry.id} payload`,
      ),
      subject: entry.subject,
      messageAttributes: entry.messageAttributes,
      messageGroupId: entry.messageGroupId,
      messageDeduplicationId: entry.messageDeduplicationId,
    }));
  }

  async publishStructuredJsonBatch<TId extends string>(
    input: SnsPublishStructuredJsonBatchInput<TId>,
  ): Promise<SnsPublishJsonBatchResult<TId>> {
    return this.publishBatchPrepared(
      input,
      (entry) => {
        validateSnsStructuredJsonMessage(entry.payload, `SNS structured batch publish payload ${entry.id}`);
        return {
          message: JSON.stringify(entry.payload),
          messageStructure: 'json',
          subject: entry.subject,
          messageAttributes: readUnsupportedStructuredMessageAttributes(entry),
          messageGroupId: entry.messageGroupId,
          messageDeduplicationId: entry.messageDeduplicationId,
        };
      },
      { structuredJson: true, labelPrefix: 'SNS structured batch publish entry' },
    );
  }

  private async publishPrepared(
    topic: string,
    prepared: PreparedSnsPublishRequest,
    sizeValidationOverride: import('./types').PublisherSizeValidationOverride | undefined,
    context: { label: string; structuredJson: boolean },
  ): Promise<SnsPublishJsonResult> {
    const topicArn = await this.resolver.resolve(topic);
    validateSnsPublishEntry(prepared, { topicArn, label: context.label, structuredJson: context.structuredJson });
    validateSnsPublishRequestSize(
      prepared.message,
      prepared.messageAttributes,
      prepared.subject,
      resolveSizeValidation(
        this.sizeValidationDefaults,
        sizeValidationOverride,
        `${context.label} sizeValidation`,
        DEFAULT_SNS_PUBLISH_MAX_BYTES,
      ),
      context.label,
    );
    const response = await this.client.publish(
      createSnsPublishCommandInput(topicArn, prepared, { includeMessageAttributes: !context.structuredJson }),
    );

    return { topicArn, messageId: response.MessageId, sequenceNumber: response.SequenceNumber };
  }

  private async publishBatchPrepared<TId extends string, TEntry extends { id: TId }>(
    input: { topic: string; entries: TEntry[]; sizeValidation?: import('./types').PublisherSizeValidationOverride },
    prepareEntry: (entry: TEntry) => PreparedSnsPublishRequest,
    options: { structuredJson?: boolean; labelPrefix?: string } = {},
  ): Promise<SnsPublishJsonBatchResult<TId>> {
    assertUniqueBatchEntryIds(input.entries, 'SNS batch publish entry id');
    const topicArn = await this.resolver.resolve(input.topic);
    const sizeValidation = resolveSizeValidation(
      this.sizeValidationDefaults,
      input.sizeValidation,
      'SNS batch publish sizeValidation',
      DEFAULT_SNS_PUBLISH_MAX_BYTES,
    );
    const successfulById: Record<string, SnsPublishJsonBatchSuccess<TId>> = {};
    const failedById: Record<string, import('./types').SnsPublishJsonBatchFailure<TId>> = {};

    for (let offset = 0; offset < input.entries.length; offset += 10) {
      const chunk = input.entries.slice(offset, offset + 10);
      const internalIdMap = new Map<string, TId>();
      const response = await this.client.publishBatch({
        TopicArn: topicArn,
        PublishBatchRequestEntries: chunk.map((entry, index) => {
          const internalId = createInternalBatchEntryId(offset, index);
          internalIdMap.set(internalId, entry.id);
          const prepared = prepareEntry(entry);
          const label = `${options.labelPrefix ?? 'SNS batch publish entry'} ${entry.id}`;
          validateSnsPublishEntry(prepared, { topicArn, label, structuredJson: options.structuredJson ?? false });
          validateSnsPublishRequestSize(
            prepared.message,
            prepared.messageAttributes,
            prepared.subject,
            sizeValidation,
            label,
          );

          return createSnsPublishBatchRequestEntry(internalId, prepared, {
            includeMessageAttributes: !(options.structuredJson ?? false),
          });
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
