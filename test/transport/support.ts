import type { ListTopicsCommandInput, PublishBatchCommandInput } from '@aws-sdk/client-sns';
import type {
  ChangeMessageVisibilityBatchCommandInput,
  DeleteMessageBatchCommandInput,
  GetQueueUrlCommandInput,
  ListQueuesCommandInput,
  SendMessageBatchCommandInput,
  SendMessageCommandInput,
  MessageAttributeValue as SqsMessageAttributeValue,
} from '@aws-sdk/client-sqs';
import type { SnsTransportClient, SqsTransportClient } from '../../src';

export class FakeSqsTransportClient implements SqsTransportClient {
  readonly getQueueUrlInputs: GetQueueUrlCommandInput[] = [];
  readonly listQueuesInputs: ListQueuesCommandInput[] = [];
  readonly sendMessageInputs: SendMessageCommandInput[] = [];
  readonly sendMessageBatchInputs: SendMessageBatchCommandInput[] = [];
  readonly deleteMessageBatchInputs: DeleteMessageBatchCommandInput[] = [];
  readonly changeMessageVisibilityBatchInputs: ChangeMessageVisibilityBatchCommandInput[] = [];
  private readonly queueUrls = new Map<string, string>();
  private readonly listQueuesResponses: Array<{ QueueUrls?: string[]; NextToken?: string }> = [];
  private readonly batchResponses: Array<{
    Successful?: Array<{
      Id?: string;
      MessageId?: string;
      SequenceNumber?: string;
      MD5OfMessageBody?: string;
      MD5OfMessageAttributes?: string;
      MD5OfMessageSystemAttributes?: string;
    }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }> = [];
  private readonly deleteBatchResponses: Array<{
    Successful?: Array<{ Id?: string }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }> = [];
  private readonly visibilityBatchResponses: Array<{
    Successful?: Array<{ Id?: string }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }> = [];

  withQueueUrl(queueName: string, queueUrl: string, ownerAccountId?: string): this {
    this.queueUrls.set(createQueueLookupKey(queueName, ownerAccountId), queueUrl);
    return this;
  }

  withListQueuesResponse(response: { QueueUrls?: string[]; NextToken?: string }): this {
    this.listQueuesResponses.push(response);
    return this;
  }

  withBatchResponse(response: {
    Successful?: Array<{
      Id?: string;
      MessageId?: string;
      SequenceNumber?: string;
      MD5OfMessageBody?: string;
      MD5OfMessageAttributes?: string;
      MD5OfMessageSystemAttributes?: string;
    }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }): this {
    this.batchResponses.push(response);
    return this;
  }

  withDeleteBatchResponse(response: {
    Successful?: Array<{ Id?: string }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }): this {
    this.deleteBatchResponses.push(response);
    return this;
  }

  withVisibilityBatchResponse(response: {
    Successful?: Array<{ Id?: string }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }): this {
    this.visibilityBatchResponses.push(response);
    return this;
  }

  async getQueueUrl(input: GetQueueUrlCommandInput) {
    this.getQueueUrlInputs.push(input);
    return {
      QueueUrl:
        input.QueueName === undefined
          ? undefined
          : this.queueUrls.get(createQueueLookupKey(input.QueueName, input.QueueOwnerAWSAccountId)),
    };
  }

  async listQueues(input: ListQueuesCommandInput) {
    this.listQueuesInputs.push(input);
    return this.listQueuesResponses.shift() ?? { QueueUrls: [] };
  }

  async sendMessage(input: SendMessageCommandInput) {
    this.sendMessageInputs.push(input);
    return { MessageId: 'message-1', SequenceNumber: '1', MD5OfMessageBody: 'md5-body' };
  }

  async sendMessageBatch(input: SendMessageBatchCommandInput) {
    this.sendMessageBatchInputs.push(input);
    return this.batchResponses.shift() ?? { Successful: [], Failed: [] };
  }

  async deleteMessageBatch(input: DeleteMessageBatchCommandInput) {
    this.deleteMessageBatchInputs.push(input);
    return this.deleteBatchResponses.shift() ?? { Successful: [], Failed: [] };
  }

  async changeMessageVisibilityBatch(input: ChangeMessageVisibilityBatchCommandInput) {
    this.changeMessageVisibilityBatchInputs.push(input);
    return this.visibilityBatchResponses.shift() ?? { Successful: [], Failed: [] };
  }
}

export class FakeSnsTransportClient implements SnsTransportClient {
  readonly listTopicsInputs: ListTopicsCommandInput[] = [];
  readonly publishInputs: Array<Record<string, unknown>> = [];
  readonly publishBatchInputs: PublishBatchCommandInput[] = [];
  private readonly listTopicsResponses: Array<{ NextToken?: string; Topics?: Array<{ TopicArn?: string }> }> = [];
  private readonly publishBatchResponses: Array<{
    Successful?: Array<{ Id?: string; MessageId?: string; SequenceNumber?: string }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }> = [];

  withListTopicsResponse(response: { NextToken?: string; Topics?: Array<{ TopicArn?: string }> }): this {
    this.listTopicsResponses.push(response);
    return this;
  }

  withPublishBatchResponse(response: {
    Successful?: Array<{ Id?: string; MessageId?: string; SequenceNumber?: string }>;
    Failed?: Array<{ Id?: string; Code?: string; Message?: string; SenderFault?: boolean }>;
  }): this {
    this.publishBatchResponses.push(response);
    return this;
  }

  async listTopics(input: ListTopicsCommandInput) {
    this.listTopicsInputs.push(input);
    return this.listTopicsResponses.shift() ?? { Topics: [] };
  }

  async publish(input: Record<string, unknown>) {
    this.publishInputs.push(input);
    return { MessageId: 'sns-message-1', SequenceNumber: '2' };
  }

  async publishBatch(input: PublishBatchCommandInput) {
    this.publishBatchInputs.push(input);
    return this.publishBatchResponses.shift() ?? { Successful: [], Failed: [] };
  }
}

export function createRawSqsStringAttribute(value: string): SqsMessageAttributeValue {
  return { DataType: 'String', StringValue: value };
}

function createQueueLookupKey(queueName: string, ownerAccountId?: string): string {
  return ownerAccountId ? `${ownerAccountId}:${queueName}` : queueName;
}
