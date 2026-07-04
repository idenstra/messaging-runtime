import type { SqsWorkerHandler, SqsWorkerHandlerContext, SqsWorkerMessageAttributeValue } from './core';
import type {
  PublisherSerializer,
  PublisherSizeValidationOverride,
  SnsMessageAttributes,
  SnsPublisher,
  SnsStructuredJsonMessage,
  SqsMessageAttributes,
  SqsPublisher,
} from './transport';

type SyncOrAsync<T> = T | Promise<T>;

interface ForwardHandlerBaseOptions {
  copyMessageAttributes?: boolean;
  sizeValidation?: PublisherSizeValidationOverride;
}

export interface QueueForwardHandlerContext<TPayload> extends SqsWorkerHandlerContext<TPayload> {
  copiedMessageAttributes?: SqsMessageAttributes;
}

export interface TopicForwardHandlerContext<TPayload> extends SqsWorkerHandlerContext<TPayload> {
  copiedMessageAttributes?: SnsMessageAttributes;
}

export type QueueForwardMessageAttributeBuilder<TPayload> = (
  context: QueueForwardHandlerContext<TPayload>,
) => SyncOrAsync<SqsMessageAttributes | undefined>;

export type TopicForwardMessageAttributeBuilder<TPayload> = (
  context: TopicForwardHandlerContext<TPayload>,
) => SyncOrAsync<SnsMessageAttributes | undefined>;

export type QueueForwardValueBuilder<TPayload, TValue> =
  | TValue
  | ((context: QueueForwardHandlerContext<TPayload>) => SyncOrAsync<TValue>);

export type TopicForwardValueBuilder<TPayload, TValue> =
  | TValue
  | ((context: TopicForwardHandlerContext<TPayload>) => SyncOrAsync<TValue>);

export interface SqsForwardToQueueBaseOptions<TPayload> extends ForwardHandlerBaseOptions {
  publisher: SqsPublisher;
  queue: string;
  buildMessageAttributes?: QueueForwardMessageAttributeBuilder<TPayload>;
  delaySeconds?: QueueForwardValueBuilder<TPayload, number | undefined>;
  messageGroupId?: QueueForwardValueBuilder<TPayload, string | undefined>;
  messageDeduplicationId?: QueueForwardValueBuilder<TPayload, string | undefined>;
}

export interface SnsForwardToTopicBaseOptions<TPayload> extends ForwardHandlerBaseOptions {
  publisher: SnsPublisher;
  topic: string;
  buildMessageAttributes?: TopicForwardMessageAttributeBuilder<TPayload>;
  subject?: TopicForwardValueBuilder<TPayload, string | undefined>;
  messageGroupId?: TopicForwardValueBuilder<TPayload, string | undefined>;
  messageDeduplicationId?: TopicForwardValueBuilder<TPayload, string | undefined>;
}

export interface SqsJsonToQueueForwardHandlerOptions<TPayload, TForwardPayload = TPayload>
  extends SqsForwardToQueueBaseOptions<TPayload> {
  mapPayload?: (context: SqsWorkerHandlerContext<TPayload>) => SyncOrAsync<TForwardPayload>;
}

export interface SqsStringToQueueForwardHandlerOptions<TPayload> extends SqsForwardToQueueBaseOptions<TPayload> {
  mapBody?: (context: SqsWorkerHandlerContext<TPayload>) => SyncOrAsync<string>;
}

export interface SqsSerializedToQueueForwardHandlerOptions<TPayload, TForwardPayload = TPayload>
  extends SqsForwardToQueueBaseOptions<TPayload> {
  serialize: PublisherSerializer<TForwardPayload>;
  mapPayload?: (context: SqsWorkerHandlerContext<TPayload>) => SyncOrAsync<TForwardPayload>;
}

export interface SqsJsonToTopicForwardHandlerOptions<TPayload, TForwardPayload = TPayload>
  extends SnsForwardToTopicBaseOptions<TPayload> {
  mapPayload?: (context: SqsWorkerHandlerContext<TPayload>) => SyncOrAsync<TForwardPayload>;
}

export interface SqsStringToTopicForwardHandlerOptions<TPayload> extends SnsForwardToTopicBaseOptions<TPayload> {
  mapMessage?: (context: SqsWorkerHandlerContext<TPayload>) => SyncOrAsync<string>;
}

export interface SqsSerializedToTopicForwardHandlerOptions<TPayload, TForwardPayload = TPayload>
  extends SnsForwardToTopicBaseOptions<TPayload> {
  serialize: PublisherSerializer<TForwardPayload>;
  mapPayload?: (context: SqsWorkerHandlerContext<TPayload>) => SyncOrAsync<TForwardPayload>;
}

export interface SqsStructuredJsonToTopicForwardHandlerOptions<TPayload>
  extends Omit<SnsForwardToTopicBaseOptions<TPayload>, 'copyMessageAttributes' | 'buildMessageAttributes'> {
  mapPayload?: (context: SqsWorkerHandlerContext<TPayload>) => SyncOrAsync<SnsStructuredJsonMessage>;
}

export function sqsJsonToQueueForwardHandler<TPayload>(
  options: SqsJsonToQueueForwardHandlerOptions<TPayload>,
): SqsWorkerHandler<TPayload>;
export function sqsJsonToQueueForwardHandler<TPayload, TForwardPayload>(
  options: SqsJsonToQueueForwardHandlerOptions<TPayload, TForwardPayload>,
): SqsWorkerHandler<TPayload>;
export function sqsJsonToQueueForwardHandler<TPayload, TForwardPayload = TPayload>(
  options: SqsJsonToQueueForwardHandlerOptions<TPayload, TForwardPayload>,
): SqsWorkerHandler<TPayload> {
  return async (context) => {
    const publisherOptions = await buildQueuePublishOptions(context, options);
    const payload = options.mapPayload
      ? await options.mapPayload(context)
      : (context.payload as unknown as TForwardPayload);
    await options.publisher.sendJson({
      queue: assertNonEmptyText(options.queue, 'sqsJsonToQueueForwardHandler queue'),
      payload,
      ...publisherOptions,
    });
  };
}

export function sqsStringToQueueForwardHandler(
  options: SqsStringToQueueForwardHandlerOptions<string>,
): SqsWorkerHandler<string>;
export function sqsStringToQueueForwardHandler<TPayload>(
  options: SqsStringToQueueForwardHandlerOptions<TPayload> & {
    mapBody: (context: SqsWorkerHandlerContext<TPayload>) => SyncOrAsync<string>;
  },
): SqsWorkerHandler<TPayload>;
export function sqsStringToQueueForwardHandler<TPayload>(
  options: SqsStringToQueueForwardHandlerOptions<TPayload>,
): SqsWorkerHandler<TPayload> {
  return async (context) => {
    const publisherOptions = await buildQueuePublishOptions(context, options);
    const body =
      options.mapBody !== undefined
        ? await options.mapBody(context)
        : readStringPayload(context.payload, 'sqsStringToQueueForwardHandler payload');
    await options.publisher.sendString({
      queue: assertNonEmptyText(options.queue, 'sqsStringToQueueForwardHandler queue'),
      body,
      ...publisherOptions,
    });
  };
}

export function sqsSerializedToQueueForwardHandler<TPayload>(
  options: SqsSerializedToQueueForwardHandlerOptions<TPayload>,
): SqsWorkerHandler<TPayload>;
export function sqsSerializedToQueueForwardHandler<TPayload, TForwardPayload>(
  options: SqsSerializedToQueueForwardHandlerOptions<TPayload, TForwardPayload>,
): SqsWorkerHandler<TPayload>;
export function sqsSerializedToQueueForwardHandler<TPayload, TForwardPayload = TPayload>(
  options: SqsSerializedToQueueForwardHandlerOptions<TPayload, TForwardPayload>,
): SqsWorkerHandler<TPayload> {
  return async (context) => {
    const publisherOptions = await buildQueuePublishOptions(context, options);
    const payload = options.mapPayload
      ? await options.mapPayload(context)
      : (context.payload as unknown as TForwardPayload);
    await options.publisher.sendSerialized({
      queue: assertNonEmptyText(options.queue, 'sqsSerializedToQueueForwardHandler queue'),
      payload,
      serialize: options.serialize,
      ...publisherOptions,
    });
  };
}

export function sqsJsonToTopicForwardHandler<TPayload>(
  options: SqsJsonToTopicForwardHandlerOptions<TPayload>,
): SqsWorkerHandler<TPayload>;
export function sqsJsonToTopicForwardHandler<TPayload, TForwardPayload>(
  options: SqsJsonToTopicForwardHandlerOptions<TPayload, TForwardPayload>,
): SqsWorkerHandler<TPayload>;
export function sqsJsonToTopicForwardHandler<TPayload, TForwardPayload = TPayload>(
  options: SqsJsonToTopicForwardHandlerOptions<TPayload, TForwardPayload>,
): SqsWorkerHandler<TPayload> {
  return async (context) => {
    const publisherOptions = await buildTopicPublishOptions(context, options);
    const payload = options.mapPayload
      ? await options.mapPayload(context)
      : (context.payload as unknown as TForwardPayload);
    await options.publisher.publishJson({
      topic: assertNonEmptyText(options.topic, 'sqsJsonToTopicForwardHandler topic'),
      payload,
      ...publisherOptions,
    });
  };
}

export function sqsStringToTopicForwardHandler(
  options: SqsStringToTopicForwardHandlerOptions<string>,
): SqsWorkerHandler<string>;
export function sqsStringToTopicForwardHandler<TPayload>(
  options: SqsStringToTopicForwardHandlerOptions<TPayload> & {
    mapMessage: (context: SqsWorkerHandlerContext<TPayload>) => SyncOrAsync<string>;
  },
): SqsWorkerHandler<TPayload>;
export function sqsStringToTopicForwardHandler<TPayload>(
  options: SqsStringToTopicForwardHandlerOptions<TPayload>,
): SqsWorkerHandler<TPayload> {
  return async (context) => {
    const publisherOptions = await buildTopicPublishOptions(context, options);
    const message =
      options.mapMessage !== undefined
        ? await options.mapMessage(context)
        : readStringPayload(context.payload, 'sqsStringToTopicForwardHandler payload');
    await options.publisher.publishString({
      topic: assertNonEmptyText(options.topic, 'sqsStringToTopicForwardHandler topic'),
      message,
      ...publisherOptions,
    });
  };
}

export function sqsSerializedToTopicForwardHandler<TPayload>(
  options: SqsSerializedToTopicForwardHandlerOptions<TPayload>,
): SqsWorkerHandler<TPayload>;
export function sqsSerializedToTopicForwardHandler<TPayload, TForwardPayload>(
  options: SqsSerializedToTopicForwardHandlerOptions<TPayload, TForwardPayload>,
): SqsWorkerHandler<TPayload>;
export function sqsSerializedToTopicForwardHandler<TPayload, TForwardPayload = TPayload>(
  options: SqsSerializedToTopicForwardHandlerOptions<TPayload, TForwardPayload>,
): SqsWorkerHandler<TPayload> {
  return async (context) => {
    const publisherOptions = await buildTopicPublishOptions(context, options);
    const payload = options.mapPayload
      ? await options.mapPayload(context)
      : (context.payload as unknown as TForwardPayload);
    await options.publisher.publishSerialized({
      topic: assertNonEmptyText(options.topic, 'sqsSerializedToTopicForwardHandler topic'),
      payload,
      serialize: options.serialize,
      ...publisherOptions,
    });
  };
}

export function sqsStructuredJsonToTopicForwardHandler(
  options: SqsStructuredJsonToTopicForwardHandlerOptions<SnsStructuredJsonMessage> & { mapPayload?: undefined },
): SqsWorkerHandler<SnsStructuredJsonMessage>;
export function sqsStructuredJsonToTopicForwardHandler<TPayload>(
  options: SqsStructuredJsonToTopicForwardHandlerOptions<TPayload> & {
    mapPayload: (context: SqsWorkerHandlerContext<TPayload>) => SyncOrAsync<SnsStructuredJsonMessage>;
  },
): SqsWorkerHandler<TPayload>;
export function sqsStructuredJsonToTopicForwardHandler<TPayload>(
  options: SqsStructuredJsonToTopicForwardHandlerOptions<TPayload>,
): SqsWorkerHandler<TPayload> {
  return async (context) => {
    const publisherOptions = await buildStructuredTopicPublishOptions(context, options);
    const payload =
      options.mapPayload !== undefined
        ? await options.mapPayload(context)
        : readStructuredPayload(context.payload, 'sqsStructuredJsonToTopicForwardHandler payload');
    await options.publisher.publishStructuredJson({
      topic: assertNonEmptyText(options.topic, 'sqsStructuredJsonToTopicForwardHandler topic'),
      payload,
      ...publisherOptions,
    });
  };
}

async function buildQueuePublishOptions<TPayload>(
  context: SqsWorkerHandlerContext<TPayload>,
  options: SqsForwardToQueueBaseOptions<TPayload>,
): Promise<{
  delaySeconds?: number;
  messageAttributes?: SqsMessageAttributes;
  messageGroupId?: string;
  messageDeduplicationId?: string;
  sizeValidation?: PublisherSizeValidationOverride;
}> {
  const copiedMessageAttributes = options.copyMessageAttributes
    ? copyInboundMessageAttributesToSqs(context.message.messageAttributes, context.routeName)
    : undefined;
  const builderContext: QueueForwardHandlerContext<TPayload> = { ...context, copiedMessageAttributes };
  return {
    delaySeconds: await readOptionalValue(options.delaySeconds, builderContext),
    messageAttributes: await buildQueueMessageAttributes(builderContext, options.buildMessageAttributes),
    messageGroupId: await readOptionalValue(options.messageGroupId, builderContext),
    messageDeduplicationId: await readOptionalValue(options.messageDeduplicationId, builderContext),
    sizeValidation: options.sizeValidation,
  };
}

async function buildTopicPublishOptions<TPayload>(
  context: SqsWorkerHandlerContext<TPayload>,
  options: SnsForwardToTopicBaseOptions<TPayload>,
): Promise<{
  subject?: string;
  messageAttributes?: SnsMessageAttributes;
  messageGroupId?: string;
  messageDeduplicationId?: string;
  sizeValidation?: PublisherSizeValidationOverride;
}> {
  const copiedMessageAttributes = options.copyMessageAttributes
    ? copyInboundMessageAttributesToSns(context.message.messageAttributes, context.routeName)
    : undefined;
  const builderContext: TopicForwardHandlerContext<TPayload> = { ...context, copiedMessageAttributes };
  return {
    subject: await readOptionalValue(options.subject, builderContext),
    messageAttributes: await buildTopicMessageAttributes(builderContext, options.buildMessageAttributes),
    messageGroupId: await readOptionalValue(options.messageGroupId, builderContext),
    messageDeduplicationId: await readOptionalValue(options.messageDeduplicationId, builderContext),
    sizeValidation: options.sizeValidation,
  };
}

async function buildStructuredTopicPublishOptions<TPayload>(
  context: SqsWorkerHandlerContext<TPayload>,
  options: Omit<SnsForwardToTopicBaseOptions<TPayload>, 'copyMessageAttributes' | 'buildMessageAttributes'>,
): Promise<{
  subject?: string;
  messageGroupId?: string;
  messageDeduplicationId?: string;
  sizeValidation?: PublisherSizeValidationOverride;
}> {
  const builderContext: TopicForwardHandlerContext<TPayload> = { ...context };
  return {
    subject: await readOptionalValue(options.subject, builderContext),
    messageGroupId: await readOptionalValue(options.messageGroupId, builderContext),
    messageDeduplicationId: await readOptionalValue(options.messageDeduplicationId, builderContext),
    sizeValidation: options.sizeValidation,
  };
}

async function buildQueueMessageAttributes<TPayload>(
  context: QueueForwardHandlerContext<TPayload>,
  buildMessageAttributes: QueueForwardMessageAttributeBuilder<TPayload> | undefined,
): Promise<SqsMessageAttributes | undefined> {
  if (!buildMessageAttributes) {
    return context.copiedMessageAttributes;
  }

  return buildMessageAttributes(context);
}

async function buildTopicMessageAttributes<TPayload>(
  context: TopicForwardHandlerContext<TPayload>,
  buildMessageAttributes: TopicForwardMessageAttributeBuilder<TPayload> | undefined,
): Promise<SnsMessageAttributes | undefined> {
  if (!buildMessageAttributes) {
    return context.copiedMessageAttributes;
  }

  return buildMessageAttributes(context);
}

async function readOptionalValue<TContext, TValue>(
  value: TValue | ((context: TContext) => SyncOrAsync<TValue>) | undefined,
  context: TContext,
): Promise<TValue | undefined> {
  if (typeof value === 'function') {
    return (value as (context: TContext) => SyncOrAsync<TValue>)(context);
  }

  return value;
}

function copyInboundMessageAttributesToSqs(
  attributes: Record<string, SqsWorkerMessageAttributeValue>,
  routeName: string,
): SqsMessageAttributes {
  const copied: SqsMessageAttributes = {};

  for (const [attributeName, attributeValue] of Object.entries(attributes)) {
    copied[attributeName] = convertInboundAttributeForSqs(attributeName, attributeValue, routeName);
  }

  return copied;
}

function copyInboundMessageAttributesToSns(
  attributes: Record<string, SqsWorkerMessageAttributeValue>,
  routeName: string,
): SnsMessageAttributes {
  const copied: SnsMessageAttributes = {};

  for (const [attributeName, attributeValue] of Object.entries(attributes)) {
    copied[attributeName] = convertInboundAttributeForSns(attributeName, attributeValue, routeName);
  }

  return copied;
}

function convertInboundAttributeForSqs(
  attributeName: string,
  attributeValue: SqsWorkerMessageAttributeValue,
  routeName: string,
): SqsMessageAttributes[string] {
  const dataType = assertInboundAttributeDataType(attributeName, attributeValue, routeName);
  if (dataType === 'String.Array') {
    throw new Error(
      `Route ${routeName} cannot copy inbound message attribute ${attributeName} into an SQS publish request because SQS does not support String.Array attributes.`,
    );
  }
  assertNoListValues(attributeName, attributeValue, routeName);
  return { DataType: dataType, StringValue: attributeValue.stringValue, BinaryValue: attributeValue.binaryValue };
}

function convertInboundAttributeForSns(
  attributeName: string,
  attributeValue: SqsWorkerMessageAttributeValue,
  routeName: string,
): SnsMessageAttributes[string] {
  const dataType = assertInboundAttributeDataType(attributeName, attributeValue, routeName);
  assertNoListValues(attributeName, attributeValue, routeName);
  return { DataType: dataType, StringValue: attributeValue.stringValue, BinaryValue: attributeValue.binaryValue };
}

function assertInboundAttributeDataType(
  attributeName: string,
  attributeValue: SqsWorkerMessageAttributeValue,
  routeName: string,
): string {
  if (!attributeValue.dataType?.trim()) {
    throw new Error(`Route ${routeName} cannot copy inbound message attribute ${attributeName} without a DataType.`);
  }

  const hasStringValue = attributeValue.stringValue !== undefined;
  const hasBinaryValue = attributeValue.binaryValue !== undefined;
  if (hasStringValue === hasBinaryValue) {
    throw new Error(
      `Route ${routeName} cannot copy inbound message attribute ${attributeName} because it must contain exactly one of stringValue or binaryValue.`,
    );
  }

  return attributeValue.dataType.trim();
}

function assertNoListValues(
  attributeName: string,
  attributeValue: SqsWorkerMessageAttributeValue,
  routeName: string,
): void {
  if ((attributeValue.stringListValues?.length ?? 0) > 0 || (attributeValue.binaryListValues?.length ?? 0) > 0) {
    throw new Error(
      `Route ${routeName} cannot copy inbound message attribute ${attributeName} because list-valued message attributes are not supported by the forwarding helpers.`,
    );
  }
}

function readStringPayload(payload: unknown, label: string): string {
  return assertNonEmptyText(payload, `${label} must be a non-empty string`);
}

function readStructuredPayload(payload: unknown, label: string): SnsStructuredJsonMessage {
  if (!isStructuredJsonMessage(payload)) {
    throw new Error(`${label} must be an SNS structured JSON message or provide mapPayload.`);
  }

  return payload;
}

function isStructuredJsonMessage(payload: unknown): payload is SnsStructuredJsonMessage {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const typedPayload = payload as Partial<SnsStructuredJsonMessage>;
  return typeof typedPayload.default === 'string' && typedPayload.default.trim().length > 0;
}

function assertNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(label);
  }

  return value.trim();
}
